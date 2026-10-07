/**
 * **Teams pflegen** (V-378, O-650, D-813) — an echtem Postgres.
 *
 * Bis hierher füllte nur der Seed `team` und `team_mitglied`. Geprüft wird
 * der Schreibweg unter `kalender.schreiben`, dass eine Mitgliedschaft endet
 * statt zu verschwinden (und danach wieder beginnen kann), dass eine
 * ausgetretene Person die Aufgaben des Teams nicht mehr sieht (0509) und dass
 * ohne das Recht nichts geschrieben wird.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  TeamFehler, beendeMitgliedschaft, legeTeamAn, listeTeams, ordneZu,
} from '../../src/server/services/kern/team.js';

let f: Fixtur;
let leitung = '';
let wache = '';
const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(rolle: string, personId: string | null = null): Promise<string> {
  const email = `team-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id) values ($1, $2, 'Teamleitung', 'aktiv', $3)`,
    [u!.id, email, personId]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, f.reinigung, rolle]);
  return u!.id;
}

function als<T>(benutzerId: string, fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId, portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) => {
      const abfrage = async <R>(a: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage, schreibe: abfrage,
      });
    },
  ) as Promise<T>;
}

/** Was Fatima im Mitarbeiterportal von einer Aufgabe sieht (Personen-Scope). */
async function siehtFatima(aufgabeId: string): Promise<boolean> {
  const z = await alsApp(
    {
      scope: 'person', personId: f.fatima, benutzerId: wache,
      mandantIds: [f.reinigung], portal: 'mitarbeiter', readonly: true,
    },
    (tx) => tx.unsafe(`select id from aufgabe where id = $1`, [aufgabeId]));
  return z.length === 1;
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto('leitung');
  wache = await konto('mitarbeiter', f.fatima);
});
afterAll(schliessen);

describe('V-378 — ein Team entsteht, eine Mitgliedschaft beginnt und endet', () => {
  it('anlegen, zuordnen, beenden, wieder zuordnen — die alte Zeile bleibt', async () => {
    const team = await als(leitung, (k) => legeTeamAn(k, {
      name: 'Objektbetreuung Mitte', bereich: 'reinigung', leitungBenutzerId: leitung,
    }));
    const erste = await als(leitung, (k) => ordneZu(k, {
      teamId: team, anstellungId: f.fatimaReinigung, rolle: 'Springer',
    }));
    await expect(als(leitung, (k) => ordneZu(k, { teamId: team, anstellungId: f.fatimaReinigung })))
      .rejects.toThrow(TeamFehler);

    await als(leitung, (k) => beendeMitgliedschaft(k, erste));
    await expect(als(leitung, (k) => beendeMitgliedschaft(k, erste))).rejects.toThrow(TeamFehler);
    await als(leitung, (k) => ordneZu(k, { teamId: team, anstellungId: f.fatimaReinigung, rolle: 'Mitglied' }));

    const [t] = (await als(leitung, (k) => listeTeams(k))).filter((x) => x.id === team);
    expect(t!.leitung).toBe('Teamleitung');
    expect(t!.mitglieder).toHaveLength(2);
    expect(t!.mitglieder.filter((m) => m.bis === null).map((m) => m.rolle)).toEqual(['Mitglied']);
    expect(t!.mitglieder.filter((m) => m.bis !== null).map((m) => m.rolle)).toEqual(['Springer']);

    const [z] = await sql.unsafe<{ von: string | null }[]>(
      `select beendet_von as von from team_mitglied where id = $1`, [erste]);
    expect(z!.von).toBe(leitung);
  });

  it('eine ausgetretene Person sieht die Aufgaben des Teams nicht mehr (0509)', async () => {
    const team = await als(leitung, (k) => legeTeamAn(k, { name: 'Glasreinigung' }));
    const mitglied = await als(leitung, (k) => ordneZu(k, { teamId: team, anstellungId: f.fatimaReinigung }));
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into aufgabe (mandant_id, titel, zugewiesen_team_id)
       values ($1, 'Fenster Westseite', $2) returning id`, [f.reinigung, team]);

    expect(await siehtFatima(a!.id), 'als Mitglied').toBe(true);
    await als(leitung, (k) => beendeMitgliedschaft(k, mitglied));
    expect(await siehtFatima(a!.id), 'nach dem Ende').toBe(false);
  });

  it('die Leitung eines Teams gehört der Gesellschaft an', async () => {
    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [`fremd-${zufall()}@cse.test`]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1, $2, 'Fremd', 'aktiv')`,
      [fremd!.id, `fremd-${zufall()}@cse.test`]);
    await expect(als(leitung, (k) => legeTeamAn(k, { name: 'X', leitungBenutzerId: fremd!.id })))
      .rejects.toThrow(TeamFehler);
  });

  it('ohne kalender.schreiben wird nichts geschrieben', async () => {
    const mitarbeiter = await konto('mitarbeiter');
    await expect(als(mitarbeiter, (k) => legeTeamAn(k, { name: 'Ohne Recht' }))).rejects.toThrow();
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from team where name = 'Ohne Recht'`);
    expect(n!.n).toBe(0);
  });
});
