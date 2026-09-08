/**
 * PR 10 Akzeptanz (1) und (5).
 *
 * (5) ist eine Aussage ueber eine ABWESENHEIT — dass `job_lauf` kein
 * `mandant_id` hat und in keiner Isolationsregistry steht. Eine solche
 * Zusage laesst sich nur gegen das echte Schema pruefen: im Code sieht man
 * eine fehlende Spalte nicht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { KEIN_HARD_DELETE } from '../../src/server/db/schema/rls.js';
import { PostgresProtokoll } from '../../src/server/jobs/postgres-protokoll.js';
import { fuehreAus, type Alarm } from '../../src/server/jobs/runner.js';
import { leereRegister, registriere } from '../../src/server/jobs/registry.js';

let f: Fixtur;

class SammelAlarm implements Alarm {
  readonly meldungen: string[] = [];
  melde(job: string): Promise<void> { this.meldungen.push(job); return Promise.resolve(); }
}

beforeEach(async () => {
  f = await seed();
  leereRegister();
  await sql.unsafe(`truncate job_lauf_mandant, job_lauf`);
});
afterAll(schliessen);

describe('(5) `job_lauf` hat KEIN mandant_id — und das ist der Punkt', () => {
  it('die Spalte existiert nicht', async () => {
    const spalten = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'job_lauf'`,
    );
    const namen = spalten.map((s) => s.column_name);
    // K-16(d) laesst genau EINE mandantennahe Tabelle mit nullbarem
    // mandant_id zu: audit_log. Ein naechtlicher Lauf ueber alle
    // Gesellschaften hat keinen einzelnen zu nennen.
    expect(namen).not.toContain('mandant_id');
    expect(namen).toContain('job');
    expect(namen).toContain('kennzahlen');
    expect(namen).toContain('fehlertext');
    // Und nicht die Namen des Entwurfs.
    expect(namen).not.toContain('job_schluessel');
    expect(namen).not.toContain('begonnen_am');
    expect(namen).not.toContain('befund');
    expect(namen).not.toContain('status');
  });

  it('und sie steht in keiner Isolationsregistry', () => {
    // Eine Betriebstabelle in der Mandantenregistry hiesse: irgendeine Policy
    // keyt auf einen Mandanten, den sie nicht hat.
    expect(KEIN_HARD_DELETE.map((l) => l.tabelle)).not.toContain('job_lauf');
  });

  it('jede Je-Mandant-Zahl ist NUR ueber job_lauf_mandant erreichbar', async () => {
    const spalten = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'job_lauf_mandant'`,
    );
    const namen = spalten.map((s) => s.column_name);
    expect(namen).toContain('mandant_id');
    expect(namen).toContain('job_lauf_id');
    expect(namen).toContain('kennzahlen');
    // `mandant_id` ist dort NOT NULL: ein Ergebnis ohne Mandanten waere
    // wieder die Zeile, die als Mandantendatum gelesen werden koennte.
    const [z] = await sql.unsafe<{ is_nullable: string }[]>(
      `select is_nullable from information_schema.columns
        where table_name = 'job_lauf_mandant' and column_name = 'mandant_id'`,
    );
    expect(z!.is_nullable).toBe('NO');
  });

  it('cse_app schreibt keinen Lauf — das tut nur cse_job', async () => {
    await expect(
      alsRolle('cse_app', (tx) => tx.unsafe(
        `insert into job_lauf (job) values ('heimlich')`,
      )),
    ).rejects.toThrow(/permission denied|berechtigung/iu);
  });
});

describe('(1) ein registrierter Job schreibt einen Lauf und je Mandant eine Zeile', () => {
  it('ein job_lauf, vier job_lauf_mandant', async () => {
    const protokoll = new PostgresProtokoll({
      unsafe: (s, w) => sql.unsafe(s, (w ?? []) as never[]),
    });
    const alarm = new SammelAlarm();

    const job = registriere({
      schluessel: 'naechtlicher_abgleich',
      bezeichnung: 'Naechtlicher Abgleich',
      zeitplan: '0 3 * * *',
      bereich: 'je_mandant',
      versuche: 1,
      ausfuehren: () => Promise.resolve({ verarbeitet: 7 }),
    });

    await fuehreAus(job, protokoll, alarm, {
      mandanten: [f.reinigung, f.security, f.bau, f.operations],
      warte: () => Promise.resolve(),
    });

    const [lauf] = await sql.unsafe<{ n: string }[]>(`select count(*) n from job_lauf`);
    const [jeM] = await sql.unsafe<{ n: string }[]>(`select count(*) n from job_lauf_mandant`);
    expect(Number(lauf!.n)).toBe(1);
    expect(Number(jeM!.n)).toBe(4);

    const [z] = await sql.unsafe<{ ergebnis: string; kennzahlen: Record<string, unknown> }[]>(
      `select ergebnis, kennzahlen from job_lauf`,
    );
    expect(z!.ergebnis).toBe('erfolg');
    // Ein Objekt, kein JSON-String: sonst liefert jeder Feldzugriff undefined.
    expect(z!.kennzahlen).toEqual({ mandanten: 4, fehlerhaft: 0 });
  });

  it('(3) derselbe Idempotenzschluessel arbeitet einmal — auf einem UNIQUE-Index', async () => {
    const protokoll = new PostgresProtokoll({
      unsafe: (s, w) => sql.unsafe(s, (w ?? []) as never[]),
    });
    const alarm = new SammelAlarm();
    let getan = 0;

    const job = registriere({
      schluessel: 'einmal_taeglich', bezeichnung: 'Einmal', zeitplan: '0 4 * * *',
      bereich: 'plattform', versuche: 0,
      ausfuehren: () => { getan += 1; return Promise.resolve({}); },
    });

    const optionen = { idempotenzSchluessel: '2026-09-08', warte: () => Promise.resolve() };
    await fuehreAus(job, protokoll, alarm, optionen);
    const zweiter = await fuehreAus(job, protokoll, alarm, optionen);

    // Die Idempotenz liegt auf einem eindeutigen Index, nicht in einer
    // Variablen im Prozess: zwei gleichzeitig ausgeloeste Laeufe treffen
    // denselben Index.
    expect(getan).toBe(1);
    expect(zweiter.uebersprungen).toBe(true);
    const [z] = await sql.unsafe<{ n: string }[]>(`select count(*) n from job_lauf`);
    expect(Number(z!.n)).toBe(1);
  });

  it('ein zweiter Lauf mit demselben Schluessel wird vom Index abgewiesen', async () => {
    await sql.unsafe(
      `insert into job_lauf (job, idempotenz_schluessel) values ('x','k1')`,
    );
    await expect(
      sql.unsafe(`insert into job_lauf (job, idempotenz_schluessel) values ('x','k1')`),
    ).rejects.toThrow(/job_lauf_idempotenz_uk|duplicate key/iu);
  });

  it('(2) ein scheiternder Lauf wird als fehler festgehalten, mit Text', async () => {
    const protokoll = new PostgresProtokoll({
      unsafe: (s, w) => sql.unsafe(s, (w ?? []) as never[]),
    });
    const alarm = new SammelAlarm();
    const job = registriere({
      schluessel: 'faellt_um', bezeichnung: 'Faellt um', zeitplan: '0 5 * * *',
      bereich: 'plattform', versuche: 1,
      ausfuehren: () => { throw new Error('Zielsystem nicht erreichbar'); },
    });

    await fuehreAus(job, protokoll, alarm, { warte: () => Promise.resolve() });

    const [z] = await sql.unsafe<{ ergebnis: string; fehlertext: string }[]>(
      `select ergebnis, fehlertext from job_lauf where job = 'faellt_um'`,
    );
    expect(z!.ergebnis).toBe('fehler');
    expect(z!.fehlertext).toBe('Zielsystem nicht erreichbar');
    expect(alarm.meldungen).toEqual(['faellt_um']);
  });

  it('ein beendeter Lauf ohne Ergebnis ist gar nicht speicherbar', async () => {
    // Sonst gaebe es Laeufe, die zu Ende sind und niemand weiss wie.
    await expect(
      sql.unsafe(`insert into job_lauf (job, beendet_am) values ('x', now())`),
    ).rejects.toThrow(/job_lauf_ende/u);
  });
});
