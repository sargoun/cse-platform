/**
 * **Den Sicherheitskontakt der Plattform pflegen** (V-392, O-35, D-809, 0503,
 * RFC 9116).
 *
 * `sicherheit.kontakt` setzte bis 0503 nur SQL. Geprüft wird an echtem
 * Postgres: die Super-Administration trägt ein, die Datei entsteht daraus,
 * Leer schaltet sie wieder ab, das Protokoll nennt vorher und nachher — und
 * was nicht geht: keine Super-Administration (auch mit gebundenem Recht),
 * ohne Recht, eine Adresse, die keine URI ist, und der Definer an einer
 * fremden Zeile von `plattform_einstellung`.
 *
 * Die Zeilen sind plattformweit und überleben `seed()`; die Datei räumt sie
 * vorher und nachher.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  SicherheitskontaktFehler, leseSicherheitskontakt, setzeSicherheitskontakt,
} from '../../src/server/services/inhalt/sicherheitskontakt.js';
import { sicherheitTxt } from '../../src/server/services/inhalt/sicherheit-txt.js';

let f: Fixtur;
let chef = '';
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
    [u!.id, f.operations]);
  return u!.id;
}

function kontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.operations, mandantIds: [f.operations],
    abfrage, schreibe: abfrage,
  };
}

async function als<T>(benutzerId: string, fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp({
    scope: 'mandant', mandantId: f.operations, mandantIds: [f.operations],
    benutzerId, portal: 'intern', readonly: false, aal: 'aal2',
  }, (tx) => fn(kontext(tx, benutzerId))) as Promise<T>;
}

async function grund(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (fehler) {
    if (fehler instanceof SicherheitskontaktFehler) return fehler.grund;
    throw fehler;
  }
  return 'kein_fehler';
}

async function protokoll(): Promise<number> {
  const [z] = await sql.unsafe<{ n: number }[]>(
    `select count(*)::int as n from audit_log
      where aktion = 'plattform.sicherheitskontakt_gesetzt'`);
  return z!.n;
}

async function mitAdminRecht<T>(fn: () => Promise<T>): Promise<T> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'admin' and mandant_id is null),
             (select id from berechtigung where schluessel = 'system.einstellung_verwalten'),
             $1, true)
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [f.operations]);
  try {
    return await fn();
  } finally {
    await sql.unsafe(
      `update rolle_berechtigung set gewaehrt = false
        where rolle_id = (select id from rolle where schluessel = 'admin' and mandant_id is null)
          and berechtigung_id = (select id from berechtigung
                                  where schluessel = 'system.einstellung_verwalten')
          and mandant_id = $1`, [f.operations]);
  }
}

const RAEUMEN = `delete from plattform_einstellung
                  where schluessel in ('sicherheit.kontakt', 'sicherheit.richtlinie')`;

beforeAll(async () => {
  f = await seed();
  chef = await konto('kontakt-chef@test.invalid', true);
  admin = await konto('kontakt-admin@test.invalid', false);
});
beforeEach(async () => { await sql.unsafe(RAEUMEN); });
afterAll(async () => {
  await sql.unsafe(RAEUMEN);
  await schliessen();
});

describe('V-392 — der Sicherheitskontakt', () => {
  it('ohne Eintrag gibt es keine Datei', async () => {
    const k = await als(chef, (x) => leseSicherheitskontakt(x));
    expect(k).toEqual({ kontakt: null, richtlinie: null });
    expect(sicherheitTxt(k.kontakt === null ? null : { kontakt: k.kontakt },
      'https://cse.test', new Date())).toBeNull();
  });

  it('die Super-Administration trägt ein — die Datei entsteht, das Protokoll hält es fest', async () => {
    const vorher = await protokoll();
    expect(await als(chef, (x) => setzeSicherheitskontakt(x, {
      kontakt: ' mailto:security@cse.test ', richtlinie: 'https://cse.test/sicherheit',
    }))).toEqual({ geaendert: true });
    const k = await als(chef, (x) => leseSicherheitskontakt(x));
    expect(k).toEqual({ kontakt: 'mailto:security@cse.test', richtlinie: 'https://cse.test/sicherheit' });
    const datei = sicherheitTxt({ kontakt: k.kontakt!, richtlinie: k.richtlinie },
      'https://cse.test', new Date());
    expect(datei).toContain('Contact: mailto:security@cse.test');
    expect(datei).toContain('Policy: https://cse.test/sicherheit');
    expect(await protokoll()).toBe(vorher + 1);

    const [z] = await sql.unsafe<{ ist_vorlaeufig: boolean; erstellt_von: string }[]>(
      `select ist_vorlaeufig, erstellt_von from plattform_einstellung
        where schluessel = 'sicherheit.kontakt'`);
    expect(z).toEqual({ ist_vorlaeufig: false, erstellt_von: chef });
  });

  it('dasselbe noch einmal: unverändert, keine zweite Protokollzeile', async () => {
    const eingabe = { kontakt: 'mailto:security@cse.test', richtlinie: '' };
    await als(chef, (x) => setzeSicherheitskontakt(x, eingabe));
    const vorher = await protokoll();
    expect(await als(chef, (x) => setzeSicherheitskontakt(x, eingabe)))
      .toEqual({ geaendert: false });
    expect(await protokoll()).toBe(vorher);
  });

  /*
   * Copilot-Befund auf PR #41: zwei gleichzeitige Sätze lasen denselben
   * Vorher-Stand, und das Protokoll des zweiten nannte nicht den Kontakt, den
   * er ersetzt hat. Die Sperre im Definer lässt den zweiten warten.
   */
  it('zwei gleichzeitige Sätze: der zweite nennt im Protokoll den, den er ersetzt', async () => {
    const sperren = async (gewaehrt: boolean): Promise<number> => {
      const [z] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from pg_locks
          where locktype = 'advisory' and granted = $1
            and database = (select oid from pg_database where datname = current_database())`,
        [gewaehrt]);
      return z!.n;
    };
    const bis = async (bedingung: () => Promise<boolean>): Promise<void> => {
      for (let i = 0; i < 250; i += 1) {
        if (await bedingung()) return;
        await new Promise((r) => { setTimeout(r, 20); });
      }
      throw new Error('Die Sperre stellte sich nicht ein.');
    };
    let freigeben!: () => void;
    const halt = new Promise<void>((r) => { freigeben = r; });
    const erster = als(chef, async (x) => {
      const r = await setzeSicherheitskontakt(x, { kontakt: 'mailto:a@cse.test', richtlinie: '' });
      await halt;
      return r;
    });
    await bis(async () => (await sperren(true)) >= 1);
    const zweiter = als(chef, (x) => setzeSicherheitskontakt(x, {
      kontakt: 'mailto:b@cse.test', richtlinie: '',
    }));
    await bis(async () => (await sperren(false)) >= 1);
    freigeben();
    expect(await erster).toEqual({ geaendert: true });
    expect(await zweiter).toEqual({ geaendert: true });
    const [z] = await sql.unsafe<{ vorher: Record<string, unknown> }[]>(
      `select vorher from audit_log where aktion = 'plattform.sicherheitskontakt_gesetzt'
        order by erstellt_am desc, id desc limit 1`);
    expect(z!.vorher['sicherheit.kontakt']).toBe('mailto:a@cse.test');
  });

  it('leer heißt kein Postfach — die Datei verschwindet wieder', async () => {
    await als(chef, (x) => setzeSicherheitskontakt(x, {
      kontakt: 'tel:+49 30 1234567', richtlinie: '',
    }));
    expect((await als(chef, (x) => leseSicherheitskontakt(x))).kontakt).toBe('tel:+49 30 1234567');
    expect(await als(chef, (x) => setzeSicherheitskontakt(x, { kontakt: '', richtlinie: '' })))
      .toEqual({ geaendert: true });
    expect(await als(chef, (x) => leseSicherheitskontakt(x)))
      .toEqual({ kontakt: null, richtlinie: null });
  });

  it('eine nackte Adresse ist keine URI — auch nicht am Dienst vorbei', async () => {
    expect(await grund(als(chef, (x) => setzeSicherheitskontakt(x, {
      kontakt: 'security@cse.test', richtlinie: '',
    })))).toBe('kontakt_ungueltig');
    await expect(als(chef, (x) => x.schreibe(
      `select app.sicherheitskontakt_setzen('security@cse.test', null)`)))
      .rejects.toMatchObject({ code: '22023' });
    await expect(als(chef, (x) => x.schreibe(
      `select app.sicherheitskontakt_setzen('mailto:a@b.de', 'http://unsicher.test')`)))
      .rejects.toMatchObject({ code: '22023' });
  });

  it('eine Administration mit gebundenem Recht ist keine Super-Administration', async () => {
    expect(await mitAdminRecht(() => grund(als(admin, (x) => setzeSicherheitskontakt(x, {
      kontakt: 'mailto:umgeleitet@fremd.test', richtlinie: '',
    }))))).toBe('nur_super_admin');
    expect(await grund(als(admin, (x) => setzeSicherheitskontakt(x, {
      kontakt: 'mailto:umgeleitet@fremd.test', richtlinie: '',
    })))).toBe('nicht_erlaubt');
    expect((await als(chef, (x) => leseSicherheitskontakt(x))).kontakt).toBeNull();
  });

  it('cse_app schreibt plattform_einstellung nicht — und der Definer keine fremde Zeile', async () => {
    await expect(als(chef, (x) => x.schreibe(
      `update plattform_einstellung set wert = '"x"'::jsonb
        where schluessel = 'recruiting.aufbewahrung_tage'`)))
      .rejects.toThrow(/permission denied/u);
    const [p] = await sql.unsafe<{ qual: string }[]>(
      `select pg_get_expr(polqual, polrelid) as qual from pg_policy
        where polname = 'd_sicherheitskontakt'`);
    expect(p!.qual).toContain('sicherheit.kontakt');
    expect(p!.qual).toContain('sicherheit.richtlinie');
  });
});
