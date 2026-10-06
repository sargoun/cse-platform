/**
 * Die Voreinstellung der Posten- und Schluesselarten (O-148, D-783) gegen die
 * echte Datenbank: ein leerer Katalog wird gefuellt — unbestaetigt, mit den
 * Uebersetzungen des Mitarbeiterportals, jede Zeile im Pruefprotokoll —, und
 * ein zweiter Aufruf legt nichts doppelt an. Ein archivierter Schluessel
 * gilt als vorhanden und kommt nicht zurueck.
 *
 * Dazu die Pflege (Pruefstand PR #33): bestaetigen, archivieren, eine eigene
 * Art anlegen — und zwei Knopfdruecke zur selben Zeit, die genau EINEN Katalog
 * ergeben statt eines Verstosses gegen den Index.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  archiviereArt, bestaetigeArt, legeArtAn, leseArten,
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

describe('(3) Pflege: bestätigen, archivieren, ergänzen (D-783, Prüfstand)', () => {
  it('bestätigen nimmt den Platzhaltervermerk, archivieren die Zeile — beides im Protokoll', async () => {
    await alsLeitung((k) => uebernimmPostenartVoreinstellung(k));
    const vorher = await alsLeitung((k) => leseArten(k, 'postenart'));
    const empfang = vorher.find((z) => z.schluessel === 'empfang');
    const revier = vorher.find((z) => z.schluessel === 'revier');
    expect(empfang?.istPlatzhalter).toBe(true);

    const bestaetigt = await alsLeitung((k) => bestaetigeArt(k, 'postenart', empfang!.id));
    expect(bestaetigt.istPlatzhalter).toBe(false);
    const archiviert = await alsLeitung((k) => archiviereArt(k, 'postenart', revier!.id));
    expect(archiviert.schluessel).toBe('revier');

    const nachher = await alsLeitung((k) => leseArten(k, 'postenart'));
    expect(nachher.find((z) => z.schluessel === 'empfang')?.istPlatzhalter).toBe(false);
    expect(nachher.map((z) => z.schluessel)).not.toContain('revier');
    /* Die archivierte kommt nicht als Voreinstellung zurueck. */
    expect(await alsLeitung((k) => uebernimmPostenartVoreinstellung(k))).toBe(0);

    const [p] = await sql.unsafe<{ aktionen: string[] }[]>(
      `select array_agg(aktion order by aktion) as aktionen from audit_log
        where mandant_id = $1 and objekt_typ = 'postenart'
          and aktion in ('security.postenart_bestaetigt', 'security.postenart_archiviert')`,
      [f.security]);
    expect(p!.aktionen).toEqual(['security.postenart_archiviert', 'security.postenart_bestaetigt']);
  });

  it('eine eigene Art ist bestätigt; derselbe Schlüssel noch einmal ist „doppelt", eine archivierte steht nicht im Weg', async () => {
    const neu = await alsLeitung((k) => legeArtAn(k, 'schluesselart', {
      bezeichnung: 'Tresorschlüssel', uebersetzungen: { en: 'Safe key' },
    }));
    expect(neu.schluessel).toBe('tresorschluessel');
    expect(neu.istPlatzhalter).toBe(false);
    expect((await katalog('schluesselart')).find((z) => z.schluessel === 'tresorschluessel'))
      .toMatchObject({ ist_platzhalter: false, en: 'Safe key' });

    /* Gleicher Schluessel, andere Schreibweise: doppelt. */
    await expect(alsLeitung((k) => legeArtAn(k, 'schluesselart', { bezeichnung: 'TRESORSCHLÜSSEL' })))
      .rejects.toMatchObject({ grund: 'doppelt', status: 409 });

    /* Archiviert — und dann darf der Schluessel wieder leben (partieller Index, 0079). */
    await alsLeitung((k) => archiviereArt(k, 'schluesselart', neu.id));
    const wieder = await alsLeitung((k) => legeArtAn(k, 'schluesselart', { bezeichnung: 'Tresorschlüssel' }));
    expect(wieder.id).not.toBe(neu.id);

    /* Das Protokoll kennt die eigene Art OHNE Voreinstellungsvermerk. */
    const [p] = await sql.unsafe<{ voreinstellung: string | null; i18n: string | null }[]>(
      `select nachher->>'voreinstellung' as voreinstellung,
              nachher->'uebersetzungen'->>'en' as i18n
         from audit_log where objekt_id = $1 and aktion = 'security.schluesselart_angelegt'`,
      [neu.id]);
    expect(p!.voreinstellung).toBeNull();
    expect(p!.i18n).toBe('Safe key');
  });

  it('eine fremde id ist „nicht_gefunden"', async () => {
    await expect(alsLeitung((k) => bestaetigeArt(k, 'postenart', '00000000-0000-0000-0000-000000000000')))
      .rejects.toMatchObject({ grund: 'nicht_gefunden', status: 404 });
  });
});

describe('(4) zwei Knöpfe zur selben Zeit (Prüfstand PR #33)', () => {
  it('legen die Voreinstellung genau einmal an — ohne Verstoss gegen den Index', async () => {
    const [a, b] = await Promise.all([
      alsLeitung((k) => uebernimmPostenartVoreinstellung(k)),
      alsLeitung((k) => uebernimmPostenartVoreinstellung(k)),
    ]);
    expect(a + b).toBe(POSTENART_VOREINSTELLUNG.length);
    expect(await katalog('postenart')).toHaveLength(POSTENART_VOREINSTELLUNG.length);
    const [protokoll] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where objekt_typ = 'postenart' and aktion = 'security.postenart_angelegt'
          and mandant_id = $1`, [f.security]);
    expect(Number(protokoll!.n)).toBe(POSTENART_VOREINSTELLUNG.length);
  });
});
