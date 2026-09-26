/**
 * Der Verweis aus einer Gesellschaft in die Gruppensicht — gegen echte
 * Rechte (V-253, D-745; V-243, D-737; AUT-06, D-581).
 *
 * `/buchhaltung/monatszahlen` zeigt „Gruppensicht: Finanzen der Gruppe" nur,
 * wenn `gruppenverweisOffen(kontext, '/portal/gruppe/finanzen')` es erlaubt.
 * Die Bedingung stand bis V-253 als zwei Abfragen in der Seite und hatte
 * keinen Test: ein Satz, der für jede Rolle verschwindet, wäre niemandem
 * aufgefallen, und einer, der für jede Rolle dasteht, nur dem Verweislauf der
 * Browsersuite.
 *
 * Die Regel sind dieselben zwei Fragen, die das Ziel stellt, wenn es aus
 * einer Gesellschaft aufgerufen wird: die Leserechte der Zielroute (Manifest)
 * im AKTIVEN Mandanten — so fragt `pruefeZugang` in einer Mandantensitzung —
 * und `app.darf_gruppenansicht()`, ohne die `gruppenTor` mit 404 antwortet.
 *
 * Jeder Fall unten fehlt genau eine Bedingung. Und einer hat alle: ohne ihn
 * könnte die Funktion konstant `false` liefern, und alles bliebe grün.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { gruppenverweisOffen } from '../../src/server/services/gruppe/verweis.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

const ZIEL = '/portal/gruppe/finanzen';

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `gv-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Verweisprobe', 'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1, $2, $3)`,
    [benutzer, mandant, await rolleId(rolle)]);
}

/** Bindet ein Gruppenrecht an die Rolle — in genau diesem Bereich. */
async function gruppenrecht(schluessel: string, rolle: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = $3
     on conflict do nothing`,
    [await rolleId(rolle), mandant, schluessel]);
}

/** Die Frage der Seite — in einer internen Sitzung dieses Bereichs. */
function verweis(benutzer: string, mandant: string, ziel: string = ZIEL): Promise<boolean> {
  return alsApp({
    scope: 'mandant', mandantId: mandant, mandantIds: [mandant], benutzerId: benutzer,
    portal: 'intern', readonly: true,
  }, (tx: postgres.TransactionSql) => gruppenverweisOffen({
    abfrage: async <T,>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(q, (w ?? []) as never[])) as unknown as readonly T[],
  }, ziel));
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) der Satz steht, wo das Ziel öffnet', () => {
  it('zwei interne Bereiche und gruppe.finanzen.lesen im aktiven: ja', async () => {
    const chef = await konto();
    await mitglied(chef, f.reinigung, 'leitung');
    await mitglied(chef, f.security, 'leitung');
    await gruppenrecht('gruppe.finanzen.lesen', 'leitung', f.reinigung);

    expect(await verweis(chef, f.reinigung)).toBe(true);
    // Dasselbe Recht öffnet die zweite Gruppenseite, die das Manifest daran hängt.
    expect(await verweis(chef, f.reinigung, '/portal/gruppe/rechnungen')).toBe(true);
  });
});

describe('(2) fehlt eine Bedingung, fehlt der Satz', () => {
  it('ohne gruppe.finanzen.lesen — auch wenn die Gruppenansicht offen ist', async () => {
    const chef = await konto();
    await mitglied(chef, f.reinigung, 'admin');
    await mitglied(chef, f.security, 'admin');
    // Ein anderes Gruppenrecht: die Gruppenansicht ist betretbar, die Finanzseite nicht.
    await gruppenrecht('gruppe.bericht.lesen', 'admin', f.reinigung);

    const [offen] = await alsApp({
      scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung], benutzerId: chef,
      portal: 'intern', readonly: true,
    }, (tx) => tx.unsafe<{ ok: boolean }[]>(`select app.darf_gruppenansicht() as ok`));
    expect(offen?.ok, 'die Gruppenansicht ist offen — es fehlt nur das Recht').toBe(true);
    expect(await verweis(chef, f.reinigung)).toBe(false);
  });

  it('das Recht zählt im AKTIVEN Bereich, nicht in irgendeinem', async () => {
    const chef = await konto();
    await mitglied(chef, f.reinigung, 'leitung');
    await mitglied(chef, f.security, 'leitung');
    await gruppenrecht('gruppe.finanzen.lesen', 'leitung', f.reinigung);

    // Aus der Security heraus fragt das Tor das Recht in der Security — dort fehlt es.
    expect(await verweis(chef, f.security)).toBe(false);
  });

  it('ohne Gruppenansicht — ein Bereich allein, auch mit dem Recht', async () => {
    const chef = await konto();
    await mitglied(chef, f.reinigung, 'admin');
    await gruppenrecht('gruppe.finanzen.lesen', 'admin', f.reinigung);

    const [recht] = await alsApp({
      scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung], benutzerId: chef,
      portal: 'intern', readonly: true,
    }, (tx) => tx.unsafe<{ ok: boolean }[]>(
      `select app.hat_recht('gruppe.finanzen.lesen', app.aktiver_mandant()) as ok`));
    expect(recht?.ok, 'das Recht gilt — es fehlt nur die Gruppenansicht').toBe(true);
    expect(await verweis(chef, f.reinigung)).toBe(false);
  });
});

describe('(3) die Rechte kommen aus dem Manifest, nicht aus der Seite', () => {
  it('ein Ziel mit zwei Leserechten verlangt beide', async () => {
    const chef = await konto();
    await mitglied(chef, f.reinigung, 'leitung');
    await mitglied(chef, f.security, 'leitung');
    await gruppenrecht('gruppe.finanzen.lesen', 'leitung', f.reinigung);

    // `/portal/gruppe/berichte/umsatz` verlangt gruppe.bericht.lesen UND gruppe.finanzen.lesen.
    expect(await verweis(chef, f.reinigung, '/portal/gruppe/berichte/umsatz')).toBe(false);
    await gruppenrecht('gruppe.bericht.lesen', 'leitung', f.reinigung);
    expect(await verweis(chef, f.reinigung, '/portal/gruppe/berichte/umsatz')).toBe(true);
  });

  it('keine Gruppenroute, oder eine, die es nicht gibt: nie ein Verweis', async () => {
    const chef = await konto();
    await mitglied(chef, f.reinigung, 'leitung');
    await mitglied(chef, f.security, 'leitung');
    await gruppenrecht('gruppe.finanzen.lesen', 'leitung', f.reinigung);

    expect(await verweis(chef, f.reinigung, '/portal/gruppe/gibt-es-nicht/tief/unten'))
      .toBe(false);
    expect(await verweis(chef, f.reinigung, '/portal/reinigung/buchhaltung/monatszahlen'))
      .toBe(false);
  });
});
