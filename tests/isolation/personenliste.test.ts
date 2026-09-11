/**
 * Die Personenliste gegen die echte Datenbank (D-09, Invariante 9).
 *
 * **Der ganze Punkt dieser Liste ist die Zahl EINS.** Ein Mensch mit zwei
 * Beschaeftigungen steht in der Beschaeftigungsliste zweimal und hier einmal;
 * eine Abfrage ohne `distinct`/`group by` zeigt ihn zweimal, und die Zahl auf
 * der Uebersichtskachel „Personen" stimmte dann mit keiner Liste mehr ueberein.
 *
 * Und: sichtbar ist ein Mensch, weil er HIER beschaeftigt ist. `person` traegt
 * keinen Mandanten — die Wand laeuft ueber die Beschaeftigung.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import {
  leseAnstellungen, lesePerson, lesePersonen,
} from '../../src/app/portal/[mandant]/personal/personen/daten.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);
const STICHTAG = '2026-06-15';

async function leitung(mandant: string): Promise<string> {
  const email = `personen-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = 'leitung' and mandant_id is null`);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, r!.id] as never[]);
  return u!.id;
}

function kontextAus(tx: postgres.TransactionSql, mandant: string, benutzer: string): LeseKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage,
  };
}

function sitzung(mandant: string, benutzer: string): Parameters<typeof alsApp>[0] {
  return { scope: 'mandant', mandantId: mandant, benutzerId: benutzer,
    portal: 'intern', readonly: false };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('ein Mensch ist eine Zeile, auch mit zwei Beschäftigungen', () => {
  it('die doppelt beschäftigte Person erscheint EINMAL', async () => {
    const b = await leitung(f.reinigung);
    // Zweite Beschaeftigung DESSELBEN Menschen im selben Bereich — der Fall,
    // an dem eine Abfrage ohne Verdichtung sofort doppelt zaehlt.
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1, $2, $3, '2025-01-01'::date, 'ruhend')`,
      [f.reinigung, f.jonas, `R-${zufall()}`] as never[]);

    const zeilen = await alsApp(sitzung(f.reinigung, b), (tx) =>
      lesePersonen(kontextAus(tx, f.reinigung, b), STICHTAG));

    const jonas = zeilen.filter((z) => z.personId === f.jonas);
    expect(jonas).toHaveLength(1);
    expect(jonas[0]!.anstellungen).toBe(2);
    expect(jonas[0]!.aktiveAnstellungen).toBe(1);
  });

  it('und die Beschäftigungsliste desselben Menschen zeigt beide', async () => {
    const b = await leitung(f.reinigung);
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1, $2, $3, '2025-01-01'::date, 'ruhend')`,
      [f.reinigung, f.jonas, `R-${zufall()}`] as never[]);

    const beide = await alsApp(sitzung(f.reinigung, b), (tx) =>
      leseAnstellungen(kontextAus(tx, f.reinigung, b), f.jonas));
    expect(beide).toHaveLength(2);
  });
});

describe('sichtbar ist, wer hier beschäftigt ist (K-02)', () => {
  it('ein Mensch ohne Beschäftigung in diesem Bereich fehlt in der Liste', async () => {
    const b = await leitung(f.reinigung);
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Nur', 'Security') returning id`);
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1, $2, $3, '2024-01-01'::date, 'aktiv')`,
      [f.security, p!.id, `S-${zufall()}`] as never[]);

    const zeilen = await alsApp(sitzung(f.reinigung, b), (tx) =>
      lesePersonen(kontextAus(tx, f.reinigung, b), STICHTAG));
    expect(zeilen.map((z) => z.personId)).not.toContain(p!.id);

    // Und einzeln abgefragt ebenso wenig — 404 statt 403 (AUT-06).
    const einzeln = await alsApp(sitzung(f.reinigung, b), (tx) =>
      lesePerson(kontextAus(tx, f.reinigung, b), STICHTAG, p!.id));
    expect(einzeln).toBeNull();
  });

  it('die Beschäftigung der Schwestergesellschaft steht nicht im Einzelblatt (K-06, O-220)', async () => {
    const b = await leitung(f.reinigung);
    // Fatima ist in BEIDEN Gesellschaften beschaeftigt (die D-09-Fixtur).
    const anstellungen = await alsApp(sitzung(f.reinigung, b), (tx) =>
      leseAnstellungen(kontextAus(tx, f.reinigung, b), f.fatima));

    expect(anstellungen).toHaveLength(1);
    expect(anstellungen.map((a) => a.anstellungId)).toContain(f.fatimaReinigung);
    expect(anstellungen.map((a) => a.anstellungId)).not.toContain(f.fatimaSecurity);
  });
});
