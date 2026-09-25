/**
 * Ein Gespräch nach dem Anlegen: absagen, verschieben, als geführt vermerken
 * (REC-06, CAL-01, V-220, D-714) — gegen echtes Postgres.
 *
 * **Der Befund.** `gespraech.status` blieb immer `geplant`: kein Weg setzte
 * `abgesagt` oder `stattgefunden`, und ein abgesagter Termin stand als
 * lebender Termin im Kalender und im iCal-Ausgang.
 *
 * Geprüft wird, was nur gegen die Datenbank prüfbar ist: die Uhr (`now()` der
 * DATENBANK, Invariante 5), die Einbahnstrasse (`kern.gespraech_weg`, 0471),
 * die Pflicht zum Grund (`gespraech_absage_vollstaendig`), das Protokoll und
 * der Kalender, der den Zustand liest.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { ladeGespraech, planeGespraech } from '../../src/server/services/recruiting/dienst.js';
import {
  sageGespraechAb, vermerkeGespraech, verschiebeGespraech,
} from '../../src/server/services/recruiting/gespraech.js';
import { planEingabe } from '../../src/server/services/zeit/formulareingabe.js';
import { kalenderZeilen } from '../../src/server/services/kalender/eintraege.js';
import { GESPRAECH_ORT, seedGespraeche } from '../../src/server/db/seed/gespraech.js';

let f: Fixtur;
let leitung = '';
let bewerbung = '';
const zufall = (): string => String(Math.random()).slice(2, 10);
const TAG_MS = 24 * 3600 * 1000;

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `gespraech-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Leitung Gespräch','aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId(rolle)]);
  return u!.id;
}

function kontextAus(
  tx: postgres.TransactionSql, benutzerId: string, mandantId: string,
): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

function als<T>(fn: (k: SchreibKontext, tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: leitung,
                  portal: 'intern', readonly: false },
  (tx) => fn(kontextAus(tx, leitung, f.reinigung), tx));
}

async function plane(inTagen = 3): Promise<string> {
  return als((k) => planeGespraech(k, bewerbung, new Date(Date.now() + inTagen * TAG_MS),
    60, 'Büro', ['Verfügbar ab wann?']));
}

/** Ein Gespräch, dessen Termin schon begonnen hat — als Eigentümer, am Riegel vorbei. */
async function vergangen(): Promise<string> {
  const [g] = await sql.unsafe<{ id: string }[]>(
    `insert into gespraech (mandant_id, bewerbung_id, termin, dauer_minuten, erstellt_von)
     values ($1, $2, now() - interval '2 hours', 60, $3) returning id`,
    [f.reinigung, bewerbung, leitung]);
  return g!.id;
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto(f.reinigung, 'leitung');
  const [st] = await sql.unsafe<{ id: string }[]>(
    `insert into stelle (mandant_id, titel, beschreibung, status)
     values ($1, 'Objektleitung', 'Leitung eines Reinigungsobjekts.', 'entwurf') returning id`,
    [f.reinigung]);
  const [bw] = await sql.unsafe<{ id: string }[]>(
    `insert into bewerbung (mandant_id, stelle_id, name, email, quelle, status, aufbewahrung_bis)
     values ($1, $2, 'Lena Brandt', 'lena@gespraech.test', 'karriereseite', 'eingegangen',
             current_date + 180)
     returning id`, [f.reinigung, st!.id]);
  bewerbung = bw!.id;
});
afterAll(schliessen);

describe('(1) absagen', () => {
  it('verlangt einen Grund und hält Zeitpunkt, Person und Grund fest', async () => {
    const id = await plane();
    await expect(als((k) => sageGespraechAb(k, id, '   ')))
      .rejects.toMatchObject({ grund: 'ohne_grund' });

    await als((k) => sageGespraechAb(k, id, '  Bewerberin hat telefonisch abgesagt  '));
    const g = await als((k) => ladeGespraech(k, id));
    expect(g).toMatchObject({
      status: 'abgesagt', abgesagtGrund: 'Bewerberin hat telefonisch abgesagt',
      abgesagtVon: 'Leitung Gespräch',
    });
    expect(g!.abgesagtAm).toBeInstanceOf(Date);

    const [z] = await sql.unsafe<{ nachher: Record<string, unknown> }[]>(
      `select nachher from audit_log
        where objekt_typ = 'gespraech' and objekt_id = $1
          and aktion = 'recruiting.gespraech_abgesagt'`, [id]);
    expect(z!.nachher).toMatchObject({ status: 'abgesagt' });
  });

  it('der Kalender zeigt es als abgesagt — es bleibt stehen, es verschwindet nicht', async () => {
    const id = await plane(1);
    await als((k) => sageGespraechAb(k, id, 'Termin entfällt'));
    const [tage] = await sql.unsafe<{ von: string; bis: string }[]>(
      `select app.berlin_heute()::text as von, (app.berlin_heute() + 3)::text as bis`);
    const zeilen = await als((k) => kalenderZeilen(k, {
      zeitraum: { von: tage!.von, bis: tage!.bis, bezeichnung: 'Test' },
      nurQuellen: ['gespraech'],
    }));
    const zeile = zeilen.find((z) => z.id === id);
    expect(zeile?.abgesagt).toBe(true);
  });

  it('aus abgesagt führt kein Weg zurück — weder im Dienst noch an ihm vorbei', async () => {
    const id = await plane();
    await als((k) => sageGespraechAb(k, id, 'Stelle besetzt'));
    await expect(als((k) => sageGespraechAb(k, id, 'noch einmal')))
      .rejects.toMatchObject({ grund: 'falscher_status' });
    await expect(als((k) => verschiebeGespraech(k, id, new Date(Date.now() + 5 * TAG_MS), 60)))
      .rejects.toMatchObject({ grund: 'falscher_status' });
    await expect(als((_k, tx) => tx.unsafe(
      `update gespraech set status = 'geplant', abgesagt_am = null, abgesagt_grund = null
        where id = $1`, [id])))
      .rejects.toThrow(/aendert weder Zustand noch Termin/u);
  });

  it('ohne Grund und Zeitpunkt gibt es keinen abgesagten Zustand (CHECK aus 0471)', async () => {
    const id = await plane();
    await expect(als((_k, tx) => tx.unsafe(
      `update gespraech set status = 'abgesagt' where id = $1`, [id])))
      .rejects.toThrow(/gespraech_absage_vollstaendig/u);
  });
});

describe('(2) verschieben', () => {
  it('nur in die Zukunft nach der Uhr der Datenbank — der alte Termin steht im Protokoll', async () => {
    const id = await plane();
    await expect(als((k) => verschiebeGespraech(k, id, new Date(Date.now() - TAG_MS), 60)))
      .rejects.toMatchObject({ grund: 'vergangenheit' });
    await expect(als((k) => verschiebeGespraech(k, id, new Date(Date.now() + TAG_MS), 3)))
      .rejects.toMatchObject({ grund: 'unbrauchbare_dauer' });

    const neu = new Date(Math.floor((Date.now() + 10 * TAG_MS) / 60000) * 60000);
    await als((k) => verschiebeGespraech(k, id, neu, 45));
    const g = await als((k) => ladeGespraech(k, id));
    expect(g!.status).toBe('geplant');
    expect(g!.termin.toISOString()).toBe(neu.toISOString());
    expect(g!.dauerMinuten).toBe(45);

    await expect(als((k) => verschiebeGespraech(k, id, neu, 45)))
      .rejects.toMatchObject({ grund: 'unveraendert' });

    const [z] = await sql.unsafe<{ vorher: Record<string, unknown>; nachher: Record<string, unknown> }[]>(
      `select vorher, nachher from audit_log
        where objekt_typ = 'gespraech' and objekt_id = $1
          and aktion = 'recruiting.gespraech_verschoben'`, [id]);
    expect(z!.nachher).toMatchObject({ termin: neu.toISOString(), dauer_minuten: 45 });
    expect(z!.vorher['dauer_minuten']).toBe(60);
  });

  /**
   * **Die doppelte Stunde der Umstellungsnacht** (Invariante 2). Die Route löst
   * die Berliner Wanduhr über `planEingabe` auf; 02:30 am letzten
   * Oktobersonntag gibt es zweimal, und gemeint ist die erste (MESZ, UTC+2).
   * Gespeichert wird der Instant, und der Kalender zeigt dieselbe Dauer.
   */
  it('02:30 in der Nacht der Zeitumstellung wird der erste Augenblick — als Instant gespeichert', async () => {
    const jahr = new Date().getUTCFullYear() + 1;
    const ende = new Date(Date.UTC(jahr, 9, 31));
    const sonntag = 31 - ende.getUTCDay();
    const tag = `${String(jahr)}-10-${String(sonntag).padStart(2, '0')}`;
    const instant = planEingabe(`${tag}T02:30`);
    expect(instant).toBeInstanceOf(Date);
    const id = await plane();
    await als((k) => verschiebeGespraech(k, id, instant as Date, 90));
    const g = await als((k) => ladeGespraech(k, id));
    expect(g!.termin.toISOString()).toBe(`${tag}T00:30:00.000Z`);
    const [d] = await sql.unsafe<{ minuten: number }[]>(
      `select extract(epoch from (termin + make_interval(mins => dauer_minuten)) - termin)::int / 60
              as minuten from gespraech where id = $1`, [id]);
    expect(d!.minuten).toBe(90);
  });
});

describe('(3) als geführt vermerken', () => {
  it('erst, wenn der Termin begonnen hat — nach der Uhr der Datenbank', async () => {
    const kuenftig = await plane();
    await expect(als((k) => vermerkeGespraech(k, kuenftig)))
      .rejects.toMatchObject({ grund: 'noch_nicht' });

    const id = await vergangen();
    await als((k) => vermerkeGespraech(k, id));
    const g = await als((k) => ladeGespraech(k, id));
    expect(g).toMatchObject({ status: 'stattgefunden', vermerktVon: 'Leitung Gespräch' });
    expect(g!.vermerktAm).toBeInstanceOf(Date);
    await expect(als((k) => sageGespraechAb(k, id, 'zu spät')))
      .rejects.toMatchObject({ grund: 'falscher_status' });
  });

  it('ein Gespräch einer anderen Gesellschaft ist unbekannt (AUT-06)', async () => {
    const id = await plane();
    const fremd = await konto(f.security, 'leitung');
    await expect(alsApp({ scope: 'mandant', mandantId: f.security, benutzerId: fremd,
                          portal: 'intern', readonly: false },
    (tx) => sageGespraechAb(kontextAus(tx, fremd, f.security), id, 'fremd')))
      .rejects.toMatchObject({ grund: 'unbekannt' });
  });
});

describe('(4) der Seed zeigt alle drei Stände — über die Dienste', () => {
  it('geplant, abgesagt mit Grund, als geführt vermerkt — und ein zweiter Lauf legt nichts nach', async () => {
    await sql.unsafe(
      `insert into bewerbung (mandant_id, name, email, quelle, status, aufbewahrung_bis)
       values ($1, 'Jonas Weber', 'jonas@gespraech.test', 'initiativ', 'eingegangen',
               current_date + 180)`, [f.reinigung]);
    const ids = new Map([['reinigung', f.reinigung]]);
    expect(await seedGespraeche(sql, ids, false))
      .toEqual({ geplant: 0, abgesagt: 0, gefuehrt: 0 });
    expect(await seedGespraeche(sql, ids, true))
      .toEqual({ geplant: 1, abgesagt: 1, gefuehrt: 1 });

    const zeilen = await sql.unsafe<{
      status: string; grund: string | null; von: string | null; vermerkt: string | null;
    }[]>(
      `select status::text as status, abgesagt_grund as grund, abgesagt_von::text as von,
              stattgefunden_vermerkt_von::text as vermerkt
         from gespraech where mandant_id = $1 and ort = $2 order by status`,
      [f.reinigung, GESPRAECH_ORT]);
    expect(zeilen.map((z) => z.status)).toEqual(['geplant', 'stattgefunden', 'abgesagt'].sort());
    const abgesagt = zeilen.find((z) => z.status === 'abgesagt');
    expect(abgesagt!.grund).toMatch(/Demodaten/u);
    expect(abgesagt!.von).toBe(leitung);
    expect(zeilen.find((z) => z.status === 'stattgefunden')!.vermerkt).toBe(leitung);

    const [protokoll] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log
        where objekt_typ = 'gespraech'
          and aktion in ('recruiting.gespraech_abgesagt', 'recruiting.gespraech_stattgefunden')
          and objekt_id in (select id::text from gespraech where ort = $1)`, [GESPRAECH_ORT]);
    expect(protokoll!.n).toBe(2);

    expect(await seedGespraeche(sql, ids, true))
      .toEqual({ geplant: 0, abgesagt: 0, gefuehrt: 0 });
  });
});
