/**
 * Einen Platzhalterkreis freigeben — gegen echte Policies, Rechte, Auslöser
 * und die Festschreibung (FIN-03, LEG-01, TEN-02, V-284, O-134, D-779, D-848).
 *
 * **Der Befund.** Der Betriebs-Seed legt den Rechnungskreis mit der
 * Voreinstellung `RE-{jahr}-{nr:5}` als Platzhalter an (D-779); solange
 * `ist_platzhalter` steht, weist `fin.rechnung_nummer_ziehen` jede
 * Festschreibung ab. Aufheben konnte das nur eine Migration.
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Die Voreinstellung bestätigt: vorher wird nichts festgeschrieben,
 *     danach trägt die erste Rechnung `RE-<Jahr>-00001`; die Bezeichnung
 *     verliert ihren Vorbehalt, das Protokoll nennt vorher und nachher.
 *  2. Angepasst: fortlaufend mit eigener Maske zählt im Jahr 0 — und ist das
 *     laufende Jahr schon belegt, geht nur noch fortlaufend.
 *  3. Abgewiesen mit Grund, und der Kreis bleibt, wie er war: Maske (fünf
 *     Arten), Rücksetzung, Bezeichnung (leer, mit Vorbehalt), unbestätigt,
 *     schon freigegeben, geschlossen, fremde Gesellschaft, keine Kennung.
 *  4. Ohne `nummernkreis.verwalten` geht es nicht — weder über den Dienst
 *     noch an ihm vorbei; die Grammatik der Maske hält auch die
 *     Datenbankfunktion; und cse_app ändert die Spalte nicht selbst. Die
 *     vier Definer-Policies der Verwaltung gelten nur unter dem
 *     Vorgangsmarker — kein anderer Definer wird durch sie breiter.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import {
  FreigabeFehler, gibKreisFrei, type FreigabeEingabe,
} from '../../src/server/services/finanz/nummernkreis-freigabe.js';

let f: Fixtur;
let chef: string;
let kundeId: string;
let jahr: number;
const zufall = (): string => String(Math.random()).slice(2, 10);
const VOREINSTELLUNG = 'Ausgangsrechnungen (Voreinstellung RE-{jahr}-{nr:5} — zur Freigabe, O-134)';

async function superAdmin(): Promise<string> {
  const email = `kreise-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Administration', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

async function leitung(mandant: string): Promise<string> {
  const email = `leitung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
    [u!.id, mandant]);
  return u!.id;
}

/** Ein Platzhalterkreis — wie der Betriebs-Seed ihn anlegt (D-779). */
async function platzhalter(
  mandant: string,
  mehr: { typ?: string; jahr?: number; geschlossen?: boolean; bezeichnung?: string } = {},
): Promise<string> {
  const j = mehr.jahr ?? jahr;
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, geschlossen_am, ist_platzhalter, erstellt_von_art,
        erstellt_von_dienst)
     values ($1, $2::nummernkreis_typ, null, $3, $4, true, 'RE-{jahr}-{nr:5}', 'jaehrlich',
             $5::date, case when $6 then $5::date end, true, 'system', 'job:seed')
     returning id`,
    [mandant, mehr.typ ?? 'ausgangsrechnung', j, mehr.bezeichnung ?? VOREINSTELLUNG,
      `${String(j)}-01-01`, mehr.geschlossen ?? false]);
  return k!.id;
}

function kontextAus(tx: postgres.TransactionSql, mandant: string, wer: string): SchreibKontext {
  const abfrage = async <T>(anweisung: string, werte?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: wer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

async function als<T>(mandant: string, wer: string, fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, mandantIds: [mandant], benutzerId: wer,
      portal: 'intern', readonly: false },
    async (tx) => fn(kontextAus(tx, mandant, wer)));
}

const frei = (kreisId: string, mehr: Partial<FreigabeEingabe> = {}): FreigabeEingabe => ({
  kreisId, maske: 'RE-{jahr}-{nr:5}', ruecksetzung: 'jaehrlich',
  bezeichnung: 'Ausgangsrechnungen', bestaetigt: true, ...mehr,
});

async function grund(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(FreigabeFehler);
  return (e as FreigabeFehler).grund;
}

interface Zeile {
  jahr: number; bezeichnung: string; format_maske: string; zuruecksetzung: string | null;
  ist_platzhalter: boolean; naechste_nummer: string;
}

async function zeile(id: string): Promise<Zeile> {
  const [z] = await sql.unsafe<Zeile[]>(
    `select jahr, bezeichnung, format_maske, zuruecksetzung::text as zuruecksetzung,
            ist_platzhalter, naechste_nummer::text
       from nummernkreis where id = $1`, [id]);
  return z!;
}

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

/** Eine Rechnung festschreiben — gibt ihre Nummer zurück oder wirft, was die Datenbank sagt. */
async function festschreiben(): Promise<string> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef, portal: 'intern', readonly: false },
    async (tx) => {
      const d = alsDienst(tx);
      const id = await legeEntwurfAn(d, {
        kundeId, leistungVon: `${String(jahr)}-08-01`, leistungBis: `${String(jahr)}-08-31`,
        zahlungszielTage: 30,
      });
      await fuegePositionHinzu(d, {
        rechnungId: id, bezeichnung: 'Unterhaltsreinigung',
        menge: milliMenge(1000n), einheit: 'm2',
        einzelpreisCent: cent(100_000n), steuergruppe: 'ust_19',
        quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
      });
      await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
        [id] as never[]);
      await finalisiere(d, id);
      const [r] = await tx.unsafe<{ nummer: string }[]>(
        `select nummer from rechnung where id = $1`, [id] as never[]);
      return r!.nummer;
    });
}

beforeEach(async () => {
  f = await seed();
  chef = await superAdmin();
  const [t] = await sql.unsafe<{ jahr: number }[]>(
    `select extract(year from app.berlin_heute())::int as jahr`);
  jahr = t!.jahr;
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            telefon = '+49 30 5550100', email = 'rechnung@cse.test',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            iban = 'DE02120300000000202051'
      where id = $1`, [f.reinigung]);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'firma','Beispiel GmbH','Musterweg','7','10178','Berlin') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
});
afterAll(schliessen);

describe('(1) die Voreinstellung bestätigt', () => {
  it('vorher wird nichts festgeschrieben, danach trägt die erste Rechnung die erste Nummer', async () => {
    const kreis = await platzhalter(f.reinigung);
    await expect(festschreiben()).rejects.toThrow(/noch nicht freigegeben \(O-134\)/u);

    const ergebnis = await als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(kreis)));
    expect(ergebnis).toEqual({ jahr, ersteNummer: `RE-${String(jahr)}-00001` });
    expect(await zeile(kreis)).toMatchObject({
      jahr, bezeichnung: 'Ausgangsrechnungen', format_maske: 'RE-{jahr}-{nr:5}',
      zuruecksetzung: 'jaehrlich', ist_platzhalter: false, naechste_nummer: '1',
    });

    expect(await festschreiben()).toBe(`RE-${String(jahr)}-00001`);
    expect(await festschreiben()).toBe(`RE-${String(jahr)}-00002`);

    const protokoll = await sql.unsafe<{ vorher: Record<string, unknown>; nachher: Record<string, unknown> }[]>(
      `select vorher, nachher from audit_log
        where objekt_typ = 'nummernkreis' and objekt_id = $1
          and aktion = 'nummernkreis.freigegeben'`, [kreis]);
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]!.vorher).toMatchObject({
      ist_platzhalter: true, bezeichnung: VOREINSTELLUNG, format_maske: 'RE-{jahr}-{nr:5}',
    });
    expect(protokoll[0]!.nachher).toMatchObject({
      ist_platzhalter: false, bezeichnung: 'Ausgangsrechnungen', jahr, zuruecksetzung: 'jaehrlich',
    });
  });
});

describe('(2) angepasst', () => {
  it('fortlaufend mit eigener Maske zählt im Jahr 0', async () => {
    const kreis = await platzhalter(f.reinigung);
    const ergebnis = await als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(kreis, {
      maske: ' AR/{nr:6} ', ruecksetzung: 'nie', bezeichnung: ' Rechnungen ',
    })));
    expect(ergebnis).toEqual({ jahr: 0, ersteNummer: 'AR/000001' });
    expect(await zeile(kreis)).toMatchObject({
      jahr: 0, format_maske: 'AR/{nr:6}', zuruecksetzung: 'nie', bezeichnung: 'Rechnungen',
      ist_platzhalter: false,
    });
    expect(await festschreiben()).toBe('AR/000001');
  });

  it('ein vorgemerktes vergangenes Jahr zählt ab dem laufenden — ist es belegt, nur fortlaufend', async () => {
    const kreis = await platzhalter(f.reinigung, { jahr: jahr - 1 });
    // Der laufende Jahrgang steht schon da — geschlossen, sonst verböte ihn nummernkreis_offen_key.
    await platzhalter(f.reinigung, { geschlossen: true, bezeichnung: 'Ausgangsrechnungen alt' });
    expect(await grund(als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(kreis)))))
      .toBe('schon_vorhanden');
    expect((await zeile(kreis)).ist_platzhalter).toBe(true);

    const ergebnis = await als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(kreis, {
      maske: 'RE-{nr:5}', ruecksetzung: 'nie',
    })));
    expect(ergebnis).toEqual({ jahr: 0, ersteNummer: 'RE-00001' });
  });

  it('ein Platzhalter des Vorjahres ohne Konkurrenz rückt ins laufende Jahr', async () => {
    const kreis = await platzhalter(f.reinigung, { jahr: jahr - 1 });
    const ergebnis = await als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(kreis)));
    expect(ergebnis.jahr).toBe(jahr);
    expect(await festschreiben()).toBe(`RE-${String(jahr)}-00001`);
  });
});

describe('(3) abgewiesen mit Grund — der Kreis bleibt, wie er war', () => {
  it('Maske, Rücksetzung, Bezeichnung, Bestätigung', async () => {
    const kreis = await platzhalter(f.reinigung);
    const versuch = async (mehr: Partial<FreigabeEingabe>): Promise<string> =>
      grund(als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(kreis, mehr))));

    expect(await versuch({ maske: 'RE-{jahr}' })).toBe('maske_ungueltig');
    expect(await versuch({ maske: 'RE-{jahr}-{nr}-{nr}' })).toBe('maske_ungueltig');
    expect(await versuch({ maske: 'RE-{nr:5}' })).toBe('maske_ungueltig');
    expect(await versuch({ maske: 'RE-{jahr}-{nr:5}', ruecksetzung: 'nie' })).toBe('maske_ungueltig');
    expect(await versuch({ maske: 'RE {jahr}-{nr:5}' })).toBe('maske_ungueltig');
    expect(await versuch({ ruecksetzung: 'monatlich' })).toBe('ruecksetzung_ungueltig');
    expect(await versuch({ bezeichnung: '   ' })).toBe('bezeichnung_fehlt');
    expect(await versuch({ bezeichnung: 'x'.repeat(121) })).toBe('bezeichnung_fehlt');
    expect(await versuch({ bezeichnung: VOREINSTELLUNG })).toBe('bezeichnung_vorbehalt');
    expect(await versuch({ bestaetigt: false })).toBe('maske_unbestaetigt');

    expect(await zeile(kreis)).toMatchObject({
      ist_platzhalter: true, bezeichnung: VOREINSTELLUNG, format_maske: 'RE-{jahr}-{nr:5}', jahr,
    });
    await expect(festschreiben()).rejects.toThrow(/noch nicht freigegeben \(O-134\)/u);
  });

  it('schon freigegeben, geschlossen, fremde Gesellschaft, keine Kennung', async () => {
    const kreis = await platzhalter(f.reinigung);
    await als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(kreis)));
    expect(await grund(als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(kreis)))))
      .toBe('schon_freigegeben');

    const zu = await platzhalter(f.reinigung, { typ: 'gutschrift', geschlossen: true });
    expect(await grund(als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(zu)))))
      .toBe('geschlossen');

    const fremd = await platzhalter(f.bau, { typ: 'eingangsrechnung_beleg' });
    expect(await grund(als(f.reinigung, chef, (k) => gibKreisFrei(k, frei(fremd)))))
      .toBe('nicht_gefunden');
    expect((await zeile(fremd)).ist_platzhalter).toBe(true);
    expect(await grund(als(f.reinigung, chef, (k) => gibKreisFrei(k, frei('kein-kreis')))))
      .toBe('nicht_gefunden');
  });
});

describe('(4) die Schranken', () => {
  it('ohne nummernkreis.verwalten weder über den Dienst noch an ihm vorbei', async () => {
    const kreis = await platzhalter(f.reinigung);
    const l = await leitung(f.reinigung);
    expect(await grund(als(f.reinigung, l, (k) => gibKreisFrei(k, frei(kreis)))))
      .toBe('kein_recht');
    const e = await als(f.reinigung, l, (k) => k.schreibe(
      `select fin.nummernkreis_freigeben($1::uuid, 'RE-{jahr}-{nr:5}', 'jaehrlich', 'Rechnungen', true)`,
      [kreis])).then(() => null, (x: unknown) => x as { code?: string });
    expect(e?.code).toBe('42501');
    expect((await zeile(kreis)).ist_platzhalter).toBe(true);
  });

  it('die Grammatik der Maske hält auch die Datenbankfunktion', async () => {
    const kreis = await platzhalter(f.reinigung);
    for (const [maske, ruecksetzung] of [
      ['RE-{jahr}-{nr}-{nr}', 'jaehrlich'], ['RE-{nr:5}', 'jaehrlich'], ['RE-{jahr}-{nr:5}', 'nie'],
      ['RE-{jahr}-{nr:10}', 'jaehrlich'], ['RE-{monat}-{jahr}-{nr:3}', 'jaehrlich'],
    ] as const) {
      const e = await als(f.reinigung, chef, (k) => k.schreibe(
        `select fin.nummernkreis_freigeben($1::uuid, $2, $3, 'Rechnungen', true)`,
        [kreis, maske, ruecksetzung])).then(() => null, (x: unknown) => x as { code?: string });
      expect(e?.code, maske).toBe('23514');
    }
    expect((await zeile(kreis)).ist_platzhalter).toBe(true);
  });

  it('cse_app ändert Maske und Platzhalter nicht selbst — der Weg ist die Funktion', async () => {
    const kreis = await platzhalter(f.reinigung);
    const e = await als(f.reinigung, chef, (k) => k.schreibe(
      `update nummernkreis set ist_platzhalter = false where id = $1::uuid`, [kreis]))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(e?.code).toBe('42501');
  });

  it('die vier Verwaltungspolicies gelten nur unter dem Vorgangsmarker — kein Definer wird breiter', async () => {
    // Zwei Typen, für die kein Zieher eine Definer-Policy hat (PR 46, rechnung.test.ts).
    const kreis = await platzhalter(f.reinigung, { typ: 'angebot' });
    const anderer = await platzhalter(f.reinigung, { typ: 'leistungsnachweis' });
    const sichtbar = async (tx: postgres.TransactionSql): Promise<number> =>
      ((await tx.unsafe(`select count(*)::int as n from nummernkreis where id = $1::uuid`,
        [kreis])) as unknown as { n: number }[])[0]!.n;
    const schliesse = async (tx: postgres.TransactionSql): Promise<number> =>
      (await tx.unsafe(`update nummernkreis set geschlossen_am = app.berlin_heute() where id = $1::uuid`,
        [kreis])).count;

    // Angemeldet, aber ohne nummernkreis.verwalten — wie hinter einem Zieher.
    const l = await leitung(f.reinigung);
    expect(await alsDefiner(l, null, sichtbar)).toBe(0);
    expect(await alsDefiner(l, null, schliesse)).toBe(0);
    expect(await alsDefiner(l, anderer, schliesse)).toBe(0);
    // Unter dem Marker sieht der Definer den Kreis — die Policy ist, was ihn gewährt …
    expect(await alsDefiner(l, kreis, sichtbar)).toBe(1);
    // … und ändern darf er ohne nummernkreis.verwalten trotzdem nur den Zähler (0013).
    await expect(alsDefiner(l, kreis, schliesse)).rejects.toThrow(/nur der Zähler/u);
    expect((await zeile(kreis)).ist_platzhalter).toBe(true);
  });
});

/** Als cse_definer in der aktiven Gesellschaft, mit oder ohne Marker — und zurückgerollt. */
async function alsDefiner<T>(
  wer: string, marker: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const zurueck = Symbol('zurueck');
  let wert: { ergebnis: T } | null = null;
  try {
    await sql.begin(async (tx: postgres.TransactionSql) => {
      await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [f.reinigung]);
      await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
      await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [wer]);
      if (marker !== null) {
        await tx.unsafe(`select set_config('app.kreisverwaltung', $1, true)`, [marker]);
      }
      await tx.unsafe(`set local role cse_definer`);
      wert = { ergebnis: await fn(tx) };
      throw zurueck;
    });
  } catch (fehler) {
    if (fehler !== zurueck) throw fehler;
  }
  if (wert === null) throw new Error('alsDefiner: kein Ergebnis');
  return (wert as { ergebnis: T }).ergebnis;
}
