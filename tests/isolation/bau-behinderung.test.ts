/**
 * PR 44 gegen die echte Datenbank — die Behinderungsanzeige (BAU-06,
 * § 6 VOB/B, Invariante 7).
 *
 * Das dritte Abnahmekriterium hat vier Teile, und jeder wird hier so geprüft,
 * dass er OHNE die Umsetzung fehlschlägt:
 *
 *  - Die Anzeige entsteht aus einer **Vorlage** — nicht aus einem Textfeld,
 *    und ein unbekannter Platzhalter wird abgewiesen statt geleert.
 *  - Ihr **Absendedatum** wird dokumentiert — vom SERVER, und niemals beim
 *    Anlegen.
 *  - Sie wird als **Dokument archiviert** — und ohne Speicher entsteht gar
 *    nichts.
 *  - Der Versand läuft durch **`server/agent/policy.ts`**: ohne genehmigte
 *    Freigabe mit benanntem Menschen und passendem Nutzlast-Hash geht nichts
 *    hinaus, und die nicht verbundenen Kanäle werden abgewiesen statt
 *    nachgebaut.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher, NichtVerbundenFehler, SupabaseSpeicher }
  from '../../src/server/storage/adapter.js';
import { FreigabeErforderlich } from '../../src/server/agent/policy.js';
import {
  BehinderungFehler, ELEKTRONISCHE_KANAELE, KanalNichtVerbundenFehler,
  behinderungNutzlast, dokumentiereVersand, erstelleBehinderung, findeBehinderung,
  ladeVorlagen, nutzlastHash, setzeVorlage, zeigeWegfallAn,
} from '../../src/server/services/bau/behinderung.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

interface Aufbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly projekt: string;
  readonly projektNummer: string;
  readonly benutzer: string;
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
 * Die Vorlage, die die Migration bei jedem Mandanten anlegt — hier von Hand.
 *
 * `seed()` setzt `session_replication_role = replica`; dabei bleibt auch
 * `trg_mandant_behinderung_vorlagen_vorbelegen` aus, und `behinderung_vorlage`
 * waere leer. Dass der Ausloeser im echten Betrieb feuert, prueft
 * `bau-nachtrag.test.ts` fuer sein Gegenstueck eigens.
 */
async function vorlagenVorbelegen(mandant: string): Promise<void> {
  await sql.unsafe(`select kern.behinderung_vorlagen_vorbelegen($1)`, [mandant]);
}

async function baueProjekt(mandant: string): Promise<Aufbau> {
  await vorlagenVorbelegen(mandant);
  const benutzer = await konto(`behinderung-${zufall()}@cse.test`);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId('leitung')]);

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Bauherr Nord') returning id`, [mandant, `K-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'projekt','aktiv','Rohbau Nord',$4,'2026-01-01') returning id`,
    [mandant, `AU-${zufall()}`, k!.id, benutzer] as never[]);
  const nummer = `P-${zufall()}`;
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, verantwortlich_benutzer_id)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b',$5) returning id`,
    [mandant, a!.id, nummer, k!.id, benutzer] as never[]);

  return {
    mandant, kunde: k!.id, projekt: p!.id, projektNummer: nummer, benutzer,
  };
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

const EINGABE = {
  vorlageSchluessel: 'vob_b_6_1',
  grundKategorie: 'risikobereich_ag' as const,
  ursache: 'Der Baugrund ist bis heute nicht übergeben.',
  beginnAm: '2026-09-03',
  auswirkung: 'Verschiebung des Rohbautermins um voraussichtlich 12 Werktage',
  absender: 'Bauleitung, F. Beyer',
};

async function entwurf(bau: Aufbau): Promise<{
  readonly id: string; readonly nummer: string; readonly anzeigetext: string;
}> {
  return alsBauleitung(bau, async (k) =>
    erstelleBehinderung(k, { projektId: bau.projekt, ...EINGABE }));
}

/**
 * Eine genehmigte Freigabe mit Schnappschuss, deren `nutzlast_hash` zu GENAU
 * dieser Nutzlast passt — so wie der Freigabe-Posteingang sie schreiben wird.
 *
 * Sie entsteht als Eigentuemer und nicht unter `cse_app`: die Freigabe zu
 * ERTEILEN ist ein anderer Vorgang mit einem anderen Recht
 * (`versand.freigeben`), und dieser Test prueft nicht ihn, sondern das Tor
 * davor.
 */
async function freigabeFuer(
  bau: Aufbau,
  daten: {
    readonly behinderungId: string; readonly nummer: string;
    readonly empfaenger: string; readonly anzeigetext: string;
    readonly versandart?: 'brief' | 'einschreiben';
  },
): Promise<string> {
  const nutzlast = behinderungNutzlast(bau.mandant, {
    behinderungId: daten.behinderungId,
    nummer: daten.nummer,
    projekt: `${bau.projektNummer} · Rohbau Nord`,
    empfaenger: daten.empfaenger,
    versandart: daten.versandart ?? 'einschreiben',
    anzeigetext: daten.anzeigetext,
  });
  const hash = nutzlastHash(nutzlast);

  const [fr] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am)
     values ($1,'behinderung_senden','genehmigt',$2,now()) returning id`,
    [bau.mandant, bau.benutzer] as never[]);
  const [kette] = await sql.unsafe<{ kette_nr: string; vorheriger_hash: string }[]>(
    `select * from app.freigabe_kette_ziehen($1)`, [bau.mandant]);
  await sql.unsafe(
    `insert into freigabe_snapshot (mandant_id, freigabe_id, kette_nr, nutzlast,
                                    nutzlast_hash, vorheriger_hash, hash, entscheidung,
                                    entschieden_von)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7,'genehmigt',$8)`,
    [
      bau.mandant, fr!.id, kette!.kette_nr, JSON.stringify(nutzlast.inhalt),
      hash, kette!.vorheriger_hash, hash, bau.benutzer,
    ] as never[]);
  return fr!.id;
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

/* ===========================================================================
 * (3a) Sie entsteht aus einer VORLAGE
 * ======================================================================== */

describe('(3) die Anzeige entsteht aus einer Vorlage', () => {
  it('die Vorlage steht als ZEILE und ist als unbestätigt markiert (O-23)', async () => {
    const bau = await baueProjekt(f.bau);
    const vorlagen = await alsBauleitung(bau, async (k) => ladeVorlagen(k));
    expect(vorlagen).toHaveLength(1);
    expect(vorlagen[0]!.schluessel).toBe('vob_b_6_1');
    expect(vorlagen[0]!.fundstelle).toBe('§ 6 Abs. 1 VOB/B');
    expect(vorlagen[0]!.ist_platzhalter).toBe(true);
    // Der Rumpf trägt die Angaben, die § 6 Abs. 1 VOB/B selbst verlangt.
    expect(vorlagen[0]!.rumpf).toContain('{ursache}');
    expect(vorlagen[0]!.rumpf).toContain('{beginn}');
    expect(vorlagen[0]!.rumpf).toContain('{auswirkung}');
  });

  it('der erzeugte Text hat KEINE offene Klammer mehr und nennt alle Pflichtangaben',
    async () => {
      const bau = await baueProjekt(f.bau);
      const e = await entwurf(bau);

      // Ein Schreiben mit `{ursache}` darin geht an den Auftraggeber hinaus.
      expect(e.anzeigetext).not.toMatch(/[{}]/u);
      expect(e.anzeigetext).toContain('§ 6 Abs. 1 VOB/B');
      expect(e.anzeigetext).toContain(EINGABE.ursache);
      expect(e.anzeigetext).toContain('03.09.2026');
      expect(e.anzeigetext).toContain(EINGABE.auswirkung);
      expect(e.anzeigetext).toContain(bau.projektNummer);
      expect(e.anzeigetext).toContain(EINGABE.absender);
      // § 6 Abs. 2 Nr. 1 a — die Risikosphäre steht im Schreiben, nicht nur
      // in der Spalte.
      expect(e.anzeigetext).toContain('Risikobereich des Auftraggebers');
    });

  it('ein unbekannter Platzhalter wird ABGEWIESEN, nicht stillschweigend geleert', () => {
    expect(() => setzeVorlage('Sehr geehrte {anrede},', {
      projekt: 'P', ursache: 'U', grund: 'G', beginn: 'B', auswirkung: 'A', absender: 'X',
    })).toThrow(/\{anrede\}/u);
  });

  it('ohne Vorlage entsteht nichts — freien Text gibt es hier nicht', async () => {
    const bau = await baueProjekt(f.bau);
    await expect(alsBauleitung(bau, async (k) => erstelleBehinderung(k, {
      projektId: bau.projekt, ...EINGABE, vorlageSchluessel: 'gibt_es_nicht',
    }))).rejects.toThrow(BehinderungFehler);
  });

  it('und ein Entwurf trägt KEIN Absendedatum', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    const zeile = await alsBauleitung(bau, async (k) => findeBehinderung(k, e.id));
    expect(zeile?.status).toBe('entwurf');
    // Eine Anzeige wirkt, wenn sie beim Auftraggeber ist — nicht, wenn sie
    // geschrieben wurde.
    expect(zeile?.angezeigt_lokal).toBeNull();
    expect(zeile?.versandart).toBeNull();
    expect(zeile?.versand_dokument_id).toBeNull();
  });
});

/* ===========================================================================
 * (3b) Der Versand läuft durch `server/agent/policy.ts`
 * ======================================================================== */

describe('(3) der Versand läuft durch das Tor — und nur durch das Tor', () => {
  it('ohne Freigabe geht NICHTS hinaus, und nichts wird dokumentiert', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    const speicher = new LokalerSpeicher();

    await expect(alsBauleitung(bau, async (k) => dokumentiereVersand(
      k,
      { id: e.id, versandart: 'einschreiben', empfaenger: 'Bauherr Nord GmbH', freigabeId: '00000000-0000-0000-0000-000000000000' },
      speicher,
    ))).rejects.toThrow(FreigabeErforderlich);

    const zeile = await alsBauleitung(bau, async (k) => findeBehinderung(k, e.id));
    expect(zeile?.angezeigt_lokal).toBeNull();
    expect(zeile?.status).toBe('entwurf');
    const [dok] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from dokument where mandant_id = $1`, [bau.mandant]);
    expect(dok!.n).toBe('0');
  });

  it('eine Freigabe über einen ANDEREN Text zählt nicht (Hash-Bindung)', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    const speicher = new LokalerSpeicher();

    // Freigegeben wurde ein Schreiben mit anderem Wortlaut — genau der Fall,
    // den die Hash-Bindung fangen soll.
    const freigabe = await freigabeFuer(bau, {
      behinderungId: e.id, nummer: e.nummer, empfaenger: 'Bauherr Nord GmbH',
      anzeigetext: 'Ein ganz anderer Text',
    });

    await expect(alsBauleitung(bau, async (k) => dokumentiereVersand(
      k,
      { id: e.id, versandart: 'einschreiben', empfaenger: 'Bauherr Nord GmbH', freigabeId: freigabe },
      speicher,
    ))).rejects.toThrow(/Hash-Abweichung/u);
  });

  it('eine Freigabe an einen ANDEREN Empfänger zählt ebenfalls nicht', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    const freigabe = await freigabeFuer(bau, {
      behinderungId: e.id, nummer: e.nummer, empfaenger: 'Jemand anderes',
      anzeigetext: e.anzeigetext,
    });
    await expect(alsBauleitung(bau, async (k) => dokumentiereVersand(
      k,
      { id: e.id, versandart: 'einschreiben', empfaenger: 'Bauherr Nord GmbH', freigabeId: freigabe },
      new LokalerSpeicher(),
    ))).rejects.toThrow(/Hash-Abweichung/u);
  });

  it('eine OFFENE Freigabe genügt nicht — genehmigt heisst entschieden', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    const freigabe = await freigabeFuer(bau, {
      behinderungId: e.id, nummer: e.nummer, empfaenger: 'Bauherr Nord GmbH',
      anzeigetext: e.anzeigetext,
    });
    await sql.unsafe(
      `update freigabe set status = 'offen', freigegeben_von = null, freigegeben_am = null
        where id = $1`, [freigabe]);

    await expect(alsBauleitung(bau, async (k) => dokumentiereVersand(
      k,
      { id: e.id, versandart: 'einschreiben', empfaenger: 'Bauherr Nord GmbH', freigabeId: freigabe },
      new LokalerSpeicher(),
    ))).rejects.toThrow(/Freigabe ist offen/u);
  });
});

/* ===========================================================================
 * (3c) Nicht verbundene Kanäle — abgewiesen, nie nachgebaut
 * ======================================================================== */

describe('(3) was nicht verbunden ist, wird nicht vorgetäuscht', () => {
  it.each(ELEKTRONISCHE_KANAELE)('Kanal „%s" wird abgewiesen — vor allem anderen', async (kanal) => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    const freigabe = await freigabeFuer(bau, {
      behinderungId: e.id, nummer: e.nummer, empfaenger: 'Bauherr Nord GmbH',
      anzeigetext: e.anzeigetext,
    });

    await expect(alsBauleitung(bau, async (k) => dokumentiereVersand(
      k,
      { id: e.id, versandart: kanal, empfaenger: 'Bauherr Nord GmbH', freigabeId: freigabe },
      new LokalerSpeicher(),
    ))).rejects.toThrow(KanalNichtVerbundenFehler);

    const zeile = await alsBauleitung(bau, async (k) => findeBehinderung(k, e.id));
    expect(zeile?.angezeigt_lokal).toBeNull();
  });

  it('ohne Speicher entsteht NICHTS — kein Datum, kein Zustandswechsel', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    const freigabe = await freigabeFuer(bau, {
      behinderungId: e.id, nummer: e.nummer, empfaenger: 'Bauherr Nord GmbH',
      anzeigetext: e.anzeigetext,
    });
    // Ohne Zugangsdaten: nicht verbunden, und der Adapter sagt es laut.
    const speicher = new SupabaseSpeicher('', '');
    expect(speicher.verbunden).toBe(false);

    await expect(alsBauleitung(bau, async (k) => dokumentiereVersand(
      k,
      { id: e.id, versandart: 'einschreiben', empfaenger: 'Bauherr Nord GmbH', freigabeId: freigabe },
      speicher,
    ))).rejects.toThrow(NichtVerbundenFehler);

    const zeile = await alsBauleitung(bau, async (k) => findeBehinderung(k, e.id));
    expect(zeile?.angezeigt_lokal).toBeNull();
    expect(zeile?.versand_dokument_id).toBeNull();
    expect(zeile?.status).toBe('entwurf');
  });
});

/* ===========================================================================
 * (3d) Der glückliche Weg: Datum dokumentiert, Schreiben archiviert
 * ======================================================================== */

describe('(3) mit Freigabe: Datum dokumentiert, Schreiben archiviert, eingefroren', () => {
  async function versende(bau: Aufbau): Promise<{
    readonly id: string; readonly text: string;
    readonly ergebnis: { readonly dokumentId: string; readonly angezeigtAm: string };
    readonly speicher: LokalerSpeicher;
  }> {
    const e = await entwurf(bau);
    const freigabe = await freigabeFuer(bau, {
      behinderungId: e.id, nummer: e.nummer, empfaenger: 'Bauherr Nord GmbH',
      anzeigetext: e.anzeigetext,
    });
    const speicher = new LokalerSpeicher();
    const ergebnis = await alsBauleitung(bau, async (k) => dokumentiereVersand(
      k,
      { id: e.id, versandart: 'einschreiben', empfaenger: 'Bauherr Nord GmbH', freigabeId: freigabe },
      speicher,
    ));
    return { id: e.id, text: e.anzeigetext, ergebnis, speicher };
  }

  it('das Absendedatum ist der BERLINER Kalendertag des Servers', async () => {
    const bau = await baueProjekt(f.bau);
    const { id } = await versende(bau);

    const [erwartet] = await sql.unsafe<{ tag: string }[]>(
      `select to_char(app.berlin_heute(), 'DD.MM.YYYY') as tag`);
    const zeile = await alsBauleitung(bau, async (k) => findeBehinderung(k, id));
    expect(zeile?.angezeigt_lokal).toBe(erwartet!.tag);
    expect(zeile?.status).toBe('angezeigt');
    expect(zeile?.versandart).toBe('einschreiben');
    expect(zeile?.empfaenger).toBe('Bauherr Nord GmbH');
  });

  it('ein vom Aufrufer mitgeschicktes Datum wird überschrieben — nicht übernommen', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    // Ein zurueckdatiertes Behinderungsschreiben waere im Bauzeitenstreit
    // bares Geld wert — also darf es diesen Weg nicht geben.
    await sql.unsafe(
      `update behinderung set angezeigt_am = '2020-01-01', versandart = 'brief'
        where id = $1`, [e.id]);
    const [heute] = await sql.unsafe<{ tag: string }[]>(
      `select app.berlin_heute()::text as tag`);
    const [gesetzt] = await sql.unsafe<{ tag: string }[]>(
      `select angezeigt_am::text as tag from behinderung where id = $1`, [e.id]);
    expect(gesetzt!.tag).toBe(heute!.tag);
  });

  it('das Schreiben liegt als PDF im privaten Speicher und als `dokument`-Zeile', async () => {
    const bau = await baueProjekt(f.bau);
    const { ergebnis, speicher } = await versende(bau);

    const [dok] = await sql.unsafe<{
      id: string; kategorie: string; mime_typ: string; bucket: string;
      objekt_schluessel: string; sha256: string; loeschsperre: boolean;
    }[]>(
      `select id, kategorie::text as kategorie, mime_typ, bucket, objekt_schluessel,
              sha256, loeschsperre
         from dokument where id = $1`, [ergebnis.dokumentId]);
    expect(dok).toBeDefined();
    expect(dok!.kategorie).toBe('projekt');
    expect(dok!.mime_typ).toBe('application/pdf');
    // DOC-03: es gibt keinen öffentlichen Bucket.
    expect(['dokumente', 'archiv']).toContain(dok!.bucket);
    expect(dok!.sha256).toMatch(/^[0-9a-f]{64}$/u);

    // Und es ist eine ECHTE Datei, keine Zeile, die eine behauptet.
    const bytes = speicher.rohBytes(dok!.bucket as 'dokumente', dok!.objekt_schluessel);
    expect(bytes).toBeDefined();
    expect(new TextDecoder().decode(bytes!.slice(0, 5))).toBe('%PDF-');

    const zeile = await alsBauleitung(bau, async (k) => findeBehinderung(k, ergebnis.dokumentId));
    expect(zeile).toBeNull(); // die Dokumentkennung ist keine Behinderungskennung
  });

  it('nach dem Versand ist die Anzeige unveränderlich — eine Korrektur ist eine neue Anzeige',
    async () => {
      const bau = await baueProjekt(f.bau);
      const { id } = await versende(bau);
      await expect(sql.unsafe(
        `update behinderung set anzeigetext = 'anders' where id = $1`, [id],
      )).rejects.toThrow(/unveraenderlich/u);
      await expect(sql.unsafe(
        `update behinderung set empfaenger = 'jemand anderes' where id = $1`, [id],
      )).rejects.toThrow(/unveraenderlich/u);
      await expect(sql.unsafe(
        `update behinderung set angezeigt_am = '2020-01-01' where id = $1`, [id],
      )).rejects.toThrow(/unveraenderlich/u);
    });

  it('ein zweiter Versand wird abgewiesen', async () => {
    const bau = await baueProjekt(f.bau);
    const { id, text } = await versende(bau);
    const freigabe = await freigabeFuer(bau, {
      behinderungId: id, nummer: 'B001', empfaenger: 'Bauherr Nord GmbH',
      anzeigetext: text,
    });
    await expect(alsBauleitung(bau, async (k) => dokumentiereVersand(
      k,
      { id, versandart: 'einschreiben', empfaenger: 'Bauherr Nord GmbH', freigabeId: freigabe },
      new LokalerSpeicher(),
    ))).rejects.toThrow(/hinausgegangen/u);
  });

  it('der Wegfall (§ 6 Abs. 3) ändert die Anzeige nicht, sondern setzt Ende und Zustand',
    async () => {
      const bau = await baueProjekt(f.bau);
      const { id } = await versende(bau);
      await alsBauleitung(bau, async (k) => zeigeWegfallAn(k, {
        id, endeAm: '2026-09-20', angezeigtAm: '2026-09-21',
      }));
      const zeile = await alsBauleitung(bau, async (k) => findeBehinderung(k, id));
      expect(zeile?.status).toBe('weggefallen');
      expect(zeile?.ende_lokal).toBe('20.09.2026');
      expect(zeile?.wegfall_lokal).toBe('21.09.2026');
    });

  it('und der Wegfall ohne vorherige Anzeige wird abgewiesen', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    await expect(alsBauleitung(bau, async (k) => zeigeWegfallAn(k, {
      id: e.id, endeAm: '2026-09-20', angezeigtAm: '2026-09-21',
    }))).rejects.toThrow(BehinderungFehler);
  });
});

/* ===========================================================================
 * Der Rahmen
 * ======================================================================== */

describe('die Behinderungsanzeige steht unter Invariante 3 und Invariante 8', () => {
  it('ein fremder Mandant sieht sie nicht', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);

    const fremder = await konto(`fremd-${zufall()}@cse.test`);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [fremder, f.reinigung, await rolleId('leitung')]);

    const gesehen = await alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: fremder,
        portal: 'intern', readonly: false,
      },
      async (tx) => findeBehinderung(kontextAus(tx, f.reinigung, fremder), e.id),
    );
    expect(gesehen).toBeNull();
  });

  it('und gelöscht wird sie nie (Invariante 8)', async () => {
    const bau = await baueProjekt(f.bau);
    const e = await entwurf(bau);
    await expect(sql.unsafe(`delete from behinderung where id = $1`, [e.id]))
      .rejects.toThrow(/gesperrt|Invariante 8|Löschen|Loeschen/iu);
  });
});
