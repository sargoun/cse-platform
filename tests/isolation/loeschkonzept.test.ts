/**
 * **Das Löschkonzept beschreibt, was wirklich passiert** (LEG-09, Phase 10).
 *
 * Seine zweite Hälfte ist die unangenehme: *was wird NICHT gelöscht, und
 * warum*. Ein Konzept, das die Antwort schuldig bleibt, ist vor einer
 * Aufsicht keine Auskunft — und eines, das eine Frist NENNT, die niemand
 * entschieden hat, ist schlimmer, weil es geprüft aussieht.
 *
 * Die Fälle laufen gegen die Datenbank: die Fristen kommen aus den Regeln
 * dieser Gesellschaft, die Läufe aus dem Jobregister, die Sperren aus
 * `rls.ts` — drei Quellen, die alle auseinanderlaufen können.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  alsMarkdown, erstelleLoeschkonzept,
} from '../../src/server/services/datenschutz/loeschkonzept.js';
import { registriereBewerberLoeschung } from '../../src/server/jobs/bewerberLoeschung.js';
import { jobs as register, leereRegister, type JobDefinition } from '../../src/server/jobs/registry.js';
import { KEIN_HARD_DELETE } from '../../src/server/db/schema/rls.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const JETZT = new Date('2026-07-14T09:30:00Z');

async function legeAdministrationAn(mandantId: string): Promise<string> {
  const email = `lk-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Verwaltung', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [u!.id, mandantId]);
  return u!.id;
}

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung,
    benutzerId: benutzer, portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(tx: postgres.TransactionSql): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung], abfrage, schreibe: abfrage,
  };
}

let jobs: readonly JobDefinition[];

beforeEach(async () => {
  f = await seed();
  benutzer = await legeAdministrationAn(f.reinigung);
  leereRegister();
  registriereBewerberLoeschung(sql);
  jobs = register();
});

afterAll(schliessen);

describe('das Löschkonzept (LEG-09)', () => {
  it('nennt den Lauf, der wirklich löscht — mit seinem Zeitplan aus dem Register', async () => {
    const k = await alsApp(sitzung(), (tx) =>
      erstelleLoeschkonzept(kontextAus(tx), jobs, JETZT));
    const lauf = k.laeufe.find((l) => l.schluessel === 'bewerber_loeschung');
    expect(lauf, 'der Bewerberlauf fehlt').toBeDefined();
    expect(lauf?.zeitplan).toBe(
      jobs.find((j) => j.schluessel === 'bewerber_loeschung')?.zeitplan);
    expect(lauf?.wirkung).toMatch(/anonymisiert/iu);
  });

  /**
   * **Ein Lauf, den es nicht gibt, steht nicht drin.** Sonst behauptete das
   * Konzept eine Löschung, die niemand ausführt — genau die Art Satz, die
   * eine Aufsicht als Zusage liest.
   */
  it('ohne registrierten Lauf behauptet es keine Löschung', async () => {
    const k = await alsApp(sitzung(), (tx) =>
      erstelleLoeschkonzept(kontextAus(tx), [], JETZT));
    expect(k.laeufe).toEqual([]);
    expect(alsMarkdown(k)).toContain('Kein Lauf dieser Plattform löscht');
  });

  it('die Fristen kommen aus den Regeln dieser Gesellschaft', async () => {
    const k = await alsApp(sitzung(), (tx) =>
      erstelleLoeschkonzept(kontextAus(tx), jobs, JETZT));
    const rechnung = k.fristen.find((z) => z.klasse === 'Dokumente: rechnung');
    expect(rechnung?.frist).toMatch(/10 Jahre/u);
    /* MiLoG steht als Gesetz und nicht als Einstellung — es ist keine Wahl. */
    const zeit = k.fristen.find((z) => z.klasse === 'Arbeitszeitaufzeichnungen');
    expect(zeit?.grundlage).toContain('MiLoG');
    expect(zeit?.offen).toBe(false);
  });

  it('eine nicht entschiedene Frist steht als offen, nicht als Zahl', async () => {
    const k = await alsApp(sitzung(), (tx) =>
      erstelleLoeschkonzept(kontextAus(tx), jobs, JETZT));
    const akte = k.fristen.find((z) => z.klasse.startsWith('Personalakte'));
    expect(akte?.offen).toBe(true);
    expect(akte?.frist).toMatch(/O-514/u);
    expect(k.offen.join(' ')).toMatch(/O-514/u);
  });

  /**
   * **Jede Sperre trägt ihren Grund.** „Aus gesetzlichen Gründen" wäre keine
   * Auskunft; `rls.ts` verlangt den Grund je Tabelle (K-16), und das Konzept
   * reicht ihn durch, statt ihn zusammenzufassen.
   */
  it('führt jede Löschsperre mit dem Grund aus dem Register', async () => {
    const k = await alsApp(sitzung(), (tx) =>
      erstelleLoeschkonzept(kontextAus(tx), jobs, JETZT));
    const gefuehrt = k.sperren.flatMap((g) => g.tabellen);
    expect(gefuehrt.length).toBe(KEIN_HARD_DELETE.length);
    expect(gefuehrt.filter((t) => t.grund.trim().length < 20)).toEqual([]);
    const audit = gefuehrt.find((t) => t.tabelle === 'audit_log');
    expect(audit?.grund).toBe(
      KEIN_HARD_DELETE.find((s) => s.tabelle === 'audit_log')?.grund);
  });

  it('zwei Abrufe desselben Standes tragen denselben SHA-256', async () => {
    const a = await alsApp(sitzung(), (tx) =>
      erstelleLoeschkonzept(kontextAus(tx), jobs, JETZT));
    const b = await alsApp(sitzung(), (tx) =>
      erstelleLoeschkonzept(kontextAus(tx), jobs, new Date('2026-12-24T18:00:00Z')));
    expect(b.sha256).toBe(a.sha256);
    expect(b.abgerufenAm).not.toBe(a.abgerufenAm);
  });

  it('als Markdown trägt es alle vier Abschnitte', async () => {
    const md = alsMarkdown(await alsApp(sitzung(), (tx) =>
      erstelleLoeschkonzept(kontextAus(tx), jobs, JETZT)));
    expect(md).toContain('## 1. Fristen');
    expect(md).toContain('## 2. Was wirklich löscht');
    expect(md).toContain('## 3. Was NICHT gelöscht wird — und warum');
    expect(md).toContain('## 4. Offen');
  });
});
