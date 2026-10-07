/**
 * **Das Übergabefenster des Wachbuchs einstellen** (V-323, O-151, SEC-05,
 * D-808).
 *
 * `wachbuch.uebergabe_fenster` setzte bis hierher nur SQL. Geprüft wird an
 * echtem Postgres, was die Datenbank daraus macht:
 *
 *  1. die Super-Administration setzt das Fenster — `app.uebergabe_fenster`
 *     liest es in der Form, die 0033 ausliefert (`PT12H`), und die Auditzeile
 *     nennt alten und neuen Wert;
 *  2. 0 Stunden ist „eingestellt und abgeschaltet", nicht „nie eingestellt";
 *  3. mehr als 24 Stunden weist der Dienst ab, bevor er schreibt;
 *  4. eine Administration ohne `system.einstellung_verwalten` scheitert an
 *     der Policy von `mandant_einstellung` (0033) — auch am Dienst vorbei.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  UebergabefensterFehler, leseUebergabefenster, setzeUebergabefenster,
} from '../../src/server/services/security/uebergabefenster.js';

let f: Fixtur;
/** Super-Administration: hält `system.einstellung_verwalten` global. */
let chef = '';
/** Eine Administration der Security — ohne das Recht. */
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
    [u!.id, f.security]);
  return u!.id;
}

function kontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.security, mandantIds: [f.security],
    abfrage, schreibe: abfrage,
  };
}

async function als<T>(benutzerId: string, fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp({
    scope: 'mandant', mandantId: f.security, mandantIds: [f.security],
    benutzerId, portal: 'intern', readonly: false, aal: 'aal2',
  }, (tx) => fn(kontext(tx, benutzerId))) as Promise<T>;
}

async function fensterInDerDatenbank(): Promise<string> {
  const [z] = await sql.unsafe<{ w: string }[]>(
    `select app.uebergabe_fenster($1)::text as w`, [f.security]);
  return z!.w;
}

beforeAll(async () => {
  f = await seed();
  chef = await konto('fenster-chef@test.invalid', true);
  admin = await konto('fenster-admin@test.invalid', false);
});
afterAll(schliessen);

describe('V-323 — das Übergabefenster', () => {
  it('die Super-Administration setzt zwölf Stunden — gelesen wie ausgeliefert, protokolliert', async () => {
    await als(chef, (k) => setzeUebergabefenster(k, 12));
    expect(await fensterInDerDatenbank()).toBe('12:00:00');
    expect(await als(chef, (k) => leseUebergabefenster(k))).toEqual({ stunden: 12 });
    const [w] = await sql.unsafe<{ wert: { interval: string } }[]>(
      `select wert from mandant_einstellung
        where mandant_id = $1 and schluessel = 'wachbuch.uebergabe_fenster'`, [f.security]);
    expect(w!.wert).toEqual({ interval: 'PT12H' });
    const [a] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log
        where aktion = 'wachbuch.uebergabe_fenster_gesetzt' and mandant_id = $1`,
      [f.security]);
    expect(a!.n).toBeGreaterThanOrEqual(1);
  });

  it('null Stunden heisst abgeschaltet — nicht „nie eingestellt"', async () => {
    await als(chef, (k) => setzeUebergabefenster(k, 0));
    expect(await als(chef, (k) => leseUebergabefenster(k))).toEqual({ stunden: 0 });
    expect(await fensterInDerDatenbank()).toBe('00:00:00');
  });

  it('mehr als 24 Stunden weist der Dienst ab, bevor er schreibt', async () => {
    await als(chef, (k) => setzeUebergabefenster(k, 6));
    await expect(als(chef, (k) => setzeUebergabefenster(k, 25)))
      .rejects.toBeInstanceOf(UebergabefensterFehler);
    expect(await fensterInDerDatenbank()).toBe('06:00:00');
  });

  it('ohne `system.einstellung_verwalten` hält die Policy — auch am Dienst vorbei', async () => {
    await expect(als(admin, (k) => setzeUebergabefenster(k, 20))).rejects.toThrow();
    await expect(als(admin, (k) => k.schreibe(
      `update mandant_einstellung set wert = '{"interval": "PT24H"}'::jsonb
        where mandant_id = $1 and schluessel = 'wachbuch.uebergabe_fenster'
        returning id`, [f.security]))).resolves.toEqual([]);
    expect(await fensterInDerDatenbank()).toBe('06:00:00');
  });
});
