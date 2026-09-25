/**
 * Der Gewerkekatalog hat einen Eingang (V-182, D-676; BAU-07 „Mannstunden per
 * trade") — an echtem Postgres.
 *
 * **Der Befund.** `bautagebuch_mannstunden.gewerk_id` ist NOT NULL, der
 * Katalog `gewerk` wird leer ausgeliefert (O-159), und nur der Seed fuellte
 * ihn. Dienst, Route und Seite fehlten, obwohl Policy und Rechte (0082) fuer
 * `bau.schreiben` bereitstanden.
 *
 * Geprueft wird:
 *  1. eintragen ueber den Dienst: unbestaetigt ist `ist_platzhalter`, die
 *     Uebersetzungen stehen in `bezeichnung_i18n`, und das Bautagebuch bietet
 *     das Gewerk an (`listeGewerke`);
 *  2. ein Code ist unter lebenden Gewerken eindeutig — nach dem Archivieren
 *     ist er wieder frei; das Archivierte bleibt lesbar, wird nicht mehr
 *     angeboten und laesst sich nicht mehr aendern;
 *  3. aendern benennt um, der Code bleibt;
 *  4. ohne `bau.schreiben` schreibt die Datenbank nicht (zweite Linie), und
 *     eine fremde Gesellschaft sieht nichts.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  aendereGewerk, archiviereGewerk, GewerkFehler, legeGewerkAn, leseGewerkeKatalog,
} from '../../src/server/services/bau/gewerk.js';
import { listeGewerke } from '../../src/server/services/bau/bautagebuch.js';

let f: Fixtur;
let bauleitung = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `gewerk-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

async function systemrolle(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function rolleMit(mandant: string, rechte: readonly string[]): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`,
    [mandant, `gewerk_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, mandant, [...rechte]]);
  return r!.id;
}

function als<T>(
  benutzer: string, mandant: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, benutzerId: benutzer, portal: 'intern', readonly: false },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: benutzer,
        aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
      });
    },
  );
}

async function grund(p: Promise<unknown>): Promise<string | null> {
  return p.then(() => null, (x: unknown) => (x instanceof GewerkFehler ? x.grund : String(x)));
}

beforeEach(async () => {
  f = await seed();
  bauleitung = await konto(f.bau, await systemrolle('leitung'));
});
afterAll(schliessen);

describe('(1) eintragen — und das Bautagebuch bietet es an', () => {
  it('unbestaetigt ist Platzhalter, die Uebersetzungen stehen daneben', async () => {
    const id = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: ' tro ', bezeichnung: 'Trockenbauarbeiten', leistungsbereich: '039',
      uebersetzungen: { en: 'Drywall', ar: 'أعمال الجدران الجافة', tr: '' },
      bestaetigt: false,
    }));
    const [z] = await sql.unsafe<{
      code: string; ist_platzhalter: boolean; bezeichnung_i18n: Record<string, string>;
      erstellt_von: string; leistungsbereich: string;
    }[]>(
      `select code, ist_platzhalter, bezeichnung_i18n, erstellt_von, leistungsbereich
         from gewerk where id = $1`, [id]);
    expect(z).toMatchObject({
      code: 'TRO', ist_platzhalter: true, erstellt_von: bauleitung, leistungsbereich: '039',
    });
    expect(z!.bezeichnung_i18n).toEqual({
      de: 'Trockenbauarbeiten', en: 'Drywall', ar: 'أعمال الجدران الجافة',
    });

    const angeboten = await als(bauleitung, f.bau, (k) => listeGewerke(k));
    expect(angeboten.map((g) => g.code)).toEqual(['TRO']);
    const katalog = await als(bauleitung, f.bau, (k) => leseGewerkeKatalog(k));
    expect(katalog[0]).toMatchObject({ code: 'TRO', istPlatzhalter: true, buchungen: 0 });
  });

  it('bestaetigt eingetragen ist kein Platzhalter', async () => {
    const id = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'EST', bezeichnung: 'Estricharbeiten', bestaetigt: true,
    }));
    const [z] = await sql.unsafe<{ ist_platzhalter: boolean }[]>(
      `select ist_platzhalter from gewerk where id = $1`, [id]);
    expect(z!.ist_platzhalter).toBe(false);
  });
});

describe('(2) ein Code unter lebenden Gewerken — archivieren gibt ihn frei', () => {
  it('doppelt wird mit Grund abgewiesen, nach dem Archivieren ist der Code frei', async () => {
    const alt = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'MAL', bezeichnung: 'Malerarbeiten', bestaetigt: false,
    }));
    expect(await grund(als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'mal', bezeichnung: 'Nochmal Maler', bestaetigt: false,
    })))).toBe('doppelt');

    await als(bauleitung, f.bau, (k) => archiviereGewerk(k, alt));
    expect(await grund(als(bauleitung, f.bau, (k) => archiviereGewerk(k, alt))))
      .toBe('schon_archiviert');
    expect(await grund(als(bauleitung, f.bau, (k) => aendereGewerk(k, alt, {
      bezeichnung: 'Maler neu', bestaetigt: false,
    })))).toBe('nicht_gefunden');

    const neu = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'MAL', bezeichnung: 'Maler- und Lackierarbeiten', bestaetigt: false,
    }));
    expect(neu).not.toBe(alt);

    /* Das Archivierte bleibt lesbar, wird aber nicht mehr angeboten. */
    const katalog = await als(bauleitung, f.bau, (k) => leseGewerkeKatalog(k));
    expect(katalog.map((g) => [g.code, g.archiviert])).toEqual([['MAL', false], ['MAL', true]]);
    const angeboten = await als(bauleitung, f.bau, (k) => listeGewerke(k));
    expect(angeboten.map((g) => g.id)).toEqual([neu]);
  });

  it('geloescht wird nie', async () => {
    const id = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'ABR', bezeichnung: 'Abbrucharbeiten', bestaetigt: false,
    }));
    await expect(sql.unsafe(`delete from gewerk where id = $1`, [id])).rejects.toThrow();
  });
});

describe('(3) aendern benennt um — der Code bleibt', () => {
  it('Bezeichnung, Reihenfolge und Bestaetigung aendern sich, der Code nicht', async () => {
    const id = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'FLI', bezeichnung: 'Fliesen', bestaetigt: false,
    }));
    await als(bauleitung, f.bau, (k) => aendereGewerk(k, id, {
      bezeichnung: 'Fliesen- und Plattenarbeiten', sortierung: 20, bestaetigt: true,
      uebersetzungen: { tr: 'Fayans işleri' },
    }));
    const [z] = await sql.unsafe<{
      code: string; bezeichnung: string; sortierung: number; ist_platzhalter: boolean;
      geaendert_von: string; bezeichnung_i18n: Record<string, string>;
    }[]>(
      `select code, bezeichnung, sortierung, ist_platzhalter, geaendert_von, bezeichnung_i18n
         from gewerk where id = $1`, [id]);
    expect(z).toMatchObject({
      code: 'FLI', bezeichnung: 'Fliesen- und Plattenarbeiten', sortierung: 20,
      ist_platzhalter: false, geaendert_von: bauleitung,
    });
    expect(z!.bezeichnung_i18n).toEqual({ de: 'Fliesen- und Plattenarbeiten', tr: 'Fayans işleri' });
  });
});

describe('(4) die Datenbank als zweite Linie', () => {
  it('mit bau.lesen allein: lesen ja, eintragen nein', async () => {
    const leser = await konto(f.bau, await rolleMit(f.bau, ['bau.lesen']));
    const fehler = await als(leser, f.bau, (k) => legeGewerkAn(k, {
      code: 'GER', bezeichnung: 'Gerüstbau', bestaetigt: false,
    })).then(() => null, (x: unknown) => x);
    expect(String((fehler as Error | null)?.message ?? '')).toMatch(/row-level security/iu);
    await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'GER', bezeichnung: 'Gerüstbau', bestaetigt: false,
    }));
    const gesehen = await als(leser, f.bau, (k) => leseGewerkeKatalog(k));
    expect(gesehen.map((g) => g.code)).toEqual(['GER']);
  });

  it('eine fremde Gesellschaft sieht den Katalog nicht', async () => {
    await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'DAC', bezeichnung: 'Dacharbeiten', bestaetigt: false,
    }));
    const fremd = await konto(f.reinigung, await systemrolle('leitung'));
    const gesehen = await als(fremd, f.reinigung, (k) => leseGewerkeKatalog(k));
    expect(gesehen).toEqual([]);
  });
});
