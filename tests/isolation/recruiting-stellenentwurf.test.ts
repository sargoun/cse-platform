/**
 * Der Stellenentwurf durch den Agenten und das Bearbeiten eines Entwurfs —
 * gegen echtes Postgres (REC-02, V-222, D-716).
 *
 * Geprüft wird die Kette, die nur mit der Datenbank zusammenhängt: der Lauf
 * über die vorhandene Laufzeit (Register, Budget, Artefakt) endet beim
 * Entwurf und NICHT im Posteingang; ein zweiter Klick legt keine zweite
 * Stelle an; ohne Agent entsteht nichts; bearbeitet wird nur ein Entwurf ohne
 * Freigabe; der Seed bearbeitet über den Dienst.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { aendereStelle, entwirfStellenanzeige } from '../../src/server/services/recruiting/stellenentwurf.js';
import { ladeStelle, legeStelleAn, legeStelleVor } from '../../src/server/services/recruiting/dienst.js';
import { STELLE_ERGAENZUNG, seedStellenentwurf } from '../../src/server/db/seed/stellenentwurf.js';

let f: Fixtur;
let chef = '';
const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(mandant: string, rolle = 'admin'): Promise<string> {
  const email = `stelle-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Leitung Stelle','aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, mandant, rolle]);
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

function als<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: chef,
                  portal: 'intern', readonly: false },
  (tx) => fn(kontextAus(tx, chef, f.reinigung)));
}

async function schalteAgent(an: boolean): Promise<void> {
  await sql.unsafe(`update agent set ist_aktiv = $1 where kennung = 'backoffice'`, [an]);
}

async function legeBudgetAn(): Promise<void> {
  await sql.unsafe(
    `insert into agent_budget
       (mandant_id, geltungsbereich, jahr, monat, budget_cent, ist_platzhalter,
        erstellt_von_art, erstellt_von_dienst)
     values ($1::uuid, 'mandant',
             extract(year  from (now() at time zone 'Europe/Berlin'))::integer,
             extract(month from (now() at time zone 'Europe/Berlin'))::integer,
             5000, true, 'system', 'job:test')
     on conflict do nothing`, [f.reinigung]);
}

const ANGABEN = {
  titel: 'Reinigungskraft (m/w/d)', einsatzort: 'Berlin-Charlottenburg', beginn: 'ab sofort',
  aufgaben: ['Unterhaltsreinigung von Büroflächen', 'Glasreinigung'],
  objektId: null, anforderungen: ['Zuverlässigkeit', 'Deutschkenntnisse'],
  wochenstunden: 20, bewerbungsfrist: null,
};

beforeEach(async () => {
  f = await seed();
  chef = await konto(f.reinigung);
});
afterAll(schliessen);

describe('(1) der Agent entwirft — über die vorhandene Laufzeit', () => {
  it('es entsteht ein Entwurf des Agenten, und nichts liegt im Posteingang', async () => {
    await schalteAgent(true);
    await legeBudgetAn();
    const e = await als((k) => entwirfStellenanzeige(k, ANGABEN, { schluessel: 'eins', codeVersion: 'test' }));
    expect('stelleId' in e).toBe(true);
    if (!('stelleId' in e)) return;
    const s = await als((k) => ladeStelle(k, e.stelleId));
    expect(s).toMatchObject({
      titel: 'Reinigungskraft (m/w/d)', status: 'entwurf', entwurfVonArt: 'agent',
      anforderungen: ['Zuverlässigkeit', 'Deutschkenntnisse'], einsatzort: 'Berlin-Charlottenburg',
      freigabeId: null,
    });
    expect(s!.beschreibung).toContain('Reinigungskraft (m/w/d)');
    expect(s!.beschreibung).toContain('Berlin-Charlottenburg');

    const [a] = await sql.unsafe<{ status: string; stelle: string | null; freigaben: number }[]>(
      `select a.status::text as status, a.ergebnis ->> 'stelle_id' as stelle,
              (select count(*)::int from freigabe fr where fr.agent_aufgabe_id = a.id) as freigaben
         from agent_aufgabe a where a.id = $1`, [e.aufgabeId]);
    expect(a).toEqual({ status: 'abgeschlossen', stelle: e.stelleId, freigaben: 0 });
  });

  it('derselbe Klick zweimal ist ein Entwurf, nicht zwei', async () => {
    await schalteAgent(true);
    await legeBudgetAn();
    const lauf = { schluessel: 'doppelt', codeVersion: 'test' };
    const erster = await als((k) => entwirfStellenanzeige(k, ANGABEN, lauf));
    const zweiter = await als((k) => entwirfStellenanzeige(k, ANGABEN, lauf));
    expect(zweiter).toEqual(erster);
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from stelle where mandant_id = $1 and entwurf_von_art = 'agent'
          and titel = $2`, [f.reinigung, ANGABEN.titel]);
    expect(n!.n).toBe(1);
  });

  it('der Agent ist aus: kein Lauf, keine Stelle', async () => {
    await schalteAgent(false);
    const e = await als((k) => entwirfStellenanzeige(k, ANGABEN, { schluessel: 'aus', codeVersion: 'test' }));
    expect(e).toMatchObject({ gestoert: { code: 'AGENT_INAKTIV' } });
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from stelle where mandant_id = $1 and titel = $2`,
      [f.reinigung, ANGABEN.titel]);
    expect(n!.n).toBe(0);
  });

  it('Titel, Ort und Beginn setzt ein Mensch; ein Objekt ohne Bedarf wird abgewiesen', async () => {
    await expect(als((k) => entwirfStellenanzeige(k, { ...ANGABEN, beginn: ' ' },
      { schluessel: 'leer', codeVersion: 'test' }))).rejects.toMatchObject({ grund: 'angaben_fehlen' });
    await expect(als((k) => entwirfStellenanzeige(k,
      { ...ANGABEN, objektId: '00000000-0000-4000-8000-000000000001' },
      { schluessel: 'objekt', codeVersion: 'test' }))).rejects.toMatchObject({ grund: 'kein_bedarf' });
  });
});

describe('(2) ein Mensch bearbeitet den Entwurf — solange keine Freigabe daran hängt', () => {
  it('bearbeiten, protokollieren, nach dem Vorlegen nicht mehr', async () => {
    const id = await als((k) => legeStelleAn(k, {
      titel: 'Objektleitung', beschreibung: 'Entwurf.', anforderungen: ['Führerschein'],
      entwurfVonArt: 'agent',
    }));
    await als((k) => aendereStelle(k, id, {
      titel: 'Objektleitung (m/w/d)', beschreibung: 'Überarbeitet von einem Menschen.',
      anforderungen: ['Führerschein', ' ', 'Erfahrung in der Objektbetreuung'],
      einsatzort: 'Berlin', wochenstunden: 38.5, bewerbungsfrist: '2026-12-31',
    }));
    const s = await als((k) => ladeStelle(k, id));
    expect(s).toMatchObject({
      titel: 'Objektleitung (m/w/d)', entwurfVonArt: 'agent',
      anforderungen: ['Führerschein', 'Erfahrung in der Objektbetreuung'],
      wochenstunden: '38.50', bewerbungsfrist: '2026-12-31',
    });
    const [p] = await sql.unsafe<{ vorher: Record<string, unknown> }[]>(
      `select vorher from audit_log where objekt_typ = 'stelle' and objekt_id = $1
          and aktion = 'recruiting.stelle_bearbeitet'`, [id]);
    expect(p!.vorher['titel']).toBe('Objektleitung');

    await als((k) => legeStelleVor(k, id));
    await expect(als((k) => aendereStelle(k, id, {
      titel: 'Anders', beschreibung: 'Anders.', anforderungen: [], einsatzort: null,
      wochenstunden: null, bewerbungsfrist: null,
    }))).rejects.toMatchObject({ grund: 'schon_vorgelegt' });
  });

  it('Titel und Beschreibung sind Pflicht; eine fremde Stelle ist unbekannt', async () => {
    const id = await als((k) => legeStelleAn(k, {
      titel: 'Hausmeister', beschreibung: 'Entwurf.', anforderungen: [],
    }));
    await expect(als((k) => aendereStelle(k, id, {
      titel: ' ', beschreibung: 'x', anforderungen: [], einsatzort: null, wochenstunden: null,
      bewerbungsfrist: null,
    }))).rejects.toMatchObject({ grund: 'unvollstaendig' });
    await expect(als((k) => aendereStelle(k, '00000000-0000-4000-8000-000000000002', {
      titel: 'x', beschreibung: 'x', anforderungen: [], einsatzort: null, wochenstunden: null,
      bewerbungsfrist: null,
    }))).rejects.toMatchObject({ grund: 'unbekannt' });
  });
});

describe('(3) der Seed bearbeitet den Agentenentwurf über den Dienst', () => {
  it('einmal, mit einer ergänzten Anforderung', async () => {
    const ids = new Map([['reinigung', f.reinigung]]);
    const id = await als((k) => legeStelleAn(k, {
      titel: 'Vorarbeiter Reinigung', beschreibung: 'Vom Agenten entworfen.',
      anforderungen: ['Erfahrung'], entwurfVonArt: 'agent',
    }));
    expect(await seedStellenentwurf(sql, ids, false)).toEqual({ bearbeitet: 0 });
    expect(await seedStellenentwurf(sql, ids, true)).toEqual({ bearbeitet: 1 });
    const s = await als((k) => ladeStelle(k, id));
    expect(s!.anforderungen).toContain(STELLE_ERGAENZUNG);
    expect(await seedStellenentwurf(sql, ids, true)).toEqual({ bearbeitet: 0 });
  });
});
