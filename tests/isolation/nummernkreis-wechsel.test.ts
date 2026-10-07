/**
 * Der Jahreswechsel eines Nummernkreises — den Nachfolgekreis eröffnen, gegen
 * echte Policies, Rechte und Auslöser (FIN-03, LEG-01, V-284, O-352, D-848).
 *
 * **Der Befund.** Am 1. Januar weist die Festschreibung jede Rechnung eines
 * jährlich zurückgesetzten Kreises ab („es fehlt der Nachfolgekreis", 0077);
 * eröffnen konnte ihn nur eine Migration — cse_app darf auf `nummernkreis`
 * weder anlegen noch schliessen.
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Mit `nummernkreis.verwalten` und bestätigter Maske: der Vorgänger ist
 *     heute geschlossen, der Nachfolger trägt das neue Jahr, dieselbe Maske,
 *     den Zähler 1, den Vorgänger und als `genesis_hash` dessen letzten Hash;
 *     die Bezeichnung nennt das neue Jahr; eine Protokollzeile steht da.
 *  2. Hat der Vorgänger nie festgeschrieben, übernimmt der Nachfolger dessen
 *     eigenen `genesis_hash` — die Kette reisst auch dann nicht.
 *  3. Abgewiesen mit Grund: im laufenden Jahr, fortlaufend, schon geschlossen,
 *     Maske unbestätigt, Jahr schon belegt, fremde Gesellschaft — und ein
 *     Platzhalter, der freigegeben statt fortgesetzt wird, auch am Dienst
 *     vorbei.
 *  4. Ohne `nummernkreis.verwalten` geht es nicht — weder über den Dienst
 *     noch am Dienst vorbei über die Datenbankfunktion.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  eroeffneNachfolgekreis, WechselFehler,
} from '../../src/server/services/finanz/nummernkreis-wechsel.js';

let f: Fixtur;
let chef: string;
let jahr: number;
const zufall = (): string => String(Math.random()).slice(2, 10);
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

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

/** Ein jährlicher Kreis `eingangsrechnung_beleg` eines Jahres — wie Seed oder Migration ihn anlegen. */
async function kreis(
  mandant: string, j: number,
  mehr: { zuruecksetzung?: 'jaehrlich' | 'nie'; letzter?: string | null; genesis?: string | null;
          platzhalter?: boolean; typ?: string; geschlossen?: boolean } = {},
): Promise<string> {
  const jaehrlich = (mehr.zuruecksetzung ?? 'jaehrlich') === 'jaehrlich';
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, naechste_nummer, letzter_hash, genesis_hash, geoeffnet_am,
        geschlossen_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, $2::nummernkreis_typ, null, $3, $4, true, $5, $6::nummernkreis_zuruecksetzung,
             $7, $8, $9, $10::date, case when $12 then $10::date end, $11, 'system', 'job:test')
     returning id`,
    [mandant, mehr.typ ?? 'eingangsrechnung_beleg', jaehrlich ? j : 0,
      jaehrlich ? `Eingangsbelege ${String(j)}` : 'Eingangsbelege',
      jaehrlich ? 'EB-{jahr}-{nr:5}' : 'EB-{nr:6}', jaehrlich ? 'jaehrlich' : 'nie',
      mehr.letzter === undefined ? 43 : 1, mehr.letzter === undefined ? HASH_A : mehr.letzter,
      mehr.genesis ?? null, `${String(jaehrlich ? j : 2025)}-01-01`, mehr.platzhalter ?? false,
      mehr.geschlossen ?? false]);
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

async function grund(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(WechselFehler);
  return (e as WechselFehler).grund;
}

interface Zeile {
  jahr: number; bezeichnung: string; format_maske: string; naechste_nummer: string;
  genesis_hash: string | null; vorgaenger: string | null; geschlossen: string | null;
  geoeffnet: string; ist_platzhalter: boolean; zuruecksetzung: string; lueckenlos: boolean;
}

async function zeile(id: string): Promise<Zeile> {
  const [z] = await sql.unsafe<Zeile[]>(
    `select jahr, bezeichnung, format_maske, naechste_nummer::text, genesis_hash,
            vorgaenger_nummernkreis_id::text as vorgaenger,
            to_char(geschlossen_am, 'YYYY-MM-DD') as geschlossen,
            to_char(geoeffnet_am, 'YYYY-MM-DD') as geoeffnet, ist_platzhalter,
            zuruecksetzung::text as zuruecksetzung, lueckenlos
       from nummernkreis where id = $1`, [id]);
  return z!;
}

let heute: string;

beforeEach(async () => {
  f = await seed();
  chef = await superAdmin();
  const [t] = await sql.unsafe<{ heute: string; jahr: number }[]>(
    `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as heute,
            extract(year from app.berlin_heute())::int as jahr`);
  heute = t!.heute;
  jahr = t!.jahr;
});
afterAll(schliessen);

describe('(1) der Jahreswechsel', () => {
  it('schliesst den Vorgänger und eröffnet den Nachfolger mit dessen letztem Hash', async () => {
    const alt = await kreis(f.reinigung, jahr - 1);
    const neu = await als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, alt, true));
    expect(neu.jahr).toBe(jahr);

    expect(await zeile(alt)).toMatchObject({ geschlossen: heute });
    expect(await zeile(neu.id)).toMatchObject({
      jahr, bezeichnung: `Eingangsbelege ${String(jahr)}`, format_maske: 'EB-{jahr}-{nr:5}',
      naechste_nummer: '1', genesis_hash: HASH_A, vorgaenger: alt, geschlossen: null,
      geoeffnet: heute, ist_platzhalter: false, zuruecksetzung: 'jaehrlich', lueckenlos: true,
    });
    const protokoll = await sql.unsafe<{ nachher: Record<string, unknown> }[]>(
      `select nachher from audit_log
        where objekt_typ = 'nummernkreis' and objekt_id = $1
          and aktion = 'nummernkreis.nachfolger_eroeffnet'`, [neu.id]);
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]!.nachher).toMatchObject({
      vorgaenger: alt, vorgaenger_jahr: jahr - 1, jahr, genesis_hash: HASH_A,
    });
  });

  it('(2) ohne eigene Festschreibung trägt der Nachfolger den genesis_hash des Vorgängers', async () => {
    const alt = await kreis(f.reinigung, jahr - 1, { letzter: null, genesis: HASH_B });
    const neu = await als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, alt, true));
    expect((await zeile(neu.id)).genesis_hash).toBe(HASH_B);
  });
});

describe('(3) abgewiesen mit Grund', () => {
  it('im laufenden Jahr, fortlaufend, unbestätigt, schon geschlossen', async () => {
    const laufend = await kreis(f.reinigung, jahr, { typ: 'kassenbuch' });
    expect(await grund(als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, laufend, true))))
      .toBe('laeuft_noch');
    const fortlaufend = await kreis(f.reinigung, 0, { zuruecksetzung: 'nie', typ: 'mahnung' });
    expect(await grund(als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, fortlaufend, true))))
      .toBe('fortlaufend');

    const alt = await kreis(f.reinigung, jahr - 1);
    expect(await grund(als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, alt, false))))
      .toBe('maske_unbestaetigt');
    expect((await zeile(alt)).geschlossen).toBeNull();
    await als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, alt, true));
    expect(await grund(als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, alt, true))))
      .toBe('geschlossen');
  });

  it('ein Platzhalter wird freigegeben, nicht fortgesetzt — auch nicht am Dienst vorbei', async () => {
    const vorgemerkt = await kreis(f.reinigung, jahr - 1,
      { typ: 'angebot', platzhalter: true, letzter: null });
    expect(await grund(als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, vorgemerkt, true))))
      .toBe('platzhalter');
    const e = await als(f.reinigung, chef, (k) => k.schreibe(
      `select fin.nummernkreis_nachfolger_eroeffnen($1::uuid, true)`, [vorgemerkt]))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(e?.code).toBe('23514');
    expect((await zeile(vorgemerkt)).geschlossen).toBeNull();
  });

  it('das neue Jahr schon belegt, eine fremde Gesellschaft, keine Kennung', async () => {
    const alt = await kreis(f.reinigung, jahr - 2);
    // Neben dem offenen alten Kreis kann der Jahrgang nur geschlossen stehen —
    // zwei offene desselben Geltungsbereichs verbietet nummernkreis_offen_key.
    await kreis(f.reinigung, jahr, { letzter: null, geschlossen: true });
    expect(await grund(als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, alt, true))))
      .toBe('schon_vorhanden');
    expect((await zeile(alt)).geschlossen).toBeNull();

    const fremd = await kreis(f.bau, jahr - 1);
    expect(await grund(als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, fremd, true))))
      .toBe('nicht_gefunden');
    expect((await zeile(fremd)).geschlossen).toBeNull();
    expect(await grund(als(f.reinigung, chef, (k) => eroeffneNachfolgekreis(k, 'kein-kreis', true))))
      .toBe('nicht_gefunden');
  });
});

describe('(4) ohne nummernkreis.verwalten', () => {
  it('weist der Dienst ab — und die Datenbankfunktion am Dienst vorbei auch', async () => {
    const alt = await kreis(f.reinigung, jahr - 1);
    const l = await leitung(f.reinigung);
    expect(await grund(als(f.reinigung, l, (k) => eroeffneNachfolgekreis(k, alt, true))))
      .toBe('kein_recht');
    const e = await als(f.reinigung, l, (k) => k.schreibe(
      `select fin.nummernkreis_nachfolger_eroeffnen($1::uuid, true)`, [alt]))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(e?.code).toBe('42501');
    expect((await zeile(alt)).geschlossen).toBeNull();
  });

  it('und cse_app schliesst oder legt keinen Kreis an — der Weg ist die Funktion', async () => {
    const alt = await kreis(f.reinigung, jahr - 1);
    const e = await als(f.reinigung, chef, (k) => k.schreibe(
      `update nummernkreis set geschlossen_am = app.berlin_heute() where id = $1::uuid`, [alt]))
      .then(() => null, (x: unknown) => x as { code?: string });
    expect(e?.code).toBe('42501');
  });
});
