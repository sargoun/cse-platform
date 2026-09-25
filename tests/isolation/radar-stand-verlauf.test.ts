/**
 * Die Statushistorie eines Radar-Vorgangs gegen eine echte Datenbank
 * (V-241, D-735, 0463, RAD-06, REP-06).
 *
 * **Der Ausfall, gegen den diese Datei steht.** `leseStandHistorie` las
 * `audit_log.nachher` direkt als `cse_app` — eine Spalte, die `cse_app` seit
 * 0005 mit Absicht NICHT hält. Die Seite `/radar/[id]/status` antwortete
 * deshalb mit einer Fehlerseite, sobald ein Vorgang überhaupt einen Stand
 * hatte; auf einer Datenbank ohne Vorgang fiel nichts auf. Geprüft wird hier
 * der ganze Weg, den die Seite nimmt — der Leser aus `daten.ts` über den
 * Definer `app.radar_stand_verlauf` —, und die vier Grenzen des Definers:
 * Spaltenrecht bleibt zu, Mandant, Recht, Portal.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { setzeVorgangsstand } from '../../src/server/services/radar/vorgang.js';
import { leseStandHistorie } from '../../src/app/portal/[mandant]/radar/daten.js';

let f: Fixtur;
let admin = '';
let fremd = '';
let kraft = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(name: string): Promise<string> {
  const email = `rsv-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $3, 'aktiv')`,
    [u!.id, email, name]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [benutzer, mandant, rolle]);
}

function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T,>(anweisung: string, werte?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

/** Eine Sitzung im internen Portal — dort, wo die Stand-Seite liegt. */
function als<T>(
  benutzer: string, mandant: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp({
    scope: 'mandant', mandantId: mandant, mandantIds: [mandant], benutzerId: benutzer,
    readonly: false, portal: 'intern',
  }, (tx) => fn(kontextAus(tx, mandant, benutzer)));
}

async function bekanntmachung(): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ausschreibung (quelle, quell_id, titel, sprache, rohdaten_hash, frist_angebot)
     values ('oeffentlichevergabe', $1, 'Unterhaltsreinigung Rathaus', 'de', $2,
             now() + interval '20 days')
     returning id`, [`rsv-${zufall()}`, `${zufall()}${zufall()}`]);
  return a!.id;
}

async function fehlerVon(p: Promise<unknown>): Promise<unknown> {
  return p.then(() => null, (e: unknown) => e);
}

/** Zwei Stände auf demselben Vorgang: geprüft, dann verworfen mit Grund. */
async function vorgangMitZweiStaenden(): Promise<string> {
  const a = await bekanntmachung();
  await als(admin, f.reinigung, (k) => setzeVorgangsstand(k, {
    ausschreibungId: a, status: 'geprueft', grund: null }));
  const { vorgangId } = await als(admin, f.reinigung, (k) => setzeVorgangsstand(k, {
    ausschreibungId: a, status: 'verworfen', grund: 'Objekt liegt ausserhalb des Reviers' }));
  return vorgangId;
}

beforeEach(async () => {
  f = await seed();
  admin = await konto('Radarprobe Verwaltung');
  await mitglied(admin, f.reinigung, 'admin');
  fremd = await konto('Radarprobe Security');
  await mitglied(fremd, f.security, 'admin');
  kraft = await konto('Radarprobe Kraft');
  await mitglied(kraft, f.reinigung, 'mitarbeiter');
});
afterAll(schliessen);

describe('(1) die Seite liest die Historie — über den Definer, nicht an ihm vorbei', () => {
  it('beide Stände, neueste zuerst, mit „Grund dabei" — ohne permission denied', async () => {
    const vorgang = await vorgangMitZweiStaenden();
    const historie = await als(admin, f.reinigung, (k) => leseStandHistorie(k, vorgang));

    expect(historie.map((h) => [h.status, h.mitGrund, h.akteurTyp])).toEqual([
      ['verworfen', true, 'mensch'],
      ['geprueft', false, 'mensch'],
    ]);
    expect(historie[0]!.am.getTime()).toBeGreaterThanOrEqual(historie[1]!.am.getTime());
    // Der Wortlaut des Grundes steht nicht im Protokoll — und kommt auch nicht heraus.
    expect(JSON.stringify(historie)).not.toContain('Revier');
  });

  it('das Spaltenrecht bleibt zu: `nachher` direkt als cse_app ist weiter 42501', async () => {
    const vorgang = await vorgangMitZweiStaenden();
    const direkt = await fehlerVon(als(admin, f.reinigung, (k) => k.abfrage(
      `select a.nachher ->> 'status' from audit_log a
        where a.aktion = 'radar.stand_gesetzt' and a.objekt_id = $1`, [vorgang])));
    expect((direkt as { code?: string }).code).toBe('42501');
  });
});

describe('(2) die Grenzen des Definers', () => {
  it('eine andere Gesellschaft bekommt für dieselbe Kennung nichts (Invariante 3)', async () => {
    const vorgang = await vorgangMitZweiStaenden();
    const zeilen = await als(fremd, f.security, (k) => k.abfrage<{ status: string }>(
      `select status from app.radar_stand_verlauf($1::uuid)`, [vorgang]));
    expect(zeilen).toEqual([]);
  });

  it('ohne radar.lesen eine Abweisung, keine leere Liste', async () => {
    const vorgang = await vorgangMitZweiStaenden();
    const ohne = await fehlerVon(als(kraft, f.reinigung, (k) => k.abfrage(
      `select status from app.radar_stand_verlauf($1::uuid)`, [vorgang])));
    expect((ohne as { code?: string }).code).toBe('42501');
  });

  it('gehört cse_definer, und public darf ihn nicht ausführen', async () => {
    const [z] = await sql.unsafe<{ eigentuemer: string; oeffentlich: boolean }[]>(
      `select pg_get_userbyid(p.proowner) as eigentuemer,
              has_function_privilege('public', p.oid, 'execute') as oeffentlich
         from pg_proc p
        where p.oid = 'app.radar_stand_verlauf(uuid)'::regprocedure`);
    expect(z).toEqual({ eigentuemer: 'cse_definer', oeffentlich: false });
  });
});
