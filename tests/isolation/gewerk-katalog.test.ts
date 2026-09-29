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
 *     eine fremde Gesellschaft sieht nichts;
 *  5. das Mitarbeiterportal zeigt die Uebersetzung, die der Katalog traegt —
 *     in der Auswahlliste und an der gebuchten Mannstundenzeile; ohne sie die
 *     deutsche Bezeichnung (V-185, D-676 Nr. 4);
 *  6. der Name steht fest, sobald ein abgeschlossener Bautag ihn traegt — der
 *     Tag zeigt danach weiter, was er beim Abschluss zeigte; archivieren und
 *     neu eintragen geht (D-679); an offenen Tagen bleibt er frei;
 *  7. jede Katalogaenderung steht im Pruefprotokoll, mit vorher und nachher.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  aendereGewerk, archiviereGewerk, GewerkFehler, legeGewerkAn, leseGewerkeKatalog,
} from '../../src/server/services/bau/gewerk.js';
import {
  hefteMannstundenAn, legeBautagAn, leseMannstunden, listeGewerke, schliesseBautag,
} from '../../src/server/services/bau/bautagebuch.js';

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

/** Eine Baustelle des Baus mit Projekt — der Bautag haengt an ihr. */
async function projekt(benutzer: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Bauherr') returning id`,
    [f.bau, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Baustelle','Musterweg','13403','Berlin') returning id`,
    [f.bau, k!.id, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum, objekt_id)
     values ($1,$2,$3,'projekt','aktiv','Rohbau',$4,'2026-01-01',$5) returning id`,
    [f.bau, `AU-${zufall()}`, k!.id, benutzer, o!.id]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, objekt_id)
     values ($1,$2,$3,'Rohbau',$4,'hochbau','vob_b',$5) returning id`,
    [f.bau, a!.id, `P-${zufall()}`, k!.id, o!.id]);
  return p!.id;
}

/** Ein Bautag mit EINER Mannstundenzeile dieses Gewerks. */
async function gebucht(gewerkId: string, datum = '2030-03-05'): Promise<string> {
  const p = await projekt(bauleitung);
  return als(bauleitung, f.bau, async (k) => {
    const tag = await legeBautagAn(k, { projektId: p, datum });
    await hefteMannstundenAn(k, {
      bautagebuchId: tag, gewerkId, herkunft: 'eigen', anzahlPersonen: 2, dauerMinuten: 480,
    });
    return tag;
  });
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

describe('(5) das Mitarbeiterportal zeigt die Uebersetzung (V-185, EMP-12)', () => {
  it('Auswahlliste: tr und ar uebersetzt, en ohne Eintrag und de deutsch', async () => {
    await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'TRO', bezeichnung: 'Trockenbau',
      uebersetzungen: { en: '', ar: 'أعمال الجدران الجافة', tr: 'Kuru yapı' },
      bestaetigt: true,
    }));
    const name = async (sprache: 'de' | 'en' | 'ar' | 'tr'): Promise<string | undefined> =>
      (await als(bauleitung, f.bau, (k) => listeGewerke(k, f.bau, sprache)))[0]?.bezeichnung;
    expect(await name('tr')).toBe('Kuru yapı');
    expect(await name('ar')).toBe('أعمال الجدران الجافة');
    /* Eine leere Uebersetzung wird nicht gespeichert — die Kraft sieht die deutsche. */
    expect(await name('en')).toBe('Trockenbau');
    expect(await name('de')).toBe('Trockenbau');
    /* Ohne Sprache bleibt es der Weg der Verwaltung: deutsch. */
    expect((await als(bauleitung, f.bau, (k) => listeGewerke(k)))[0]?.bezeichnung)
      .toBe('Trockenbau');
  });

  it('die gebuchte Mannstundenzeile nennt das Gewerk in derselben Sprache', async () => {
    const id = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'EST', bezeichnung: 'Estrich', uebersetzungen: { tr: 'Şap işleri', en: 'Screed' },
      bestaetigt: true,
    }));
    const tag = await gebucht(id);
    const zeile = async (sprache: 'de' | 'en' | 'ar' | 'tr') =>
      (await als(bauleitung, f.bau, (k) => leseMannstunden(k, tag, sprache)))[0];
    expect((await zeile('tr'))?.gewerk).toBe('Şap işleri');
    expect((await zeile('en'))?.gewerk).toBe('Screed');
    expect((await zeile('ar'))?.gewerk).toBe('Estrich');
    expect((await zeile('de'))?.gewerk).toBe('Estrich');
    expect((await zeile('tr'))?.gewerk_code).toBe('EST');
  });
});

describe('(6) der Name steht fest, sobald ein abgeschlossener Tag ihn traegt (D-679)', () => {
  it('abgeschlossen: umbenennen wird abgewiesen, alles andere geht — und der Tag bleibt, wie er war',
    async () => {
      const id = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
        code: 'TRO', bezeichnung: 'Trockenbau', bestaetigt: false,
      }));
      const tag = await gebucht(id);
      await als(bauleitung, f.bau, (k) => schliesseBautag(k, tag));

      expect(await grund(als(bauleitung, f.bau, (k) => aendereGewerk(k, id, {
        bezeichnung: 'Elektro', bestaetigt: false,
      })))).toBe('name_fest');

      /* Derselbe Name: Reihenfolge, Bestaetigung und Uebersetzung aendern sich. */
      await als(bauleitung, f.bau, (k) => aendereGewerk(k, id, {
        bezeichnung: ' Trockenbau ', sortierung: 5, bestaetigt: true,
        uebersetzungen: { tr: 'Kuru yapı' },
      }));
      const [z] = await sql.unsafe<{ bezeichnung: string; ist_platzhalter: boolean }[]>(
        `select bezeichnung, ist_platzhalter from gewerk where id = $1`, [id]);
      expect(z).toEqual({ bezeichnung: 'Trockenbau', ist_platzhalter: false });

      const katalog = await als(bauleitung, f.bau, (k) => leseGewerkeKatalog(k));
      expect(katalog.find((g) => g.id === id)?.nameFest).toBe(true);
      const [zeile] = await als(bauleitung, f.bau, (k) => leseMannstunden(k, tag));
      expect(zeile?.gewerk).toBe('Trockenbau');
    });

  it('archivieren und neu eintragen: der alte Tag behaelt den alten Namen, der Code ist frei',
    async () => {
      const alt = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
        code: 'TRO', bezeichnung: 'Trockenbau', bestaetigt: true,
      }));
      const tag = await gebucht(alt);
      await als(bauleitung, f.bau, (k) => schliesseBautag(k, tag));
      await als(bauleitung, f.bau, (k) => archiviereGewerk(k, alt));
      const neu = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
        code: 'TRO', bezeichnung: 'Trocken- und Akustikbau', bestaetigt: true,
      }));
      const [zeile] = await als(bauleitung, f.bau, (k) => leseMannstunden(k, tag));
      expect(zeile).toMatchObject({ gewerk_code: 'TRO', gewerk: 'Trockenbau' });
      expect((await als(bauleitung, f.bau, (k) => listeGewerke(k))).map((g) => g.id))
        .toEqual([neu]);
    });

  it('an einem OFFENEN Tag ist der Name frei — und nichts zeigt ihn als fest', async () => {
    const id = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'MAL', bezeichnung: 'Maler', bestaetigt: false,
    }));
    const tag = await gebucht(id);
    expect((await als(bauleitung, f.bau, (k) => leseGewerkeKatalog(k)))[0]?.nameFest)
      .toBe(false);
    await als(bauleitung, f.bau, (k) => aendereGewerk(k, id, {
      bezeichnung: 'Maler- und Lackierarbeiten', bestaetigt: false,
    }));
    const [zeile] = await als(bauleitung, f.bau, (k) => leseMannstunden(k, tag));
    expect(zeile?.gewerk).toBe('Maler- und Lackierarbeiten');
  });
});

describe('(7) jede Katalogaenderung steht im Pruefprotokoll', () => {
  it('angelegt, geaendert (mit vorher und nachher) und archiviert', async () => {
    const id = await als(bauleitung, f.bau, (k) => legeGewerkAn(k, {
      code: 'FLI', bezeichnung: 'Fliesen', bestaetigt: false,
    }));
    await als(bauleitung, f.bau, (k) => aendereGewerk(k, id, {
      bezeichnung: 'Fliesenarbeiten', bestaetigt: false,
    }));
    await als(bauleitung, f.bau, (k) => archiviereGewerk(k, id));

    const zeilen = await sql.unsafe<{
      aktion: string; mandant_id: string; akteur_id: string | null;
      vorher: Record<string, unknown> | null; nachher: Record<string, unknown> | null;
      geaendert_felder: string[] | null;
    }[]>(
      `select aktion, mandant_id, akteur_id, vorher, nachher, geaendert_felder
         from audit_log where objekt_typ = 'gewerk' and objekt_id = $1
        order by erstellt_am, aktion`, [id]);
    expect(zeilen.map((z) => z.aktion).sort()).toEqual([
      'bau.gewerk_angelegt', 'bau.gewerk_archiviert', 'bau.gewerk_geaendert',
    ]);
    for (const z of zeilen) {
      expect(z.mandant_id).toBe(f.bau);
      expect(z.akteur_id).toBe(bauleitung);
    }
    const geaendert = zeilen.find((z) => z.aktion === 'bau.gewerk_geaendert');
    expect(geaendert?.vorher?.['bezeichnung']).toBe('Fliesen');
    expect(geaendert?.nachher?.['bezeichnung']).toBe('Fliesenarbeiten');
    expect(geaendert?.geaendert_felder).toContain('bezeichnung');
    expect(zeilen.find((z) => z.aktion === 'bau.gewerk_archiviert')?.nachher?.['archiviert_am'])
      .not.toBeNull();
  });
});
