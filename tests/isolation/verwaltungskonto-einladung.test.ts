/**
 * Die Einladung eines Verwaltungskontos gegen echtes Postgres
 * (AUT-04, AUT-02, D-610, K-04, 0372).
 *
 * **Der Befund, den diese Datei schliesst.** Die einzige Stelle, die in
 * `benutzer` schrieb, war der SEED — keine Einladungsroute, kein Formular,
 * keine API. Ein neuer Admin liess sich nur durch einen erneuten Seed-Lauf
 * einsetzen, auf einer Produktionsdatenbank also gar nicht. Und das Schema
 * erwartete die Einladung die ganze Zeit: `benutzer.status` steht auf
 * `'eingeladen'`, ein Zustand, den nichts erzeugen konnte.
 *
 * **Was hier wirklich geprueft wird, ist D-610.** Dass ein Konto entsteht,
 * ist die leichte Haelfte. Die schwere ist, dass es NUR der Super-Admin kann:
 * `system.verwaltungskonto_erstellen` ist `nur_global`, und ein `nur_global`-
 * Recht wird ausschliesslich ueber `benutzer.globale_rolle_id` ausgewertet
 * (0169). Ein Admin bekommt hier also `false` — auch in seiner eigenen
 * Gesellschaft. Ohne diesen Fall waere die Trennlinie eine Behauptung.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { ladeVerwaltungskontoEin }
  from '../../src/server/services/system/verwaltungskonto.js';

let f: Fixtur;
let chef = '';      // super_admin, global
let admin = '';     // admin der Reinigung
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(praefix: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

/** Ein Super-Admin: globale Rolle — und erst der zweite Faktor, dann die Rolle. */
async function superAdmin(): Promise<string> {
  const b = await konto('chef');
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [b]);
  await sql.unsafe(`update benutzer set globale_rolle_id = $1 where id = $2`,
    [await rolleId('super_admin'), b]);
  return b;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)]);
}

function kontextAus(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const als = <T>(b: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  aal: 'aal1' | 'aal2' = 'aal2'): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: b,
           portal: 'intern', readonly: false, aal }, fn);

const einladen = (b: string, rolle: 'admin' | 'leitung' = 'admin',
  aal: 'aal1' | 'aal2' = 'aal2', email = `neu-${zufall()}@cse.test`) =>
  als(b, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, b), {
    mandantId: f.reinigung, email, name: 'Neue Verwaltung', rolle,
  }), aal);

beforeEach(async () => {
  f = await seed();
  chef = await superAdmin();
  admin = await konto('admin');
  await mitglied(admin, f.reinigung, 'admin');
});
afterAll(schliessen);

describe('(1) D-610 — nur der Super-Admin laedt ein', () => {
  it('der Super-Admin kann es', async () => {
    const e = await einladen(chef);
    expect(e.ok, e.grund).toBe(true);
    expect(e.neuesKonto).toBe(true);
    /* Der Klartext kommt GENAU EINMAL zurueck; gespeichert ist nur sein Hash. */
    expect(e.token).toMatch(/^[A-Za-z0-9_-]{20,}$/u);
  });

  /*
   * Der Fall, der die Entscheidung traegt. Ein Admin der Reinigung steht in
   * SEINER eigenen Gesellschaft und darf trotzdem nicht: `nur_global` wertet
   * nur die globale Rolle aus (0169). Faellt dieser Test, ist D-610 wieder
   * eine Behauptung in einem Dokument.
   */
  it('ein Admin der Gesellschaft kann es NICHT — auch in seiner eigenen', async () => {
    await expect(einladen(admin)).rejects.toThrow(/verwaltungskonto_erstellen|berechtigt|privilege/iu);
  });

  it('ohne zweiten Faktor gar nicht (AUT-02)', async () => {
    /* Seit V-136 (0395) gewährt super_admin ohne aal2 nichts — die Rechtefrage
       weist dann schon vor der Stufenprüfung ab. Beides ist AUT-02. */
    await expect(einladen(chef, 'admin', 'aal1'))
      .rejects.toThrow(/zweitem Faktor|aal2|privilege|verwaltungskonto_erstellen fehlt/iu);
  });
});

describe('(2) was entsteht — und in welchem Zustand', () => {
  it('Konto `eingeladen`, Mitgliedschaft mit der gewaehlten Rolle, ein offener Token', async () => {
    const email = `neu-${zufall()}@cse.test`;
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email, name: 'Neue Leitung', rolle: 'leitung',
    }));
    expect(e.ok, e.grund).toBe(true);

    const [b] = await sql.unsafe<{ status: string; name: string }[]>(
      `select status::text as status, name from benutzer where id = $1`, [e.kontoId]);
    /* Genau der Zustand, den die Benutzerverwaltung als „Wartet" zeigt und den
       vor dieser Migration nichts erzeugen konnte. */
    expect(b?.status).toBe('eingeladen');
    expect(b?.name).toBe('Neue Leitung');

    const [m] = await sql.unsafe<{ schluessel: string }[]>(
      `select r.schluessel from benutzer_mandant bm
         join rolle r on r.id = bm.rolle_id
        where bm.benutzer_id = $1 and bm.mandant_id = $2 and bm.entzogen_am is null`,
      [e.kontoId, f.reinigung]);
    expect(m?.schluessel).toBe('leitung');

    const [t] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*) as anzahl from kern.kennwort_token
        where benutzer_id = $1 and zweck = 'einladung' and eingeloest_am is null`,
      [e.kontoId]);
    expect(Number(t?.anzahl)).toBe(1);
  });

  it('eine zweite Einladung entwertet die erste — nie zwei gueltige (0155)', async () => {
    const email = `neu-${zufall()}@cse.test`;
    const eins = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email, name: 'Doppelt', rolle: 'admin',
    }));
    expect(eins.ok, eins.grund).toBe(true);

    /* Dieselbe Adresse, dieselbe Gesellschaft: der Vorgang sagt, dass das
       Konto schon eingetragen ist, statt eine zweite Mitgliedschaft zu bauen. */
    const zwei = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email, name: 'Doppelt', rolle: 'admin',
    }));
    expect(zwei.ok).toBe(false);
    expect(zwei.grund).toMatch(/schon/iu);
  });
});

describe('(3) die Grenzen, die das Tor eng halten', () => {
  it('`super_admin` ist ueber diesen Weg NICHT einladbar (O-887)', async () => {
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email: `x-${zufall()}@cse.test`, name: 'Zweiter Chef',
      /* Bewusst am Typ vorbei: die Sperre muss in der DATENBANK halten und
         nicht erst im TypeScript, sonst haelt sie nicht gegen die Route. */
      rolle: 'super_admin' as never,
    }));
    expect(e.ok).toBe(false);
    expect(e.grund).toMatch(/O-887|admin.*leitung/iu);
  });

  it('`mitarbeiter` ebenfalls nicht — dafuer gibt es den Personalweg', async () => {
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email: `y-${zufall()}@cse.test`, name: 'Kein Arbeiter',
      rolle: 'mitarbeiter' as never,
    }));
    expect(e.ok).toBe(false);
  });

  it('eine unbrauchbare Adresse legt kein Konto an', async () => {
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email: 'kein-at-zeichen', name: 'X', rolle: 'admin',
    }));
    expect(e.ok).toBe(false);
    expect(e.kontoId).toBeNull();
  });

  it('ein Konto ohne Namen auch nicht — der Name steht in jedem Protokoll', async () => {
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email: `z-${zufall()}@cse.test`, name: '   ', rolle: 'admin',
    }));
    expect(e.ok).toBe(false);
  });
});
