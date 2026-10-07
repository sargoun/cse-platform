/**
 * **Den Basiszinssatz nach § 247 BGB eintragen** (V-299, O-358, FIN-15,
 * D-809, 0125).
 *
 * `basiszinssatz` lasen Mahnlauf und Wächter; geschrieben hat ihn bis hierher
 * niemand. Geprüft wird an echtem Postgres:
 *
 *  1. die Super-Administration trägt ein Halbjahr ein — mit Ende, und die
 *     Auditzeile nennt den neuen Wert; der Wächter findet die kommende Hälfte
 *     danach gedeckt;
 *  2. dasselbe Halbjahr noch einmal korrigiert, mit altem Wert im Protokoll —
 *     und unverändert, wenn sich nichts ändert;
 *  3. eine offene Zeile davor endet am Tag vor dem neuen Halbjahr;
 *  4. eine Administration ohne Super-Administration scheitert im Dienst und
 *     an der Policy (0125) — auch am Dienst vorbei.
 *
 * Die Tabelle ist global und überlebt `seed()`; die Datei räumt sie vorher
 * und nachher (wie `mahnung.test.ts`).
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  BasiszinsFehler, leseDeckung, pruefeHalbjahr, setzeBasiszinssatz,
} from '../../src/server/services/finanz/mahnung/basiszinssatz.js';
import { leereRegister } from '../../src/server/jobs/registry.js';
import { registriereBasiszinssatzWaechter } from '../../src/server/jobs/basiszinssatz.js';

let f: Fixtur;
/** Super-Administration: hält `system.referenzdaten_verwalten` global. */
let chef = '';
/** Eine Administration der Reinigung — keine Super-Administration. */
let admin = '';

async function konto(email: string, global: boolean): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, $2, 'aktiv',
             case when $3 then (select id from rolle
                                 where schluessel = 'super_admin' and mandant_id is null) end)`,
    [u!.id, email, global]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null),
             current_date - 1)`,
    [u!.id, f.reinigung]);
  return u!.id;
}

function kontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function als<T>(benutzerId: string, fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp({
    scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
    benutzerId, portal: 'intern', readonly: false, aal: 'aal2',
  }, (tx) => fn(kontext(tx, benutzerId))) as Promise<T>;
}

interface Zeile { von: string; bis: string | null; satz_bp: number; quelle: string }

async function zeilen(): Promise<Zeile[]> {
  return sql.unsafe<Zeile[]>(
    `select gueltig_von::text as von, gueltig_bis::text as bis, satz_bp, quelle
       from basiszinssatz order by gueltig_von`);
}

async function protokoll(): Promise<{ vorher: unknown; nachher: { satz_bp: number } }[]> {
  return sql.unsafe(
    `select vorher, nachher from audit_log where aktion = 'basiszinssatz.gesetzt'
      order by erstellt_am, id`);
}

/** Die kommende Hälfte, wie der Wächter sie rechnet — aus der Datenbank. */
let naechste = { jahr: '', haelfte: '' };

beforeAll(async () => {
  f = await seed();
  chef = await konto('basiszins-chef@test.invalid', true);
  admin = await konto('basiszins-admin@test.invalid', false);
  const [n] = await sql.unsafe<{ ab: string }[]>(
    `select (case when extract(month from app.berlin_heute()) <= 6
                  then make_date(extract(year from app.berlin_heute())::int, 7, 1)
                  else make_date(extract(year from app.berlin_heute())::int + 1, 1, 1)
             end)::text as ab`);
  naechste = { jahr: n!.ab.slice(0, 4), haelfte: n!.ab.slice(5, 7) === '01' ? '1' : '2' };
});
beforeEach(async () => { await sql.unsafe(`delete from basiszinssatz`); });
afterAll(async () => {
  await sql.unsafe(`delete from basiszinssatz`);
  await schliessen();
});

describe('V-299 — der Basiszinssatz', () => {
  it('eingetragen mit Ende, protokolliert — und der Wächter findet die kommende Hälfte', async () => {
    leereRegister();
    const waechter = registriereBasiszinssatzWaechter(sql);
    await expect(waechter.ausfuehren({ mandantId: null, laufId: 'vorher', versuch: 1 }))
      .rejects.toThrow(/deckt kein Basiszinssatz/u);

    const halbjahr = pruefeHalbjahr(naechste.jahr, naechste.haelfte, Number(naechste.jahr));
    expect(await als(chef, (k) => setzeBasiszinssatz(k, {
      halbjahr, satzBp: 127, quelle: 'Deutsche Bundesbank',
    }))).toBe('eingetragen');
    expect(await zeilen()).toEqual([
      { von: halbjahr.von, bis: halbjahr.bis, satz_bp: 127, quelle: 'Deutsche Bundesbank' }]);
    const p = await protokoll();
    expect(p).toHaveLength(1);
    expect(p[0]!.vorher).toBeNull();
    expect(p[0]!.nachher.satz_bp).toBe(127);

    expect(await waechter.ausfuehren({ mandantId: null, laufId: 'nachher', versuch: 1 }))
      .toEqual({ ab: halbjahr.von, satzBp: 127 });
    expect((await als(chef, (k) => leseDeckung(k))).naechste).toBe(127);
  });

  it('dasselbe Halbjahr korrigiert — alter Wert im Protokoll; ohne Änderung unverändert', async () => {
    const halbjahr = pruefeHalbjahr('2026', '1', 2027);
    await als(chef, (k) => setzeBasiszinssatz(k, { halbjahr, satzBp: 127, quelle: 'Bundesbank' }));
    expect(await als(chef, (k) => setzeBasiszinssatz(k, {
      halbjahr, satzBp: -88, quelle: 'Bundesbank',
    }))).toBe('korrigiert');
    expect((await zeilen()).map((z) => z.satz_bp)).toEqual([-88]);
    const p = await protokoll();
    expect(p.at(-1)!.vorher).toEqual({ satz_bp: 127, quelle: 'Bundesbank' });
    const anzahl = p.length;
    expect(await als(chef, (k) => setzeBasiszinssatz(k, {
      halbjahr, satzBp: -88, quelle: 'Bundesbank',
    }))).toBe('unveraendert');
    expect(await protokoll()).toHaveLength(anzahl);
  });

  it('eine offene Zeile davor endet am Tag vor dem neuen Halbjahr', async () => {
    await sql.unsafe(`insert into basiszinssatz (gueltig_von, satz_bp) values ('2025-07-01', 127)`);
    await als(chef, (k) => setzeBasiszinssatz(k, {
      halbjahr: pruefeHalbjahr('2026', '1', 2027), satzBp: 127, quelle: 'Bundesbank',
    }));
    expect((await zeilen()).map((z) => [z.von, z.bis])).toEqual([
      ['2025-07-01', '2025-12-31'], ['2026-01-01', '2026-06-30']]);
  });

  it('eine Zeile, die mitten im Halbjahr beginnt, überlappt — und nichts wird geschrieben', async () => {
    await sql.unsafe(`insert into basiszinssatz (gueltig_von, satz_bp) values ('2026-03-01', 50)`);
    await expect(als(chef, (k) => setzeBasiszinssatz(k, {
      halbjahr: pruefeHalbjahr('2026', '1', 2027), satzBp: 127, quelle: 'Bundesbank',
    }))).rejects.toMatchObject({ grund: 'ueberlappt' });
    expect((await zeilen()).map((z) => z.von)).toEqual(['2026-03-01']);
  });

  it('eine Administration ist keine Super-Administration — im Dienst und an der Policy', async () => {
    await expect(als(admin, (k) => setzeBasiszinssatz(k, {
      halbjahr: pruefeHalbjahr('2026', '2', 2027), satzBp: 127, quelle: 'Bundesbank',
    }))).rejects.toBeInstanceOf(BasiszinsFehler);
    await expect(als(admin, (k) => k.schreibe(
      `insert into basiszinssatz (gueltig_von, gueltig_bis, satz_bp)
       values ('2026-07-01', '2026-12-31', 127)`))).rejects.toThrow(/row-level security/u);
    expect(await zeilen()).toEqual([]);
  });
});
