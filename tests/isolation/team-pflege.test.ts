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
  TeamFehler, beendeMitgliedschaft, legeTeamAn, listeTeams, ordneZu, setzeTeamleitung,
  waehlbareTeamleitungen,
} from '../../src/server/services/kern/team.js';
import { seedeMitglieder } from '../../src/server/db/seed/kern.js';

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

  /*
   * Copilot-Befunde auf PR #42: das Formular schickte keine Leitung, und es
   * gab keinen Weg, sie später zu setzen; ein doppelter Name kam als
   * Serverfehler zurück; und ein zweiter Seedlauf nahm eine beendete
   * Mitgliedschaft zurück.
   */
  it('die Leitung wird beim Anlegen gewählt und danach gesetzt oder entfernt', async () => {
    const zweite = await konto('admin');
    const team = await als(leitung, (k) => legeTeamAn(k, {
      name: 'Revier Mitte', leitungBenutzerId: leitung,
    }));
    const leitungVon = async (): Promise<string | null> =>
      (await als(leitung, (k) => listeTeams(k))).find((x) => x.id === team)!.leitungId;
    expect(await leitungVon()).toBe(leitung);

    await als(leitung, (k) => setzeTeamleitung(k, team, zweite));
    expect(await leitungVon()).toBe(zweite);
    await als(leitung, (k) => setzeTeamleitung(k, team, null));
    expect(await leitungVon()).toBeNull();

    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [`fremd-${zufall()}@cse.test`]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1, $2, 'Fremd', 'aktiv')`,
      [fremd!.id, `fremd-${zufall()}@cse.test`]);
    await expect(als(leitung, (k) => setzeTeamleitung(k, team, fremd!.id)))
      .rejects.toMatchObject({ grund: 'unbekannte_leitung' });
    await expect(als(leitung, (k) => setzeTeamleitung(k, f.reinigung, leitung)))
      .rejects.toMatchObject({ grund: 'unbekanntes_team' });
  });

  it('zur Wahl stehen Mitglieder dieser Gesellschaft — keine Dienstkonten', async () => {
    const admin = await konto('admin');
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [`dienst-${zufall()}@cse.test`]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status, ist_dienstkonto)
       values ($1, $2, 'Dienstkonto', 'aktiv', true)`, [d!.id, `dienst-${zufall()}@cse.test`]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
      [d!.id, f.reinigung]);

    const fuerAdmin = (await als(admin, (k) => waehlbareTeamleitungen(k))).map((x) => x.id);
    expect(fuerAdmin).toEqual(expect.arrayContaining([admin, leitung]));
    expect(fuerAdmin).not.toContain(d!.id);
    // Ohne Benutzerverwaltung bleibt mindestens das eigene Konto.
    expect((await als(leitung, (k) => waehlbareTeamleitungen(k))).map((x) => x.id))
      .toContain(leitung);
  });

  it('ein Name, den es schon gibt — auch anders geschrieben —, ist ein Grund mit Satz', async () => {
    await als(leitung, (k) => legeTeamAn(k, { name: 'Objektbetreuung Nord' }));
    await expect(als(leitung, (k) => legeTeamAn(k, { name: 'objektbetreuung NORD' })))
      .rejects.toMatchObject({ grund: 'name_vergeben' });
    await expect(als(leitung, (k) => legeTeamAn(k, { name: 'objektbetreuung NORD' })))
      .rejects.toBeInstanceOf(TeamFehler);
  });

  it('der Seed nimmt eine beendete Mitgliedschaft nicht zurück', async () => {
    const team = await als(leitung, (k) => legeTeamAn(k, { name: 'Seedteam' }));
    const a = {
      id: f.fatimaReinigung, mandant_id: f.reinigung, person_id: f.fatima, name: 'Fatima',
    };
    expect(await seedeMitglieder(sql, team, leitung, [a])).toBe(1);
    expect(await seedeMitglieder(sql, team, leitung, [a]), 'läuft schon').toBe(0);

    const [m] = await sql.unsafe<{ id: string }[]>(
      `select id from team_mitglied where team_id = $1 and anstellung_id = $2`,
      [team, f.fatimaReinigung]);
    await als(leitung, (k) => beendeMitgliedschaft(k, m!.id));
    expect(await seedeMitglieder(sql, team, leitung, [a]), 'beendet bleibt beendet').toBe(0);

    const [n] = await sql.unsafe<{ laufend: number; alle: number }[]>(
      `select count(*) filter (where beendet_am is null)::int as laufend, count(*)::int as alle
         from team_mitglied where team_id = $1`, [team]);
    expect(n).toEqual({ laufend: 0, alle: 1 });
  });

  it('ohne kalender.schreiben wird nichts geschrieben', async () => {
    const mitarbeiter = await konto('mitarbeiter');
    await expect(als(mitarbeiter, (k) => legeTeamAn(k, { name: 'Ohne Recht' }))).rejects.toThrow();
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from team where name = 'Ohne Recht'`);
    expect(n!.n).toBe(0);
  });
});
