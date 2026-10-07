/**
 * **Die versäumte Kenntnisnahme** (V-382, O-241, D-811) — an echtem Postgres.
 *
 * Voreinstellung (D-800): versäumt ab Beginn der ersten Schicht auf dem
 * Objekt nach der Veröffentlichung der geltenden Fassung; keine Sperre, eine
 * Warnung an die Leitung — auf der Kenntnisnahme-Seite und an der Schicht.
 * Geprüft wird, welche Schicht die erste ist (nicht die vor der
 * Veröffentlichung, nicht die auf einem anderen Objekt), dass die Schicht ihre
 * offenen Kenntnisnahmen kennt und dass eine Bestätigung beides beendet.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  bestaetigeKenntnisnahme, kenntnisfrist, legeAnweisungAn, leseErsteSchichten,
  leseKenntnisstand, leseOffeneKenntnisnahmenDerSchicht,
} from '../../src/server/services/security/dienstanweisung.js';

let f: Fixtur;
let leitung = '';
let wache = '';
let objektId = '';
let anderesObjektId = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(personId: string | null): Promise<string> {
  const email = `dav-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId]);
  return u!.id;
}

async function objekt(bezeichnung: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Anweisungskunde') returning id`, [f.security, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,$4,'Teststr. 1','10115','Berlin') returning id`,
    [f.security, k!.id, `O-${zufall()}`, bezeichnung]);
  return o!.id;
}

/** Eine Schicht der Wache, `von` bis `bis` Stunden ab jetzt. */
async function schicht(objekt_id: string, von: number, bis: number): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, objekt_id, kunde_id,
                          erstellt_von_art, status)
     select $1, 'manuell', $2,
            ((now() + ($3 || ' hours')::interval) at time zone 'Europe/Berlin')::date,
            now() + ($3 || ' hours')::interval, now() + ($4 || ' hours')::interval,
            'Europe/Berlin',
            ((now() + ($3 || ' hours')::interval) at time zone 'Europe/Berlin')::time,
            ((now() + ($4 || ' hours')::interval) at time zone 'Europe/Berlin')::time,
            $5, o.kunde_id, 'system', 'geplant'
       from objekt o where o.id = $5
     returning id`,
    [f.security, `v382:${zufall()}`, String(von), String(bis), objekt_id]);
  await sql.unsafe(
    `insert into einsatz_zuordnung
       (mandant_id, einsatz_id, anstellung_id, person_id,
        beginn_zeitpunkt, ende_zeitpunkt, status, erstellt_von_art)
     select $1, e.id, $2, $3, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'geplant', 'system'
       from einsatz e where e.id = $4`,
    [f.security, f.fatimaSecurity, f.fatima, e!.id]);
  return e!.id;
}

function kontext<T>(
  benutzerId: string, portal: 'intern' | 'mitarbeiter',
  fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.security, benutzerId,
      ...(portal === 'mitarbeiter' ? { personId: f.fatima } : {}),
      portal, readonly: false,
    },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal, benutzerId,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage, schreibe: abfrage,
      });
    },
  );
}
const alsLeitung = <T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> =>
  kontext(leitung, 'intern', fn);
const alsWache = <T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> =>
  kontext(wache, 'mitarbeiter', fn);

/** Der Eingriff unter der Anwendung: kein Auslöser feuert (eine veröffentlichte Fassung ist eingefroren). */
async function ohneAusloeser(anweisung: string, werte: readonly unknown[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    await tx.unsafe(anweisung, werte as never[]);
  });
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto(null);
  wache = await konto(f.fatima);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [leitung, f.security, await rolleId('leitung')]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [wache, f.security, await rolleId('mitarbeiter')]);
  objektId = await objekt('Werkstor Nord');
  anderesObjektId = await objekt('Lager Süd');
});
afterAll(schliessen);

/**
 * Die Anweisung, veröffentlicht vor einem Tag: erst eine kommende Schicht
 * (sie macht die Pflicht), dann die Veröffentlichung, dann Fassung und
 * Pflicht um 24 Stunden zurück.
 */
async function anweisungVonGestern(): Promise<{ anweisungId: string; versionId: string }> {
  await schicht(objektId, 20, 28);
  const a = await alsLeitung((k) => legeAnweisungAn(k, {
    titel: 'Hausordnung Werkstor', objektId,
    inhalt: 'Tor ab 22:00 verschlossen halten.',
    gueltigAb: '2026-01-01', veroeffentlichen: true,
  }));
  await ohneAusloeser(
    `update dienstanweisung_version set veroeffentlicht_am = now() - interval '24 hours'
      where id = $1::uuid`, [a.versionId]);
  await ohneAusloeser(
    `update da_pflicht set zugewiesen_am = now() - interval '24 hours'
      where dienstanweisung_id = $1::uuid`, [a.anweisungId]);
  return a;
}

describe('V-382 — versäumt ab der ersten Schicht nach der Veröffentlichung', () => {
  it('die erste Schicht ist die nach der Veröffentlichung, auf diesem Objekt', async () => {
    const { anweisungId } = await anweisungVonGestern();
    await schicht(objektId, -50, -42);          // vor der Veröffentlichung
    await schicht(anderesObjektId, -10, -8);    // nach ihr, aber anderswo
    const zaehlt = await schicht(objektId, -6, -2);

    const erste = await alsLeitung((k) => leseErsteSchichten(k, anweisungId));
    const [e] = await sql.unsafe<{ beginn: Date }[]>(
      `select beginn_zeitpunkt as beginn from einsatz where id = $1`, [zaehlt]);
    expect(erste.get(f.fatimaSecurity)?.beginn.getTime()).toBe(new Date(e!.beginn).getTime());
    expect(erste.get(f.fatimaSecurity)?.beginnLokal).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/u);

    const [stand] = await alsLeitung((k) => leseKenntnisstand(k, anweisungId));
    expect(stand!.aktuell).toBe(false);
    expect(kenntnisfrist(stand!.aktuell, erste.get(f.fatimaSecurity)!.beginn, new Date()).art)
      .toBe('versaeumt');
  });

  it('nur kommende Schichten: fällig, nicht versäumt', async () => {
    const { anweisungId } = await anweisungVonGestern();
    const erste = await alsLeitung((k) => leseErsteSchichten(k, anweisungId));
    expect(kenntnisfrist(false, erste.get(f.fatimaSecurity)!.beginn, new Date()).art)
      .toBe('faellig');
  });

  /*
   * Copilot-Befund auf PR #42: die Schicht fragte ohne Stichtag — eine neue
   * Fassung machte die abgeschlossene Schicht von gestern zu einer versäumten
   * Kenntnisnahme, die damals nicht fällig war. Jetzt derselbe Stichtag wie
   * `leseErsteSchichten`: nach Veröffentlichung UND Zuweisung.
   */
  it('eine Schicht vor der Veröffentlichung oder vor der Zuweisung meldet nichts', async () => {
    const { anweisungId } = await anweisungVonGestern();
    const vorVeroeffentlichung = await schicht(objektId, -50, -42);
    expect(await alsLeitung((k) => leseOffeneKenntnisnahmenDerSchicht(k, vorVeroeffentlichung)))
      .toEqual([]);

    // Die Pflicht kam erst vor drei Stunden dazu: die Schicht davor zählt nicht.
    await ohneAusloeser(
      `update da_pflicht set zugewiesen_am = now() - interval '3 hours'
        where dienstanweisung_id = $1::uuid`, [anweisungId]);
    const vorZuweisung = await schicht(objektId, -6, -2);
    expect(await alsLeitung((k) => leseOffeneKenntnisnahmenDerSchicht(k, vorZuweisung)))
      .toEqual([]);
    const nachZuweisung = await schicht(objektId, -1, 3);
    expect(await alsLeitung((k) => leseOffeneKenntnisnahmenDerSchicht(k, nachZuweisung)))
      .toHaveLength(1);
  });

  it('die Schicht kennt ihre offene Kenntnisnahme — und die Bestätigung beendet beides', async () => {
    const { anweisungId, versionId } = await anweisungVonGestern();
    const laufend = await schicht(objektId, -6, -2);

    const offen = await alsLeitung((k) => leseOffeneKenntnisnahmenDerSchicht(k, laufend));
    expect(offen).toHaveLength(1);
    expect(offen[0]!.anweisungId).toBe(anweisungId);
    expect(offen[0]!.titel).toBe('Hausordnung Werkstor');
    expect(offen[0]!.anstellungId).toBe(f.fatimaSecurity);

    // Eine Schicht auf einem anderen Objekt kennt diese Anweisung nicht.
    const anderswo = await schicht(anderesObjektId, -10, -8);
    expect(await alsLeitung((k) => leseOffeneKenntnisnahmenDerSchicht(k, anderswo)))
      .toEqual([]);

    await alsWache((k) => bestaetigeKenntnisnahme(k, { versionId }));

    expect(await alsLeitung((k) => leseOffeneKenntnisnahmenDerSchicht(k, laufend)))
      .toEqual([]);
    const [stand] = await alsLeitung((k) => leseKenntnisstand(k, anweisungId));
    expect(stand!.aktuell).toBe(true);
    expect(kenntnisfrist(stand!.aktuell, new Date(Date.now() - 3_600_000), new Date()).art)
      .toBe('bestaetigt');
  });
});
