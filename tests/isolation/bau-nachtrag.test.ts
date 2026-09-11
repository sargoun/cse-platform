/**
 * PR 44 gegen die echte Datenbank — der Nachtrag (BAU-04, BAU-05).
 *
 * Drei der vier Abnahmekriterien haben hier ihren Prüfstein, und jedes ist so
 * geschrieben, dass es OHNE die Umsetzung fehlschlägt:
 *
 *  1. **`angemeldet_am` und `eingereicht_am` sind getrennte Spalten**, und ein
 *     angemeldeter, nach 14 Tagen nicht eingereichter Nachtrag wird von der
 *     Wachabfrage gewählt — und **einmal** gemeldet.
 *  2. **Zeit oder ein Aufmaß auf eine Position ausserhalb des LV** erzeugt
 *     eine Warnung, die die Position benennt — und sie verschwindet, sobald
 *     der angebotene Nachtrag entsteht.
 *  4. **Die § 2-VOB/B-Grundlage ist eine Pflichtauswahl aus der
 *     Katalogtabelle**, nie Freitext und nie ein Vorgabewert.
 *
 * Gelaufen wird als `cse_app` mit gebundener Sitzung, nie als Eigentümer: ein
 * Eigentümer ohne FORCE läuft an seinen eigenen Policies vorbei, und jede
 * Zusage unten bestünde dann aus dem falschen Grund.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  NACHTRAG_WACHFRIST_TAGE, NachtragFehler, findeNachtrag, ladeGrundlagen,
  listeNachtraege, markiereUeberfaelligGemeldet, meldeNachtragAn,
  ordneAufmasszeileZu, pruefeGrundlage, reicheEin, traegeAnmeldungNach,
  waehleUeberfaelligeNachtraege,
} from '../../src/server/services/bau/nachtrag.js';
import { ladeAusserhalbLv, warnungsText }
  from '../../src/server/services/bau/ausserhalb-lv.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

interface Aufbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly auftrag: string;
  readonly projekt: string;
  readonly lv: string;
  readonly position: string;
  readonly benutzer: string;
  readonly person: string;
  readonly anstellung: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  return u!.id;
}

/**
 * Der Katalog, den die Migration bei jedem Mandanten anlegt — hier von Hand.
 *
 * `seed()` setzt `session_replication_role = replica`, damit `truncate …
 * cascade` und die Fixture-Inserts nicht gegen die Ausloeser laufen. Genau
 * dabei bleibt aber auch `trg_mandant_nachtrag_grundlagen_vorbelegen` aus, und
 * `nachtrag_grundlage` waere leer — jeder Nachtrag schlueg mit einem
 * Fremdschluesselfehler fehl, der wie ein Fehler im Dienst aussieht. Dass der
 * Ausloeser im ECHTEN Betrieb feuert, prueft der Test weiter unten eigens.
 */
async function katalogVorbelegen(mandant: string): Promise<void> {
  await sql.unsafe(`select kern.nachtrag_grundlagen_vorbelegen($1)`, [mandant]);
}

async function baueProjekt(mandant: string, rolle = 'leitung'): Promise<Aufbau> {
  await katalogVorbelegen(mandant);
  const benutzer = await konto(`nachtrag-${zufall()}@cse.test`);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId(rolle)]);

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Bauherr Nord') returning id`, [mandant, `K-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'projekt','aktiv','Rohbau Nord',$4,'2026-01-01') returning id`,
    [mandant, `AU-${zufall()}`, k!.id, benutzer] as never[]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, verantwortlich_benutzer_id)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b',$5) returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id, benutzer] as never[]);
  const [lv] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
     values ($1,$2,'hauptauftrag','LV Rohbau') returning id`,
    [mandant, p!.id] as never[]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, oz, pfad,
                              sortier_pfad, ebene, art, kurztext, einheit, menge_vertrag,
                              einheitspreis_cent)
     values ($1,$2,$3,'01.02.0030','','',1,'position','Mauerwerk','m²',120,4599)
     returning id`,
    [mandant, lv!.id, p!.id] as never[]);

  const [person] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ('Polier',$1) returning id`,
    [`Nr-${zufall()}`]);
  const [anst] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
     values ($1,$2,$3,'2026-01-01') returning id`,
    [mandant, person!.id, `PN-${zufall()}`] as never[]);

  return {
    mandant, kunde: k!.id, auftrag: a!.id, projekt: p!.id, lv: lv!.id,
    position: pos!.id, benutzer, person: person!.id, anstellung: anst!.id,
  };
}

/** Die Anspruchsgrundlage `§ 2 Abs. 6 VOB/B` aus dem vorbelegten Katalog. */
async function grundlage(mandant: string, schluessel = 'p2_abs_6'): Promise<string> {
  const [g] = await sql.unsafe<{ id: string }[]>(
    `select id from nachtrag_grundlage where mandant_id = $1 and schluessel = $2`,
    [mandant, schluessel]);
  return g!.id;
}

function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage, schreibe: abfrage,
  };
}

async function alsBauleitung<T>(
  bau: Aufbau, fn: (kontext: SchreibKontext, tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: bau.mandant, benutzerId: bau.benutzer,
      portal: 'intern', readonly: false,
    },
    async (tx) => fn(kontextAus(tx, bau.mandant, bau.benutzer), tx),
  );
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

/* ===========================================================================
 * (4) Die § 2-VOB/B-Grundlage ist eine Pflichtauswahl aus dem KATALOG
 * ======================================================================== */

describe('(4) die Anspruchsgrundlage — Auswahl, nie Freitext, nie Vorgabewert', () => {
  it('der Katalog ist vorbelegt und JEDE Zeile ist als unbestätigt markiert (O-23)', async () => {
    const bau = await baueProjekt(f.bau);
    const zeilen = await alsBauleitung(bau, async (k) => ladeGrundlagen(k));

    // Vollständig aus dem Gesetzestext — nicht eine Auswahl, die jemand
    // getroffen hat: die Auswahl IST die offene Frage.
    expect(zeilen.length).toBeGreaterThanOrEqual(8);
    expect(zeilen.map((z) => z.fundstelle)).toContain('§ 2 Abs. 6 VOB/B');
    expect(zeilen.every((z) => z.ist_platzhalter)).toBe(true);
    // § 2 Abs. 6 Nr. 1: die Ankündigung ist Anspruchsvoraussetzung.
    expect(zeilen.find((z) => z.schluessel === 'p2_abs_6')?.ankuendigung_erforderlich)
      .toBe(true);
  });

  it('eine NEU angelegte Gesellschaft bekommt den Katalog vom Auslöser', async () => {
    /**
     * Ohne diesen Auslöser bekäme ein später angelegter Mandant keinen
     * Katalog — und `nachtrag.grundlage_id` ist `not null`: der erste Nachtrag
     * scheiterte mit einem Fremdschlüsselfehler, und zwar erst, wenn ihn
     * jemand anlegen will.
     */
    const [m] = await sql.unsafe<{ id: string }[]>(
      `insert into mandant (slug, name, firma, rechtsform)
       values ($1,'Neu GmbH','Neu GmbH','GmbH') returning id`,
      [`neu${zufall()}`]);
    const [zahl] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from nachtrag_grundlage where mandant_id = $1`,
      [m!.id]);
    expect(Number(zahl!.n)).toBeGreaterThanOrEqual(8);
  });

  it('`grundlage_id` ist eine SPALTE MIT FREMDSCHLÜSSEL, kein Text', async () => {
    const [spalte] = await sql.unsafe<{ typ: string; nullable: string }[]>(
      `select data_type as typ, is_nullable as nullable
         from information_schema.columns
        where table_name = 'nachtrag' and column_name = 'grundlage_id'`);
    expect(spalte!.typ).toBe('uuid');
    expect(spalte!.nullable).toBe('NO');

    // Und es gibt KEINE Textspalte daneben, in die jemand frei schreiben könnte.
    const frei = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
        where table_name = 'nachtrag' and column_name in ('grundlage','grundlage_text')`);
    expect(frei).toEqual([]);
  });

  it('die Spalte hat KEINEN Vorgabewert — nichts ist vorbelegt', async () => {
    const [spalte] = await sql.unsafe<{ vorgabe: string | null }[]>(
      `select column_default as vorgabe from information_schema.columns
        where table_name = 'nachtrag' and column_name = 'grundlage_id'`);
    expect(spalte!.vorgabe).toBeNull();
  });

  it('ohne Auswahl weist der Dienst mit einem deutschen Satz ab, nicht mit einem FK-Fehler', () => {
    expect(() => pruefeGrundlage('')).toThrow(/Pflichtauswahl/u);
    expect(() => pruefeGrundlage(null)).toThrow(NachtragFehler);
  });

  it('und die Datenbank weist einen Nachtrag ohne Grundlage ebenfalls ab', async () => {
    const bau = await baueProjekt(f.bau);
    await expect(sql.unsafe(
      `insert into nachtrag (mandant_id, projekt_id, auftrag_id, nummer, titel,
                             begruendung)
       values ($1,$2,$3,'N999','Ohne Grundlage','x')`,
      [bau.mandant, bau.projekt, bau.auftrag] as never[],
    )).rejects.toThrow(/grundlage_id|null value/iu);
  });

  it('eine Grundlage aus einem FREMDEN Mandanten wird abgewiesen (§1.4)', async () => {
    const bau = await baueProjekt(f.bau);
    await katalogVorbelegen(f.reinigung);
    const fremd = await grundlage(f.reinigung, 'p2_abs_6');
    await expect(sql.unsafe(
      `insert into nachtrag (mandant_id, projekt_id, auftrag_id, nummer, titel,
                             grundlage_id, begruendung)
       values ($1,$2,$3,'N998','Fremde Grundlage',$4,'x')`,
      [bau.mandant, bau.projekt, bau.auftrag, fremd] as never[],
    )).rejects.toThrow(/nachtrag_grundlage_fk|foreign key/iu);
  });
});

/* ===========================================================================
 * (1) Zwei Spalten, zwei Vorgänge — und die Wache meldet EINMAL
 * ======================================================================== */

describe('(1) `angemeldet_am` und `eingereicht_am` sind getrennte Spalten', () => {
  it('beide existieren, beide sind `date`, beide sind getrennt lesbar', async () => {
    const spalten = await sql.unsafe<{ column_name: string; data_type: string }[]>(
      `select column_name, data_type from information_schema.columns
        where table_name = 'nachtrag'
          and column_name in ('angemeldet_am','eingereicht_am')
        order by column_name`);
    expect(spalten.map((s) => s.column_name)).toEqual(['angemeldet_am', 'eingereicht_am']);
    expect(spalten.every((s) => s.data_type === 'date')).toBe(true);
  });

  it('das Anmelden setzt NUR `angemeldet_am`, und der Leser gibt beide getrennt heraus',
    async () => {
      const bau = await baueProjekt(f.bau);
      const g = await grundlage(bau.mandant);
      const kopf = await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
        projektId: bau.projekt,
        titel: 'Zusätzliche Bewehrung Achse C',
        grundlageId: g,
        begruendung: 'Vom Auftraggeber am 02.09. angeordnet.',
        angemeldetAm: '2026-09-01',
      }));
      expect(kopf.nummer).toMatch(/^N\d{3}$/u);

      const zeile = await alsBauleitung(bau, async (k) => findeNachtrag(k, kopf.id));
      expect(zeile?.angemeldet_am).toBe('2026-09-01');
      expect(zeile?.angemeldet_lokal).toBe('01.09.2026');
      // Und eingereicht ist es NICHT — das ist der ganze Punkt.
      expect(zeile?.eingereicht_am).toBeNull();
      expect(zeile?.status).toBe('angemeldet');
    });

  it('ein gesetztes Anmeldedatum wird nicht verschoben (write-once)', async () => {
    const bau = await baueProjekt(f.bau);
    const g = await grundlage(bau.mandant);
    const kopf = await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
      projektId: bau.projekt, titel: 'T', grundlageId: g, begruendung: 'B',
      angemeldetAm: '2026-09-01',
    }));
    await expect(alsBauleitung(bau, async (k) =>
      traegeAnmeldungNach(k, kopf.id, '2026-08-01')))
      .rejects.toThrow(/bereits ein Anmeldedatum/u);
  });

  it('ohne Anmeldung wird nichts eingereicht (§ 2 Abs. 6 Nr. 1 VOB/B)', async () => {
    const bau = await baueProjekt(f.bau);
    const g = await grundlage(bau.mandant);
    const kopf = await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
      projektId: bau.projekt, titel: 'T', grundlageId: g, begruendung: 'B',
      angemeldetAm: null,
    }));
    await expect(alsBauleitung(bau, async (k) => reicheEin(k, {
      id: kopf.id, eingereichtAm: '2026-09-20', freigabeId: 'egal',
    }))).rejects.toThrow(/nicht angemeldet/u);
  });

  it('und ohne genehmigte Freigabe auch nicht (Invariante 7) — die Datenbank sagt es zweimal',
    async () => {
      const bau = await baueProjekt(f.bau);
      const g = await grundlage(bau.mandant);
      const kopf = await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
        projektId: bau.projekt, titel: 'T', grundlageId: g, begruendung: 'B',
        angemeldetAm: '2026-09-01',
      }));
      await expect(alsBauleitung(bau, async (k) => reicheEin(k, {
        id: kopf.id, eingereichtAm: '2026-09-20', freigabeId: '',
      }))).rejects.toThrow(/Freigabe/u);

      // Auch ein zusammengebautes UPDATE kommt nicht daran vorbei.
      await expect(sql.unsafe(
        `update nachtrag set status = 'eingereicht', eingereicht_am = '2026-09-20'
          where id = $1`, [kopf.id],
      )).rejects.toThrow(/nachtrag_eingereicht_freigegeben/u);

      const zeile = await alsBauleitung(bau, async (k) => findeNachtrag(k, kopf.id));
      expect(zeile?.eingereicht_am).toBeNull();
      expect(zeile?.angemeldet_am).toBe('2026-09-01');
    });
});

describe('(1) die Wache aus SPEC §14 — 14 Tage, und sie meldet EINMAL', () => {
  /** Ein Nachtrag, dessen Ankündigung `tage` Tage zurückliegt (Berliner Tag). */
  async function angemeldetVor(bau: Aufbau, tage: number): Promise<string> {
    const g = await grundlage(bau.mandant);
    const kopf = await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
      projektId: bau.projekt, titel: `Offen seit ${String(tage)} Tagen`,
      grundlageId: g, begruendung: 'B', angemeldetAm: null,
    }));
    // Das Datum kommt aus der DATENBANK (`app.berlin_heute()`), nicht aus der
    // Uhr dieses Prozesses: er läuft in UTC, und um 00:30 Berliner Zeit wäre
    // der UTC-Tag der gestrige — die Frist verschöbe sich um einen Tag.
    await sql.unsafe(
      `update nachtrag set angemeldet_am = app.berlin_heute() - $2::int where id = $1`,
      [kopf.id, tage] as never[]);
    return kopf.id;
  }

  it('13 Tage: noch nicht; 14 Tage: gewählt — und die Meldung nennt Ziel und Empfänger',
    async () => {
      const bau = await baueProjekt(f.bau);
      await angemeldetVor(bau, NACHTRAG_WACHFRIST_TAGE - 1);
      const faellig = await angemeldetVor(bau, NACHTRAG_WACHFRIST_TAGE);

      const treffer = await alsBauleitung(bau, async (k) =>
        waehleUeberfaelligeNachtraege(k));
      expect(treffer.map((t) => t.id)).toEqual([faellig]);
      // NOT-03: ohne Ziel gibt es keine Benachrichtigung.
      expect(treffer[0]!.ziel).toMatch(/\/bau\/projekte\/.+\/nachtraege\//u);
      expect(treffer[0]!.verantwortlich_benutzer_id).toBe(bau.benutzer);
      expect(treffer[0]!.tage_offen).toBe(NACHTRAG_WACHFRIST_TAGE);
    });

  it('nach der Meldung wird derselbe Nachtrag NICHT wieder gewählt', async () => {
    const bau = await baueProjekt(f.bau);
    const faellig = await angemeldetVor(bau, 20);

    const ersterLauf = await alsBauleitung(bau, async (k) =>
      waehleUeberfaelligeNachtraege(k));
    expect(ersterLauf.map((t) => t.id)).toEqual([faellig]);

    const gemeldet = await alsBauleitung(bau, async (k) =>
      markiereUeberfaelligGemeldet(k, ersterLauf.map((t) => t.id)));
    expect(gemeldet).toBe(1);

    // Der zweite Lauf — der tägliche Job von morgen — findet nichts mehr.
    const zweiterLauf = await alsBauleitung(bau, async (k) =>
      waehleUeberfaelligeNachtraege(k));
    expect(zweiterLauf).toEqual([]);

    // Und ein WIEDERHOLUNGSLAUF auf derselben Liste meldet ebenfalls nicht
    // noch einmal: die Bedingung steht im UPDATE, nicht nur in der Abfrage.
    const nochmal = await alsBauleitung(bau, async (k) =>
      markiereUeberfaelligGemeldet(k, [faellig]));
    expect(nochmal).toBe(0);
  });

  it('ein eingereichter Nachtrag wird nie gewählt — auch nicht nach 60 Tagen', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await angemeldetVor(bau, 60);
    await sql.unsafe(
      `update nachtrag set status = 'kalkuliert', eingereicht_am = app.berlin_heute()
        where id = $1`, [id]);
    const treffer = await alsBauleitung(bau, async (k) =>
      waehleUeberfaelligeNachtraege(k));
    expect(treffer).toEqual([]);
  });

  it('die Liste zeigt „überfällig" und „offen seit" — dieselbe Frist, eine Quelle', async () => {
    const bau = await baueProjekt(f.bau);
    await angemeldetVor(bau, 21);
    const zeilen = await alsBauleitung(bau, async (k) =>
      listeNachtraege(k, { projektId: bau.projekt, nurOffen: true }));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.ueberfaellig).toBe(true);
    expect(zeilen[0]!.offen_seit_tagen).toBe(21);
  });
});

/* ===========================================================================
 * (2) Leistung ausserhalb des LV — benannt, und mit einem Ausweg
 * ======================================================================== */

describe('(2) Warnung ausserhalb des LV — sie benennt die Position', () => {
  /** Ein Aufmaßblatt mit einer Zeile, die in keinem LV steht. */
  async function blattAusserhalbLv(bau: Aufbau): Promise<string> {
    const [blatt] = await sql.unsafe<{ id: string }[]>(
      `insert into aufmass (mandant_id, projekt_id, kunde_id, nummer, bezeichnung,
                            messdatum, erhebungsart, leistungsverzeichnis_id)
       values ($1,$2,$3,$4,'Kernbohrungen','2026-09-10','gemeinsam',$5) returning id`,
      [bau.mandant, bau.projekt, bau.kunde, `A-${zufall()}`, bau.lv] as never[]);
    const [zeile] = await sql.unsafe<{ id: string }[]>(
      `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id,
                                  lv_position_id, ausserhalb_lv, reihenfolge, bezeichnung,
                                  rechenansatz, ergebnis_skaliert, menge, einheit)
       values ($1,$2,$3,$3,null,true,1,'Kernbohrung D 150 mm','12',120000,12.000,'St')
       returning id`,
      [bau.mandant, blatt!.id, bau.projekt] as never[]);
    return zeile!.id;
  }

  /** Gebuchte Zeit auf eine Auftragszeile, zu der es keine LV-Position gibt. */
  async function zeitAusserhalbLv(bau: Aufbau): Promise<string> {
    const [al] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, bezeichnung,
                                     menge, einheit, einzelpreis_cent, steuersatz_bp,
                                     gueltig_ab)
       values ($1,$2,90,'Stundenlohnarbeiten Räumung',10,'h',5200,1900,'2026-01-01')
       returning id`,
      [bau.mandant, bau.auftrag] as never[]);
    await sql.unsafe(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, auftrag_leistung_id, projekt_id,
          beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
          erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
          status, erstellt_von_art)
       values ($1,$2,$3,$4,$5,'2026-09-10T06:00:00Z','2026-09-10T10:00:00Z',0,
               'import','import','import','import','abgeschlossen','system')`,
      [bau.mandant, bau.anstellung, bau.person, al!.id, bau.projekt] as never[]);
    return al!.id;
  }

  it('beide Quellen erscheinen, und der Satz NENNT die Position wörtlich', async () => {
    const bau = await baueProjekt(f.bau);
    await blattAusserhalbLv(bau);
    await zeitAusserhalbLv(bau);

    const warnungen = await alsBauleitung(bau, async (k) =>
      ladeAusserhalbLv(k, { projektId: bau.projekt }));
    expect(warnungen.map((w) => w.quelle).sort()).toEqual(['aufmass', 'zeit']);

    const aufmass = warnungen.find((w) => w.quelle === 'aufmass')!;
    expect(aufmass.position).toBe('Kernbohrung D 150 mm');
    // „Es gibt Leistungen ausserhalb des LV" wäre keine Warnung, sondern eine
    // Stimmung: der Satz muss die Position selbst tragen.
    expect(warnungsText(aufmass)).toContain('Kernbohrung D 150 mm');
    expect(warnungsText(aufmass)).toMatch(/Aufmaßblatt/u);

    const zeit = warnungen.find((w) => w.quelle === 'zeit')!;
    expect(zeit.position).toBe('Stundenlohnarbeiten Räumung');
    expect(warnungsText(zeit)).toContain('Stundenlohnarbeiten Räumung');
    // 4 Stunden ohne Pause — als MINUTEN, nie als Gleitkommazahl.
    expect(zeit.umfang).toBe('240');
  });

  it('eine Zeile MIT LV-Position warnt nicht — sonst wäre die Liste jeden Tag gleich lang',
    async () => {
      const bau = await baueProjekt(f.bau);
      const [blatt] = await sql.unsafe<{ id: string }[]>(
        `insert into aufmass (mandant_id, projekt_id, kunde_id, nummer, bezeichnung,
                              messdatum, erhebungsart, leistungsverzeichnis_id)
         values ($1,$2,$3,$4,'Mauerwerk','2026-09-10','gemeinsam',$5) returning id`,
        [bau.mandant, bau.projekt, bau.kunde, `A-${zufall()}`, bau.lv] as never[]);
      await sql.unsafe(
        `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id,
                                    lv_position_id, reihenfolge, bezeichnung,
                                    rechenansatz, ergebnis_skaliert, menge, einheit)
         values ($1,$2,$3,$3,$4,1,'Wand C','1',10000,1.000,'m²')`,
        [bau.mandant, blatt!.id, bau.projekt, bau.position] as never[]);

      const warnungen = await alsBauleitung(bau, async (k) =>
        ladeAusserhalbLv(k, { projektId: bau.projekt }));
      expect(warnungen).toEqual([]);
    });

  it('der angebotene Nachtrag lässt die ZEIT-Warnung verschwinden', async () => {
    const bau = await baueProjekt(f.bau);
    const leistung = await zeitAusserhalbLv(bau);
    const g = await grundlage(bau.mandant);

    const vorher = await alsBauleitung(bau, async (k) =>
      ladeAusserhalbLv(k, { projektId: bau.projekt }));
    expect(vorher).toHaveLength(1);

    await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
      projektId: bau.projekt,
      titel: 'Leistung außerhalb des LV: Stundenlohnarbeiten Räumung',
      grundlageId: g,
      begruendung: 'Vom Auftraggeber angeordnet, nicht im LV enthalten.',
      angemeldetAm: '2026-09-10',
      auftragLeistungId: leistung,
    }));

    const nachher = await alsBauleitung(bau, async (k) =>
      ladeAusserhalbLv(k, { projektId: bau.projekt }));
    // Eine Warnung, die nach der Abhilfe stehen bleibt, liest niemand mehr.
    expect(nachher).toEqual([]);
  });

  it('und `ordneAufmasszeileZu` dasselbe für die AUFMASS-Warnung', async () => {
    const bau = await baueProjekt(f.bau);
    const zeile = await blattAusserhalbLv(bau);
    const g = await grundlage(bau.mandant);

    const kopf = await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
      projektId: bau.projekt,
      titel: 'Leistung außerhalb des LV: Kernbohrung D 150 mm',
      grundlageId: g, begruendung: 'Nicht im LV enthalten.', angemeldetAm: '2026-09-10',
    }));

    // Der Nachtrag allein genügt NICHT — die Zeile hängt noch an nichts.
    const dazwischen = await alsBauleitung(bau, async (k) =>
      ladeAusserhalbLv(k, { projektId: bau.projekt }));
    expect(dazwischen).toHaveLength(1);

    await alsBauleitung(bau, async (k) =>
      ordneAufmasszeileZu(k, { zeileId: zeile, nachtragId: kopf.id }));

    const nachher = await alsBauleitung(bau, async (k) =>
      ladeAusserhalbLv(k, { projektId: bau.projekt }));
    expect(nachher).toEqual([]);
  });

  it('eine Zuordnung wird nicht umgehängt, und nie an einen fremden Nachtrag', async () => {
    const bau = await baueProjekt(f.bau);
    const anderes = await baueProjekt(f.bau);
    const zeile = await blattAusserhalbLv(bau);
    const g = await grundlage(bau.mandant);

    const fremd = await alsBauleitung(anderes, async (k) => meldeNachtragAn(k, {
      projektId: anderes.projekt, titel: 'Fremdes Projekt', grundlageId: g,
      begruendung: 'B', angemeldetAm: '2026-09-10',
    }));
    // §1.4: der Grosselternschlüssel hält Zeile und Nachtrag im selben Projekt.
    await expect(alsBauleitung(bau, async (k) =>
      ordneAufmasszeileZu(k, { zeileId: zeile, nachtragId: fremd.id })))
      .rejects.toThrow(NachtragFehler);

    const eigen = await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
      projektId: bau.projekt, titel: 'Eigen', grundlageId: g,
      begruendung: 'B', angemeldetAm: '2026-09-10',
    }));
    await alsBauleitung(bau, async (k) =>
      ordneAufmasszeileZu(k, { zeileId: zeile, nachtragId: eigen.id }));
    // Zweimal ist keinmal: eine bestehende Zuordnung wird nicht verschoben.
    await expect(alsBauleitung(bau, async (k) =>
      ordneAufmasszeileZu(k, { zeileId: zeile, nachtragId: eigen.id })))
      .rejects.toThrow(NachtragFehler);
  });
});

/* ===========================================================================
 * Der Rahmen: Mandantentrennung und Invariante 8
 * ======================================================================== */

describe('der Nachtrag steht unter Invariante 3 und Invariante 8', () => {
  it('ein fremder Mandant sieht ihn nicht — und legt keinen an', async () => {
    const bau = await baueProjekt(f.bau);
    const g = await grundlage(bau.mandant);
    const kopf = await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
      projektId: bau.projekt, titel: 'T', grundlageId: g, begruendung: 'B',
      angemeldetAm: '2026-09-01',
    }));

    const fremder = await konto(`fremd-${zufall()}@cse.test`);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [fremder, f.reinigung, await rolleId('leitung')]);

    const gesehen = await alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: fremder,
        portal: 'intern', readonly: false,
      },
      async (tx) => findeNachtrag(kontextAus(tx, f.reinigung, fremder), kopf.id),
    );
    // AUT-06: nicht vorhanden, nicht verboten.
    expect(gesehen).toBeNull();
  });

  it('und gelöscht wird er nie (Invariante 8)', async () => {
    const bau = await baueProjekt(f.bau);
    const g = await grundlage(bau.mandant);
    const kopf = await alsBauleitung(bau, async (k) => meldeNachtragAn(k, {
      projektId: bau.projekt, titel: 'T', grundlageId: g, begruendung: 'B',
      angemeldetAm: '2026-09-01',
    }));
    await expect(sql.unsafe(`delete from nachtrag where id = $1`, [kopf.id]))
      .rejects.toThrow(/gesperrt|Invariante 8|Löschen|Loeschen/iu);
  });
});
