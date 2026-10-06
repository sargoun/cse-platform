/**
 * Die Voreinstellung der Posten- und Schluesselarten (O-148, D-783) gegen die
 * echte Datenbank: ein leerer Katalog wird gefuellt — unbestaetigt, mit den
 * Uebersetzungen des Mitarbeiterportals, jede Zeile im Pruefprotokoll —, und
 * ein zweiter Aufruf legt nichts doppelt an. Ein archivierter Schluessel
 * gilt als vorhanden und kommt nicht zurueck.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  POSTENART_VOREINSTELLUNG, SCHLUESSELART_VOREINSTELLUNG,
  uebernimmPostenartVoreinstellung, uebernimmSchluesselartVoreinstellung,
} from '../../src/server/services/security/arten.js';

let f: Fixtur;
let leitung = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `arten-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Wachleitung','aktiv')`,
    [u!.id, email]);
  return u!.id;
}

function alsLeitung<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.security, benutzerId: leitung, portal: 'intern', readonly: false },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: leitung,
        aktiverMandantId: f.security, mandantIds: [f.security], abfrage, schreibe: abfrage,
      });
    },
  );
}

interface Artzeile { schluessel: string; ist_platzhalter: boolean; en: string | null; tr: string | null }

async function katalog(tabelle: 'postenart' | 'schluesselart'): Promise<readonly Artzeile[]> {
  return sql.unsafe<Artzeile[]>(
    `select schluessel, ist_platzhalter, bezeichnung_i18n->>'en' as en, bezeichnung_i18n->>'tr' as tr
       from ${tabelle} where mandant_id = $1 and archiviert_am is null order by sortierung`,
    [f.security]);
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [leitung, f.security, await rolleId('leitung')]);
});
afterAll(schliessen);

describe('(1) Postenarten (O-148)', () => {
  it('füllt den leeren Katalog — unbestätigt, übersetzt, protokolliert — und ein zweites Mal nicht', async () => {
    const erst = await alsLeitung((k) => uebernimmPostenartVoreinstellung(k));
    expect(erst).toBe(POSTENART_VOREINSTELLUNG.length);
    const zeilen = await katalog('postenart');
    expect(zeilen.map((z) => z.schluessel)).toEqual(POSTENART_VOREINSTELLUNG.map((a) => a.schluessel));
    expect(zeilen.every((z) => z.ist_platzhalter)).toBe(true);
    expect(zeilen.every((z) => (z.en ?? '') !== '' && (z.tr ?? '') !== '')).toBe(true);

    expect(await alsLeitung((k) => uebernimmPostenartVoreinstellung(k))).toBe(0);
    expect(await katalog('postenart')).toHaveLength(POSTENART_VOREINSTELLUNG.length);

    const [protokoll] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where objekt_typ = 'postenart' and aktion = 'security.postenart_angelegt'
          and mandant_id = $1`, [f.security]);
    expect(Number(protokoll!.n)).toBe(POSTENART_VOREINSTELLUNG.length);
  });

  it('eine archivierte Art der Voreinstellung kommt nicht zurück', async () => {
    await alsLeitung((k) => uebernimmPostenartVoreinstellung(k));
    await sql.unsafe(
      `update postenart set archiviert_am = now()
        where mandant_id = $1 and schluessel = 'baustelle'`, [f.security]);
    expect(await alsLeitung((k) => uebernimmPostenartVoreinstellung(k))).toBe(0);
    expect((await katalog('postenart')).map((z) => z.schluessel)).not.toContain('baustelle');
  });
});

describe('(2) Schlüsselarten (O-148)', () => {
  it('füllt den leeren Katalog — unbestätigt, übersetzt — und ein zweites Mal nicht', async () => {
    const erst = await alsLeitung((k) => uebernimmSchluesselartVoreinstellung(k));
    expect(erst).toBe(SCHLUESSELART_VOREINSTELLUNG.length);
    const zeilen = await katalog('schluesselart');
    expect(zeilen.map((z) => z.schluessel)).toEqual(SCHLUESSELART_VOREINSTELLUNG.map((a) => a.schluessel));
    expect(zeilen.every((z) => z.ist_platzhalter)).toBe(true);
    expect(await alsLeitung((k) => uebernimmSchluesselartVoreinstellung(k))).toBe(0);
  });
});
