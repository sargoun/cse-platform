/**
 * **Die Wiedervorlage der Zuverlässigkeitsüberprüfung** (V-320, O-140, SEC-02,
 * SEC-03, D-815) — an echtem Postgres.
 *
 * Sachkunde und Unterrichtung nach § 34a GewO sind unbefristet; der einzige
 * Anlass einer Nachprüfung ist die Zuverlässigkeitsüberprüfung der Behörde,
 * spätestens nach fünf Jahren. Geprüft wird: die Ableitung beim Lesen (und
 * dass nichts gespeichert wird), wer die Meldung bekommt (Gesellschaften mit
 * aktiver Anstellung UND gebuchtem Security, dort `personal.bewacher_verwalten`,
 * nur Mitglieder), einmal je Datum, und dass ein neues Datum wieder meldet.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import { leereArten } from '../../src/server/benachrichtigung/registry.js';
import {
  ZUVERLAESSIGKEIT_JAHRE, leseRegister,
} from '../../src/server/services/security/bewacherregister.js';
import {
  ART_UEBERPRUEFUNG_FAELLIG, UEBERPRUEFUNG_VORLAUF_TAGE, meldeFaelligeUeberpruefungen,
} from '../../src/server/services/security/zuverlaessigkeit.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `wv-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  /* Gültig seit gestern: zwischen 22 und 24 Uhr UTC gälte „heute" sonst erst morgen. */
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null),
             current_date - 1)`, [u!.id, mandant, rolle]);
  return u!.id;
}

/** Ein lebender Eintrag für Fatima (Reinigung UND Security beschäftigt). */
async function eintrag(letzte: string | null, naechste: string | null = null): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into bewacher_eintrag
       (person_id, bewacher_id, status, letzte_pruefung_am, naechste_pruefung_am, quelle)
     values ($1, $2, 'registriert', $3::date, $4::date, 'manuell') returning id`,
    [f.fatima, `BE-${zufall()}`, letzte, naechste]);
  return e!.id;
}

async function heute(): Promise<string> {
  const [z] = await sql.unsafe<{ tag: string }[]>(
    `select (now() at time zone 'Europe/Berlin')::date::text as tag`);
  return z!.tag;
}

/** Ein Tag relativ zu heute — aus der Datenbank, nie aus der Uhr des Prozesses. */
async function tag(tage: number, jahre = 0): Promise<string> {
  const [z] = await sql.unsafe<{ tag: string }[]>(
    `select (((now() at time zone 'Europe/Berlin')::date + $1::int)
             - make_interval(years => $2::int))::date::text as tag`, [tage, jahre]);
  return z!.tag;
}

const lauf = async (stichtag: string): Promise<Awaited<ReturnType<typeof meldeFaelligeUeberpruefungen>>> =>
  alsRolle('cse_job', (tx) => meldeFaelligeUeberpruefungen(
    { unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) as Promise<readonly unknown[]> },
    stichtag));

async function posteingang(benutzer: string): Promise<readonly {
  titel: string; text: string; ziel: string; mandant_id: string;
}[]> {
  return sql.unsafe(
    `select titel, text, ziel, mandant_id from benachrichtigung
      where empfaenger_id = $1 and art = $2 order by erstellt_am`,
    [benutzer, ART_UEBERPRUEFUNG_FAELLIG]);
}

beforeEach(async () => {
  f = await seed();
  leereArten();
});
afterAll(schliessen);

describe('V-320 — die Wiedervorlage wird beim Lesen abgeleitet', () => {
  it('die letzte plus fünf Jahre — der 29. Februar wird zum 28.', async () => {
    const [z] = await sql.unsafe<{ a: string; b: string; c: string | null; d: string | null }[]>(
      `select app.bewacher_naechste_pruefung('2021-03-12', null, $1)::text as a,
              app.bewacher_naechste_pruefung('2024-02-29', null, $1)::text as b,
              app.bewacher_naechste_pruefung(null, null, $1)::text       as c,
              app.bewacher_naechste_pruefung('2021-03-12', '2023-01-31', $1)::text as d`,
      [ZUVERLAESSIGKEIT_JAHRE]);
    expect(z).toEqual({ a: '2026-03-12', b: '2029-02-28', c: null, d: '2023-01-31' });
  });

  it('das Register zeigt sie mit Kennzeichen — gespeichert wird nichts', async () => {
    const leitung = await konto(f.security, 'leitung');
    const id = await eintrag('2022-05-10');
    const zeile = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: leitung, portal: 'intern', readonly: true },
      async (tx: postgres.TransactionSql) => {
        const abfrage = async <R>(a: string, w?: readonly unknown[]): Promise<readonly R[]> =>
          (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly R[];
        const k: LeseKontext = {
          scope: 'mandant', portal: 'intern', benutzerId: leitung,
          aktiverMandantId: f.security, mandantIds: [f.security], abfrage,
        };
        return (await leseRegister(k, await heute())).zeilen.find((z) => z.eintragId === id);
      });
    expect(zeile!.wiedervorlageAm).toBe('2027-05-10');
    expect(zeile!.wiedervorlageAbgeleitet).toBe(true);
    expect(zeile!.naechstePruefungAm).toBeNull();
    const [roh] = await sql.unsafe<{ n: string | null }[]>(
      `select naechste_pruefung_am::text as n from bewacher_eintrag where id = $1`, [id]);
    expect(roh!.n).toBeNull();
  });
});

describe('V-320 — der Wächter meldet die fällige Überprüfung', () => {
  it('an die Verwaltung der Security-Gesellschaft, einmal je Datum', async () => {
    const security = await konto(f.security, 'leitung');
    const reinigung = await konto(f.reinigung, 'leitung');
    const ohneRecht = await konto(f.security, 'mitarbeiter');
    /* Nur die Security hat Security gebucht — die Reinigung führt kein Register. */
    await sql.unsafe(
      `update mandant set module_gepflegt = true,
              module = case when id = $1 then '{security}'::text[] else '{reinigung}'::text[] end
        where id in ($1, $2)`, [f.security, f.reinigung]);
    // Fünf Jahre minus dreissig Tage her: die Wiedervorlage liegt im Vorlauf.
    await eintrag(await tag(UEBERPRUEFUNG_VORLAUF_TAGE - 30, ZUVERLAESSIGKEIT_JAHRE));

    const erster = await lauf(await heute());
    expect(erster).toMatchObject({ faellig: 1, ohneEmpfaenger: 0 });
    expect(erster.zugestellt).toBeGreaterThanOrEqual(1);
    const meldungen = await posteingang(security);
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]!.ziel).toMatch(/^\/portal\/[a-z0-9_-]+\/security\/bewacherregister$/u);
    expect(meldungen[0]!.mandant_id).toBe(f.security);
    expect(meldungen[0]!.text).toMatch(/abgeleitet/u);
    expect(await posteingang(reinigung)).toEqual([]);
    expect(await posteingang(ohneRecht)).toEqual([]);

    // Der Lauf von morgen meldet dasselbe Datum nicht noch einmal.
    expect(await lauf(await heute())).toMatchObject({ faellig: 1, zugestellt: 0 });
    expect(await posteingang(security)).toHaveLength(1);
  });

  it('ein eingetragenes Datum gilt — und ein neues Datum meldet wieder', async () => {
    const security = await konto(f.security, 'leitung');
    const id = await eintrag('2019-01-01', await tag(10));
    expect(await lauf(await heute())).toMatchObject({ faellig: 1 });
    expect((await posteingang(security))[0]!.text).toMatch(/so eingetragen/u);

    await sql.unsafe(
      `update bewacher_eintrag set naechste_pruefung_am = $2::date where id = $1`,
      [id, await tag(20)]);
    expect(await lauf(await heute())).toMatchObject({ faellig: 1 });
    expect(await posteingang(security)).toHaveLength(2);

    // Weit genug weg: nichts fällig.
    await sql.unsafe(
      `update bewacher_eintrag set naechste_pruefung_am = $2::date where id = $1`,
      [id, await tag(UEBERPRUEFUNG_VORLAUF_TAGE + 30)]);
    expect(await lauf(await heute())).toMatchObject({ faellig: 0, zugestellt: 0 });
  });

  it('ohne letzte und nächste Prüfung meldet nichts — ohne Anstellung niemand', async () => {
    const security = await konto(f.security, 'leitung');
    await eintrag(null);
    expect(await lauf(await heute())).toMatchObject({ faellig: 0 });

    /* Ein Mensch mit Eintrag, aber ohne Anstellung: fällig, und niemand ist zuständig. */
    const [ohne] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Ohne','Anstellung') returning id`);
    await sql.unsafe(
      `insert into bewacher_eintrag (person_id, bewacher_id, status, letzte_pruefung_am, quelle)
       values ($1, $2, 'registriert', '2015-01-01', 'manuell')`, [ohne!.id, `BE-${zufall()}`]);
    expect(await lauf(await heute())).toMatchObject({ faellig: 1, zugestellt: 0, ohneEmpfaenger: 1 });
    expect(await posteingang(security)).toEqual([]);
  });
});
