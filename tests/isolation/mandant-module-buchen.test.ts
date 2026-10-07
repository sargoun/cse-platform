/**
 * **Die Modulbuchung einer Gesellschaft eintragen** (V-298, O-355, D-809,
 * 0502, D-377).
 *
 * `mandant.module` und `module_gepflegt` schrieb bis 0502 nur der Seed. Jetzt
 * gibt es genau einen Weg — `app.mandant_module_buchen` —, und gemessen wird
 * vor allem, was NICHT geht: ohne Super-Administration (auch mit gebundenem
 * Recht), ohne Recht, ohne zweiten Faktor, in der Gruppenansicht, mit einem
 * Modul, das kein Gewerk ist, am Weg vorbei per UPDATE. Dazu: wer eingetragen
 * hat, steht an der Zeile, und das Protokoll hält vorher und nachher fest.
 *
 * Die Datei legt sich eine EIGENE Gesellschaft an: die Buchung der vier aus
 * der Fixtur trägt den Modulriegel anderer Dateien.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  ModulbuchungFehler, bucheModule, gewerkeAusFormular, leseModulbuchung,
} from '../../src/server/services/system/mandant-module.js';

let gesellschaft = '';
/** Super-Administration: hält `system.module_zuweisen` global. */
let chef = '';
/** Eine Administration dieser Gesellschaft — ohne das Recht. */
let admin = '';

async function konto(email: string, global = false): Promise<string> {
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
    [u!.id, gesellschaft]);
  return u!.id;
}

function kontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: gesellschaft, mandantIds: [gesellschaft],
    abfrage, schreibe: abfrage,
  };
}

async function als<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
  optionen: { aal?: 'aal1' | 'aal2'; scope?: 'mandant' | 'gruppe' } = {},
): Promise<T> {
  return alsApp({
    scope: optionen.scope ?? 'mandant', mandantId: gesellschaft, mandantIds: [gesellschaft],
    benutzerId, portal: 'intern', readonly: false, aal: optionen.aal ?? 'aal2',
  }, (tx) => fn(kontext(tx, benutzerId))) as Promise<T>;
}

async function grund(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (fehler) {
    if (fehler instanceof ModulbuchungFehler) return fehler.grund;
    throw fehler;
  }
  return 'kein_fehler';
}

interface Stand {
  module: string[];
  module_gepflegt: boolean;
  module_eingetragen_am: Date | null;
  module_eingetragen_von: string | null;
}

async function stand(): Promise<Stand> {
  const [z] = await sql.unsafe<Stand[]>(
    `select module, module_gepflegt, module_eingetragen_am, module_eingetragen_von
       from mandant where id = $1`, [gesellschaft]);
  return z!;
}

async function protokollzeilen(): Promise<number> {
  const [z] = await sql.unsafe<{ n: number }[]>(
    `select count(*)::int as n from audit_log
      where aktion = 'mandant.update' and objekt_id = $1::text
        and 'module' = any (geaendert_felder)`, [gesellschaft]);
  return z!.n;
}

/** Bindet `system.module_zuweisen` an die Rolle `admin` in DIESER Gesellschaft. */
async function mitAdminRecht<T>(fn: () => Promise<T>): Promise<T> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'admin' and mandant_id is null),
             (select id from berechtigung where schluessel = 'system.module_zuweisen'),
             $1, true)
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [gesellschaft]);
  try {
    return await fn();
  } finally {
    await sql.unsafe(
      `update rolle_berechtigung set gewaehrt = false
        where rolle_id = (select id from rolle where schluessel = 'admin' and mandant_id is null)
          and berechtigung_id = (select id from berechtigung
                                  where schluessel = 'system.module_zuweisen')
          and mandant_id = $1`, [gesellschaft]);
  }
}

beforeAll(async () => {
  await seed();
  const [m] = await sql.unsafe<{ id: string }[]>(
    `insert into mandant (slug, name, firma, module, module_gepflegt)
     values ('modultest', 'Modultest', 'Modultest GmbH', '{reinigung}', true)
     on conflict (slug) do update set module = '{reinigung}', module_gepflegt = true,
                                      module_eingetragen_am = null, module_eingetragen_von = null
     returning id`);
  gesellschaft = m!.id;
  chef = await konto('modul-chef@test.invalid', true);
  admin = await konto('modul-admin@test.invalid');
});
afterAll(schliessen);

describe('(1) die Super-Administration trägt ein — und das Protokoll hält es fest', () => {
  it('der Seed-Stand trägt keinen Eintrag', async () => {
    const s = await stand();
    expect(s.module_eingetragen_am).toBeNull();
    expect(await als(chef, (k) => leseModulbuchung(k, gesellschaft)))
      .toMatchObject({ module: ['reinigung'], gepflegt: true, eingetragenAm: null });
  });

  it('zwei Gewerke, doppelt und ungeordnet geschickt — gespeichert einmal und geordnet', async () => {
    const vorher = await protokollzeilen();
    const r = await als(chef, (k) =>
      bucheModule(k, gewerkeAusFormular(['security', 'reinigung', 'security'])));
    expect(r).toEqual({ geaendert: true });
    const s = await stand();
    expect(s.module).toEqual(['reinigung', 'security']);
    expect(s.module_gepflegt).toBe(true);
    expect(s.module_eingetragen_am).not.toBeNull();
    expect(s.module_eingetragen_von).toBe(chef);
    expect(await protokollzeilen()).toBe(vorher + 1);
    const lesen = await als(chef, (k) => leseModulbuchung(k, gesellschaft));
    expect(lesen?.eingetragenAm).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/u);
  });

  it('dieselbe Buchung noch einmal: unverändert, keine zweite Protokollzeile', async () => {
    const vorher = await protokollzeilen();
    expect(await als(chef, (k) => bucheModule(k, ['reinigung', 'security'])))
      .toEqual({ geaendert: false });
    expect(await protokollzeilen()).toBe(vorher);
  });

  it('keines heißt „kein Gewerk" — die Liste gilt und ist leer', async () => {
    expect(await als(chef, (k) => bucheModule(k, []))).toEqual({ geaendert: true });
    const s = await stand();
    expect(s.module).toEqual([]);
    expect(s.module_gepflegt).toBe(true);
  });

  it('ein Seed-Stand wird durch dieselbe Liste zur Eintragung', async () => {
    await sql.unsafe(
      `update mandant set module = '{bau}', module_gepflegt = true,
              module_eingetragen_am = null, module_eingetragen_von = null
        where id = $1`, [gesellschaft]);
    expect(await als(chef, (k) => bucheModule(k, ['bau']))).toEqual({ geaendert: true });
    expect((await stand()).module_eingetragen_von).toBe(chef);
  });
});

describe('(2) was nicht geht', () => {
  it('eine Administration MIT gebundenem Recht ist keine Super-Administration', async () => {
    const vorher = await stand();
    expect(await mitAdminRecht(() => grund(als(admin, (k) => bucheModule(k, ['security'])))))
      .toBe('nur_super_admin');
    expect((await stand()).module).toEqual(vorher.module);
  });

  it('ohne system.module_zuweisen nicht', async () => {
    expect(await grund(als(admin, (k) => bucheModule(k, ['security'])))).toBe('nicht_erlaubt');
  });

  it('ohne zweiten Faktor nicht (K-15)', async () => {
    expect(await grund(als(chef, (k) => bucheModule(k, ['security']), { aal: 'aal1' })))
      .toBe('nicht_erlaubt');
  });

  it('in der Gruppenansicht nicht (Invariante 10)', async () => {
    expect(await grund(als(chef, (k) => bucheModule(k, ['security']), { scope: 'gruppe' })))
      .toBe('nicht_erlaubt');
  });

  it('ein Modul, das kein Gewerk ist, weist schon der Dienst ab — und die Datenbank auch', () => {
    expect(() => gewerkeAusFormular(['crm'])).toThrow(ModulbuchungFehler);
    return expect(grund(als(chef, (k) => bucheModule(k, ['crm']))))
      .resolves.toBe('unbekanntes_gewerk');
  });

  it('am Weg vorbei per UPDATE nicht — cse_app schreibt mandant nicht', async () => {
    await expect(als(chef, (k) => k.schreibe(
      `update mandant set module = '{reinigung,security,bau}' where id = $1`, [gesellschaft])))
      .rejects.toThrow(/permission denied/u);
  });
});
