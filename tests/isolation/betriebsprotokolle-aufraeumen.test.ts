/**
 * **Der Löschlauf für Anmeldeversuche und das Nachtlauf-Protokoll** (V-330,
 * O-92, D-790, D-822) — unter der echten Jobrolle, an echtem Postgres.
 *
 * Geprüft wird: was älter als seine Frist ist, geht — was jünger ist, bleibt;
 * ein noch laufender Lauf bleibt auch alt; die Frist ist eine Einstellung,
 * und eine Frist unter einem Tag wird ein Tag; nur `cse_job` ruft den
 * Einstieg, und `cse_app` löscht weiterhin nichts; das Prüfprotokoll bleibt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { raeumeBetriebsprotokolleAuf } from '../../src/server/jobs/betriebsprotokolle.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function versuch(tageHer: number): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kern.anmeldeversuch (kennung_hash, art, erfolg, erstellt_am)
     values (repeat('a', 64), 'kennwort', false, now() - make_interval(days => $1::int))
     returning id`, [tageHer]);
  return z!.id;
}

async function lauf(tageHer: number, beendet: boolean): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into job_lauf (job, gestartet_am, beendet_am, ergebnis)
     values ($1, now() - make_interval(days => $2::int),
             case when $3 then now() - make_interval(days => $2::int) end,
             case when $3 then 'erfolg'::job_ergebnis end)
     returning id`, [`probe_${zufall()}`, tageHer, beendet]);
  await sql.unsafe(
    `insert into job_lauf_mandant (job_lauf_id, mandant_id, ergebnis)
     values ($1, $2, 'erfolg')`, [z!.id, f.reinigung]);
  return z!.id;
}

async function gibt(tabelle: string, id: string): Promise<boolean> {
  const [z] = await sql.unsafe<{ da: boolean }[]>(
    `select exists (select 1 from ${tabelle} where id = $1) as da`, [id]);
  return z!.da;
}

beforeEach(async () => {
  f = await seed();
  await sql.unsafe(
    `update plattform_einstellung set wert = to_jsonb(30)
      where schluessel = 'datenschutz.anmeldeversuch_tage'`);
  await sql.unsafe(
    `update plattform_einstellung set wert = to_jsonb(365)
      where schluessel = 'betrieb.job_lauf_tage'`);
});
afterAll(schliessen);

describe('V-330 — der Löschlauf unter der echten Jobrolle', () => {
  it('was älter als seine Frist ist, geht; was jünger ist und was noch läuft, bleibt', async () => {
    const altVersuch = await versuch(40);
    const jungVersuch = await versuch(5);
    const altLauf = await lauf(400, true);
    const laeuftNoch = await lauf(400, false);
    const jungLauf = await lauf(10, true);

    const zeilen = await raeumeBetriebsprotokolleAuf(sql);
    const nach = new Map(zeilen.map((z) => [z.tabelle, z]));
    expect(nach.get('kern.anmeldeversuch')).toMatchObject({ fristTage: 30 });
    expect(nach.get('kern.anmeldeversuch')!.geloescht).toBeGreaterThanOrEqual(1);
    expect(nach.get('job_lauf')).toMatchObject({ fristTage: 365 });
    expect(nach.get('job_lauf')!.geloescht).toBeGreaterThanOrEqual(1);
    expect(nach.get('job_lauf_mandant')!.geloescht).toBeGreaterThanOrEqual(1);

    expect(await gibt('kern.anmeldeversuch', altVersuch)).toBe(false);
    expect(await gibt('kern.anmeldeversuch', jungVersuch)).toBe(true);
    expect(await gibt('job_lauf', altLauf)).toBe(false);
    expect(await gibt('job_lauf', laeuftNoch)).toBe(true);
    expect(await gibt('job_lauf', jungLauf)).toBe(true);
    const [kinder] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from job_lauf_mandant where job_lauf_id = $1`, [altLauf]);
    expect(kinder!.n).toBe(0);

    /* Die zweite Nacht findet nichts mehr davon. */
    const zweite = await raeumeBetriebsprotokolleAuf(sql);
    expect(zweite.find((z) => z.tabelle === 'job_lauf')!.geloescht).toBe(0);
  });

  it('die Frist ist eine Einstellung — und eine Frist unter einem Tag wird ein Tag', async () => {
    await sql.unsafe(
      `update plattform_einstellung set wert = to_jsonb(3)
        where schluessel = 'datenschutz.anmeldeversuch_tage'`);
    const fuenf = await versuch(5);
    const heute = await versuch(0);
    await raeumeBetriebsprotokolleAuf(sql);
    expect(await gibt('kern.anmeldeversuch', fuenf)).toBe(false);
    expect(await gibt('kern.anmeldeversuch', heute)).toBe(true);

    await sql.unsafe(
      `update plattform_einstellung set wert = to_jsonb(0)
        where schluessel = 'datenschutz.anmeldeversuch_tage'`);
    const zeilen = await raeumeBetriebsprotokolleAuf(sql);
    expect(zeilen.find((z) => z.tabelle === 'kern.anmeldeversuch')!.fristTage).toBe(1);
    expect(await gibt('kern.anmeldeversuch', heute)).toBe(true);
  });

  it('nur cse_job ruft den Einstieg — und cse_app löscht weiterhin nichts', async () => {
    const email = `aufraeumen-${zufall()}@cse.test`;
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [email]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`, [u!.id, email]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1, $2, (select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
      [u!.id, f.reinigung]);
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: u!.id,
      portal: 'intern' as const, readonly: false,
    };
    await expect(alsApp(sitzung, (tx) => tx.unsafe(
      `select * from kern.betriebsprotokolle_aufraeumen()`))).rejects.toThrow(/permission denied/u);
    await expect(alsApp(sitzung, (tx) => tx.unsafe(`delete from job_lauf`)))
      .rejects.toThrow(/permission denied/u);
  });

  it('das Prüfprotokoll bleibt, auch elf Jahre alt', async () => {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into audit_log (mandant_id, ebene, akteur_typ, aktion, objekt_typ, erstellt_am)
       values ($1, 'mandant', 'system', 'probe.alt', 'probe', now() - interval '11 years')
       returning id::text as id`, [f.reinigung]);
    await raeumeBetriebsprotokolleAuf(sql);
    expect(await gibt('audit_log', a!.id)).toBe(true);
  });
});
