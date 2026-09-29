/**
 * Der Gewerkekatalog — was ohne Datenbank feststeht (V-182, D-676, BAU-07).
 *
 * Der Weg durch die echte Datenbank (Policy, Eindeutigkeit, Archiv) steht in
 * `tests/isolation/gewerk-katalog.test.ts`. Hier steht:
 *
 *  1. die Form des Codes — ein bis zwoelf Zeichen, gross geschrieben, ohne
 *     eine engere Regel, die O-159 beantworten muesste;
 *  2. jede Abweisung hat auf der Seite einen Satz, in beiden Sprachen, und
 *     keiner zeigt den rohen Grund;
 *  3. Route und Seite stehen im Manifest und in der Seitenkarte, mit dem
 *     Recht, das die Policy von `gewerk` verlangt (`bau.schreiben`, 0082);
 *  4. das Mitarbeiterportal fragt den Katalog in SEINER Sprache (V-185): die
 *     Pflegeseite verspricht „Bezeichnung im Mitarbeiterportal", und die
 *     Bautagebuchseite der Kraft liest Auswahl und Mannstunden mit
 *     `basis.sprache` — was dabei herauskommt, steht an echten Zeilen in
 *     `tests/isolation/gewerk-katalog.test.ts` (5).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GewerkFehler, pruefeGewerkCode, type GewerkGrund,
} from '../../src/server/services/bau/gewerk.js';
import { GEWERK_TEXTE } from '../../src/lib/i18n/verwaltung/gewerke.js';
import { ROUTEN as API } from '../../src/server/auth/route-manifest.js';
import { ROUTEN as SEITEN } from '../../src/server/registry/routen.generiert.js';
import { DIENSTE } from '../../src/server/registry/dienste.js';

function grund(fn: () => unknown): GewerkGrund | null {
  try {
    fn();
    return null;
  } catch (fehler) {
    return fehler instanceof GewerkFehler ? fehler.grund : null;
  }
}

describe('(1) die Form des Codes', () => {
  it('getrimmt und gross geschrieben', () => {
    expect(pruefeGewerkCode('  tro ')).toBe('TRO');
    expect(pruefeGewerkCode('stlb-039')).toBe('STLB-039');
    expect(pruefeGewerkCode('Übg_1')).toBe('ÜBG_1');
  });

  it('leer, zu lang oder mit Sonderzeichen: code_form', () => {
    expect(grund(() => pruefeGewerkCode('   '))).toBe('code_form');
    expect(grund(() => pruefeGewerkCode('ABCDEFGHIJKLM'))).toBe('code_form');
    expect(grund(() => pruefeGewerkCode('TR O'))).toBe('code_form');
    expect(grund(() => pruefeGewerkCode('-TRO'))).toBe('code_form');
    expect(grund(() => pruefeGewerkCode('TRO;'))).toBe('code_form');
  });

  it('zwoelf Zeichen sind erlaubt', () => {
    expect(pruefeGewerkCode('ABCDEFGHIJKL')).toBe('ABCDEFGHIJKL');
  });

  it('die Statuscodes folgen dem Grund', () => {
    expect(new GewerkFehler('nicht_gefunden', 'x').status).toBe(404);
    expect(new GewerkFehler('doppelt', 'x').status).toBe(409);
    expect(new GewerkFehler('code_form', 'x').status).toBe(422);
  });
});

describe('(2) jede Abweisung hat einen Satz — in beiden Sprachen', () => {
  const gruende: readonly GewerkGrund[] = [
    'unvollstaendig', 'code_form', 'doppelt', 'nicht_gefunden', 'schon_archiviert',
  ];
  for (const sprache of ['de', 'en'] as const) {
    it(`${sprache}: kein Grund ohne Satz, kein roher Schluessel`, () => {
      const t = GEWERK_TEXTE[sprache];
      for (const g of gruende) {
        expect(t.fehler[g], g).toMatch(/\S/u);
        expect(t.fehler[g]).not.toContain(g);
      }
      for (const e of ['angelegt', 'geaendert', 'archiviert']) {
        expect(t.erfolg[e], e).toMatch(/\S/u);
      }
      expect(t.buchungen(1)).not.toBe(t.buchungen(2).replace('2', '1'));
    });
  }
});

describe('(3) Route, Seite und Dienst sind verdrahtet', () => {
  it('POST /api/bau/gewerke verlangt bau.schreiben', () => {
    expect(API.find((r) => r.pfad === 'api/bau/gewerke')?.recht).toBe('bau.schreiben');
  });

  it('die Seite liest mit bau.lesen und schreibt mit bau.schreiben', () => {
    const seite = SEITEN.find((r) => r.pfad === '/portal/[mandant]/bau/gewerke');
    expect(seite?.bewachung).toEqual({
      art: 'recht', lesen: ['bau.lesen'], schreiben: ['bau.schreiben'], aal2: false,
    });
  });

  it('der Dienst steht im Register, schreibend mit bau.schreiben', () => {
    expect(DIENSTE.find((d) => d.pfad === 'bau/gewerk')).toMatchObject({
      modul: 'bau', schreibend: true, schreibRecht: 'bau.schreiben',
    });
  });
});

describe('(4) das Mitarbeiterportal fragt in seiner Sprache (V-185)', () => {
  const seite = readFileSync(
    'src/app/portal/mein/schichten/[zuordnungId]/bautagebuch/page.tsx', 'utf8');

  it('Auswahlliste und Mannstundenzeilen mit der Sprache des Bildschirms', () => {
    expect(seite).toContain('async (kontext, { sprache }) =>');
    expect(seite).toContain('listeGewerke(kontext, bezug.mandantId, sprache)');
    expect(seite).toContain('leseMannstunden(kontext, tag.id, sprache)');
  });

  it('und die Pflegeseite sagt es in beiden Sprachen zu', () => {
    expect(GEWERK_TEXTE.de.uebersetzungen).toBe('Bezeichnung im Mitarbeiterportal');
    expect(GEWERK_TEXTE.de.uebersetzungenHinweis).toContain('deutsche');
    expect(GEWERK_TEXTE.en.uebersetzungenHinweis).toContain('German');
  });
});
