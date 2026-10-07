/**
 * **Die Leistungszeilen eines Auftrags** (V-360, O-921, D-825) — an echtem
 * Postgres.
 *
 * Geprüft wird: die Annahme eines Angebots übernimmt genau die
 * Leistungspositionen als Zeilen (nicht Alternativ- und Textpositionen), mit
 * Preis, Steuer und Verweis; eine nachträgliche Leistung bekommt ihre
 * Position, ihren Steuersatz aus der Tabelle und ihren Stichtag; eine Zeile
 * endet, ohne zu verschwinden — nicht vor ihrem Beginn, nicht vor einer
 * erfassten Zeit oder geplanten Schicht; die neue Zeile ist ein Anker, die
 * beendete keiner mehr; und ohne `auftrag.schreiben` wird nichts geschrieben.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { ladeKalkulationsgrundlage } from '../../src/server/services/kalkulation/raumbuch.js';
import { kalkuliere } from '../../src/server/services/kalkulation/index.js';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF }
  from '../../src/server/services/kalkulation/tarif.js';
import {
  gibPreisFrei, legeAngebotAn, uebernimmKalkulation, versendeAngebot, wandleInAuftrag,
} from '../../src/server/services/angebot/index.js';
import { bestaetigeKalkulation } from '../../src/server/services/kalkulation/bestaetigung.js';
import {
  LeistungFehler, beendeLeistungszeile, legeLeistungszeileAn, leseLeistungszeilen,
} from '../../src/server/services/auftrag/leistung.js';
import {
  type LeistungsankerFehler, pruefeLeistungsanker,
} from '../../src/server/services/dienstplan/leistungsanker.js';

let f: Fixtur;
let chef = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `leistung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

/**
 * Ein Kontext, der beiden Diensten genügt: den Leistungszeilen
 * (`LeseKontext & SchreibKontext`) und dem Angebot, das über `unsafe` seine
 * Nummer zieht.
 */
type Kontext = LeseKontext & SchreibKontext & {
  readonly unsafe: (s: string, w?: readonly unknown[]) => Promise<readonly unknown[]>;
};

function als<T>(benutzer: string, fn: (k: Kontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: benutzer,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage: fuehre, schreibe: fuehre,
        unsafe: async (s, w = []) => (await tx.unsafe(s, w as never[])) as readonly unknown[],
      } satisfies Kontext);
    },
  ) as Promise<T>;
}

async function grund(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (fehler) {
    if (fehler instanceof LeistungFehler) return fehler.grund;
    throw fehler;
  }
  return 'kein_fehler';
}

/** Ein Auftrag ohne Angebot, aktiv ab dem 1. Januar 2026, mit einem Objekt. */
async function auftrag(status = 'aktiv'): Promise<{ auftragId: string; objektId: string; kundeId: string }> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Zeilenkunde') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Zeilenobjekt','Teststr. 9','10115','Berlin') returning id`,
    [f.reinigung, k!.id, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          status_grund, bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'rahmenvertrag',$5::auftrag_status,
             case when $5 in ('pausiert','storniert') then 'Testfall' end,
             'Unterhaltsreinigung',$6,'2026-01-01')
     returning id`,
    [f.reinigung, `AU-${zufall()}`, k!.id, o!.id, status, chef] as never[]);
  return { auftragId: a!.id, objektId: o!.id, kundeId: k!.id };
}

const EINGABE = {
  bezeichnung: 'Sonderreinigung Glasdach', beschreibung: 'Zweimal im Jahr',
  menge: '2', einheit: 'einsatz', einzelpreis: '1.250,00', steuersatz: 'ust_19',
  gueltigAb: '2026-03-01',
};

beforeAll(async () => {
  f = await seed();
  chef = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.reinigung, await rolleId('leitung')]);
  for (const [typ, maske] of [['angebot', 'AN-{jahr}-{nr:5}'], ['auftrag', 'AU-{jahr}-{nr:5}']] as const) {
    await sql.unsafe(
      `insert into nummernkreis (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos,
                                 format_maske, zuruecksetzung, geoeffnet_am, ist_platzhalter,
                                 erstellt_von_art, erstellt_von_dienst)
       values ($1,$2::nummernkreis_typ,2026,$3,false,$4,'jaehrlich',current_date,false,
               'system','job:test')`,
      [f.reinigung, typ, typ, maske]);
  }
});
afterAll(schliessen);

describe('V-360 — die Annahme übernimmt die Leistungspositionen', () => {
  it('jede Leistungsposition wird eine Zeile ab dem Start — Alternativ und Text nicht', async () => {
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                          rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
       values ($1,$2,'Hausverwaltung','bestandskunde','Vertrag', now(), 'aktiv') returning id`,
      [f.reinigung, `K-${zufall()}`]);
    const [b] = await sql.unsafe<{ id: string }[]>(
      `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                              quelle, gueltig_ab)
       values ($1,$2,'PVC / Vinyl','250.000','Platzhalter (O-17)','2026-01-01') returning id`,
      [f.reinigung, `PVC${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1,$2,$3,'Buerohaus','Kurfuerstendamm 21','10719','Berlin') returning id`,
      [f.reinigung, k!.id, `OBJ-${zufall()}`]);
    for (const [nr, flaeche] of [['101', '300.000'], ['102', '200.000']] as const) {
      await sql.unsafe(
        `insert into raum (mandant_id, objekt_id, raumnummer, etage, flaeche_qm, belagsart_id)
         values ($1,$2,$3,'EG',$4,$5)`, [f.reinigung, o!.id, nr, flaeche, b!.id]);
    }
    const angebotId = await als(chef, async (db) => {
      const grundlage = await ladeKalkulationsgrundlage(db, o!.id, new Date());
      const frequenz = PLATZHALTER_FREQUENZ.frequenz('1_pro_monat');
      const tarif = PLATZHALTER_TARIF.tarif(f.reinigung, 'reinigung');
      const kalk = kalkuliere({ posten: grundlage.posten, frequenz, tarif });
      const id = await legeAngebotAn(db, { kundeId: k!.id, titel: 'Unterhaltsreinigung', objektId: o!.id });
      await uebernimmKalkulation(db, id, kalk,
        { objektId: o!.id, turnusLabel: 'monatlich', tarif, frequenz });
      return id;
    });
    await als(chef, (db) => bestaetigeKalkulation(db, angebotId, {
      stundensatzEuro: '29,00', gemeinkostenBasis: 'lohn', gemeinkostenProzent: '15',
      wagnisGewinnProzent: '8', frequenzFaktor: '1', leistungswerteBestaetigen: true,
      benutzerId: chef,
    }));
    await als(chef, async (db) => {
      await gibPreisFrei(db, angebotId, chef);
      await versendeAngebot(db, angebotId, chef);
    });
    /*
     * Eine Alternativ- und eine Textposition — am Angebot vorbei, weil ein
     * versendetes Angebot eingefroren ist. Beauftragt ist keine von beiden.
     */
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(
        `insert into angebotsposition (mandant_id, angebot_id, position_nr, typ, kurztext,
                                       menge, einheit, einzelpreis_cent, steuersatz_bp, sortierung)
         values ($1,$2,90,'alternativ','Alternativ: Glasreinigung',1,'einsatz',50000,1900,90),
                ($1,$2,91,'text','Hinweis zur Ausführung',null,null,null,1900,91)`,
        [f.reinigung, angebotId]);
    });
    const leistungen = await sql.unsafe<{
      id: string; kurztext: string; menge: string; einzelpreis_cent: string; steuersatz_bp: number;
    }[]>(
      `select id, kurztext, menge::text as menge, einzelpreis_cent::text as einzelpreis_cent,
              steuersatz_bp
         from angebotsposition where angebot_id = $1 and typ = 'leistung'
        order by sortierung, position_nr`, [angebotId]);
    expect(leistungen.length).toBeGreaterThan(0);

    const { auftragId } = await als(chef, (db) => wandleInAuftrag(db, angebotId, {
      art: 'rahmenvertrag', verantwortlichBenutzerId: chef, startDatum: '2026-11-01',
    }));

    const zeilen = await sql.unsafe<{
      position_nr: number; angebotsposition_id: string; bezeichnung: string; menge: string;
      einzelpreis_cent: string; steuersatz_bp: number; gueltig_ab: string; gueltig_bis: string | null;
    }[]>(
      `select position_nr, angebotsposition_id, bezeichnung, menge::text as menge,
              einzelpreis_cent::text as einzelpreis_cent, steuersatz_bp,
              gueltig_ab::text as gueltig_ab, gueltig_bis::text as gueltig_bis
         from auftrag_leistung where auftrag_id = $1 order by position_nr`, [auftragId]);
    expect(zeilen.map((z) => z.position_nr)).toEqual(leistungen.map((_, i) => i + 1));
    expect(zeilen.map((z) => z.angebotsposition_id)).toEqual(leistungen.map((l) => l.id));
    for (const [i, z] of zeilen.entries()) {
      const l = leistungen[i]!;
      expect(z).toMatchObject({
        bezeichnung: l.kurztext, menge: l.menge, einzelpreis_cent: l.einzelpreis_cent,
        steuersatz_bp: l.steuersatz_bp, gueltig_ab: '2026-11-01', gueltig_bis: null,
      });
    }
  });
});

describe('V-360 — eine nachträgliche Leistung anlegen', () => {
  it('bekommt die nächste Position, den Steuersatz aus der Tabelle und ihren Stichtag', async () => {
    const { auftragId } = await auftrag();
    const erste = await als(chef, (k) => legeLeistungszeileAn(k, auftragId, EINGABE));
    const zweite = await als(chef, (k) => legeLeistungszeileAn(k, auftragId, {
      ...EINGABE, bezeichnung: 'Teppichreinigung', menge: '10,5', einheit: 'm2',
      einzelpreis: '3,20', steuersatz: 'ust_07',
    }));
    const zeilen = await als(chef, (k) => leseLeistungszeilen(k, auftragId));
    expect(zeilen.map((z) => [z.id, z.positionNr])).toEqual([[erste, 1], [zweite, 2]]);
    expect(zeilen[0]).toMatchObject({
      bezeichnung: 'Sonderreinigung Glasdach', beschreibung: 'Zweimal im Jahr',
      menge: '2.000', einheit: 'einsatz', einzelpreisCent: 125000n, gesamtpreisCent: 250000n,
      steuersatzBp: 1900, steuerKennzeichen: 'regelsatz', gueltigAb: '2026-03-01',
      gueltigBis: null, ausAngebot: false,
    });
    // 10,5 × 3,20 € = 33,60 € — gerechnet in der Datenbank, nie in JavaScript.
    expect(zeilen[1]).toMatchObject({ menge: '10.500', gesamtpreisCent: 3360n, steuersatzBp: 700 });
  });

  it('weist ab, was keine Leistung ist — mit Grund statt Datenbankfehler', async () => {
    const { auftragId } = await auftrag();
    expect(await grund(() => als(chef, (k) => legeLeistungszeileAn(k, auftragId,
      { ...EINGABE, bezeichnung: '  ' })))).toBe('ohne_bezeichnung');
    expect(await grund(() => als(chef, (k) => legeLeistungszeileAn(k, auftragId,
      { ...EINGABE, menge: '0' })))).toBe('keine_menge');
    expect(await grund(() => als(chef, (k) => legeLeistungszeileAn(k, auftragId,
      { ...EINGABE, einzelpreis: '-5,00' })))).toBe('kein_betrag');
    expect(await grund(() => als(chef, (k) => legeLeistungszeileAn(k, auftragId,
      { ...EINGABE, einheit: 'schubkarre' })))).toBe('keine_einheit');
    expect(await grund(() => als(chef, (k) => legeLeistungszeileAn(k, auftragId,
      { ...EINGABE, steuersatz: '19' })))).toBe('kein_steuersatz');
    expect(await grund(() => als(chef, (k) => legeLeistungszeileAn(k, auftragId,
      { ...EINGABE, gueltigAb: '2026-02-30' })))).toBe('kein_datum');
    expect(await grund(() => als(chef, (k) => legeLeistungszeileAn(k, auftragId,
      { ...EINGABE, gueltigAb: '2025-12-31' })))).toBe('vor_auftragsbeginn');
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from auftrag_leistung where auftrag_id = $1`, [auftragId]);
    expect(n!.n).toBe(0);
  });

  it('ein stornierter Auftrag vereinbart nichts mehr', async () => {
    const { auftragId } = await auftrag('storniert');
    expect(await grund(() => als(chef, (k) => legeLeistungszeileAn(k, auftragId, EINGABE))))
      .toBe('auftrag_beendet');
  });

  it('ohne auftrag.schreiben wird nichts geschrieben', async () => {
    const { auftragId } = await auftrag();
    const leser = await konto();
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
       values ($1, $2, 'Nur lesen', 'mandant', 'intern') returning id`,
      [f.reinigung, `leser_${zufall()}`]);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, true from berechtigung b where b.schluessel = 'auftrag.lesen'`,
      [r!.id, f.reinigung]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [leser, f.reinigung, r!.id]);
    await expect(als(leser, (k) => legeLeistungszeileAn(k, auftragId, EINGABE))).rejects.toThrow();
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from auftrag_leistung where auftrag_id = $1`, [auftragId]);
    expect(n!.n).toBe(0);
  });
});

describe('V-360 — eine Zeile beenden', () => {
  async function schicht(objektId: string, kundeId: string, zeileId: string, tag: string): Promise<string> {
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, zeitzone, beginn_lokal, ende_lokal,
                            objekt_id, kunde_id, auftrag_leistung_id, erstellt_von_art, status)
       values ($1, 'manuell', $2, $3::date,
               ($3::date + time '08:00') at time zone 'Europe/Berlin',
               ($3::date + time '12:00') at time zone 'Europe/Berlin',
               'Europe/Berlin', time '08:00', time '12:00', $4, $5, $6, 'system', 'geplant')
       returning id`,
      [f.reinigung, `v360:${zufall()}`, tag, objektId, kundeId, zeileId]);
    return e!.id;
  }

  it('bleibt stehen, mit ihrem letzten Tag — nicht vor ihrem Beginn, nicht zweimal', async () => {
    const { auftragId } = await auftrag();
    const zeile = await als(chef, (k) => legeLeistungszeileAn(k, auftragId, EINGABE));
    expect(await grund(() => als(chef, (k) => beendeLeistungszeile(k, auftragId, zeile, '2026-02-28'))))
      .toBe('ende_vor_beginn');
    await als(chef, (k) => beendeLeistungszeile(k, auftragId, zeile, '2026-06-30'));
    const [z] = await als(chef, (k) => leseLeistungszeilen(k, auftragId));
    expect(z).toMatchObject({ id: zeile, gueltigBis: '2026-06-30' });
    expect(await grund(() => als(chef, (k) => beendeLeistungszeile(k, auftragId, zeile, '2026-07-31'))))
      .toBe('schon_beendet');
    // Eine Zeile eines anderen Auftrags gibt es hier nicht.
    const anderer = await auftrag();
    expect(await grund(() => als(chef, (k) => beendeLeistungszeile(k, anderer.auftragId, zeile, '2026-05-31'))))
      .toBe('unbekannte_zeile');
  });

  it('nicht vor einer geplanten Schicht und nicht vor einer erfassten Zeit an ihr', async () => {
    const { auftragId, objektId, kundeId } = await auftrag();
    const zeile = await als(chef, (k) => legeLeistungszeileAn(k, auftragId, EINGABE));
    const einsatz = await schicht(objektId, kundeId, zeile, '2026-05-12');
    expect(await grund(() => als(chef, (k) => beendeLeistungszeile(k, auftragId, zeile, '2026-04-30'))))
      .toBe('schichten_danach');

    await sql.unsafe(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, einsatz_id,
          beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
          erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
          status, erstellt_von_art)
       select $1, $2, $3, e.id, e.beginn_zeitpunkt, e.ende_zeitpunkt, 0,
              'import','import','import','import','abgeschlossen','system'
         from einsatz e where e.id = $4`,
      [f.reinigung, f.jonasReinigung, f.jonas, einsatz] as never[]);
    await sql.unsafe(
      `update einsatz set storniert_am = now(), storno_grund = 'Probe: abgesagt' where id = $1`,
      [einsatz]);
    expect(await grund(() => als(chef, (k) => beendeLeistungszeile(k, auftragId, zeile, '2026-04-30'))))
      .toBe('zeit_danach');
    // Am Tag der Zeit selbst darf sie enden — EINSCHLIESSLICH.
    await als(chef, (k) => beendeLeistungszeile(k, auftragId, zeile, '2026-05-12'));
  });
});

/** Wartet, bis eine Sitzung dieser Datenbank auf eine Sperre wartet. */
async function bisEinerWartet(wer: string): Promise<void> {
  for (let i = 0; ; i += 1) {
    const [w] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`);
    if (w!.n >= 1) return;
    if (i >= 250) throw new Error(`${wer} wartete nicht auf die Sperre.`);
    await new Promise((r) => { setTimeout(r, 20); });
  }
}

describe('V-360 — zwei gleichzeitige „Beenden"', () => {
  it('das zweite liest das Ende des ersten und schiebt es nicht hinaus', async () => {
    const { auftragId } = await auftrag();
    const zeile = await als(chef, (k) => legeLeistungszeileAn(k, auftragId, EINGABE));
    let melde!: () => void;
    const gehalten = new Promise<void>((r) => { melde = r; });
    let freigeben!: () => void;
    const halt = new Promise<void>((r) => { freigeben = r; });

    const erstes = als(chef, async (k) => {
      await beendeLeistungszeile(k, auftragId, zeile, '2026-06-30');
      melde();
      await halt;
    });
    await gehalten;
    const zweites = grund(() => als(chef, (k) => beendeLeistungszeile(k, auftragId, zeile, '2026-09-30')));
    await bisEinerWartet('Das zweite Beenden');
    freigeben();
    await erstes;
    expect(await zweites).toBe('schon_beendet');
    const [z] = await sql.unsafe<{ bis: string }[]>(
      `select gueltig_bis::text as bis from auftrag_leistung where id = $1`, [zeile]);
    expect(z!.bis).toBe('2026-06-30');
  });
});

describe('V-360 — die neue Zeile ist ein Anker, die beendete keiner', () => {
  it('pruefeLeistungsanker nimmt die lebende Zeile und weist die beendete ab', async () => {
    const { auftragId } = await auftrag();
    const zeile = await als(chef, (k) => legeLeistungszeileAn(k, auftragId, EINGABE));
    expect(await als(chef, (k) => pruefeLeistungsanker(k, zeile))).toBe(auftragId);
    await als(chef, (k) => beendeLeistungszeile(k, auftragId, zeile, '2026-03-31'));
    await expect(als(chef, (k) => pruefeLeistungsanker(k, zeile)))
      .rejects.toMatchObject({ grund: 'leistung_beendet' } satisfies Partial<LeistungsankerFehler>);
  });
});
