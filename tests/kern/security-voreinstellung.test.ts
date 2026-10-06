/**
 * Die Voreinstellungen des Sicherheitsmoduls (D-783): Posten- und
 * Schluesselarten (O-148) und die § 34a-Nachweise (O-342) — als Listen, die
 * ein Knopf in den Katalog schreibt. Hier wird die FORM der Listen gehalten:
 * eindeutige Schluessel, die drei Sprachen des Mitarbeiterportals, und bei den
 * Nachweisen die Rechtsgrundlage, auf die sich jede Zeile beruft.
 */
import { describe, expect, it } from 'vitest';
import {
  ArtFehler, artSchluessel, POSTENART_VOREINSTELLUNG, pruefeArtEingabe,
  SCHLUESSELART_VOREINSTELLUNG, type ArtVoreinstellung,
} from '../../src/server/services/security/arten.js';
import { ANFORDERUNG_VOREINSTELLUNG } from '../../src/server/services/security/anforderung.js';
import { ARTEN_MELDUNGEN, ARTEN_TEXTE } from '../../src/lib/i18n/verwaltung/security-arten.js';

function pruefeListe(liste: readonly ArtVoreinstellung[], erwartet: number): void {
  expect(liste).toHaveLength(erwartet);
  const schluessel = liste.map((a) => a.schluessel);
  expect(new Set(schluessel).size).toBe(schluessel.length);
  let letzte = -1;
  for (const a of liste) {
    expect(a.schluessel, a.schluessel).toMatch(/^[a-z_]+$/u);
    expect(a.bezeichnung.trim().length, a.schluessel).toBeGreaterThan(0);
    for (const sprache of ['en', 'ar', 'tr'] as const) {
      expect(a.uebersetzungen[sprache].trim().length, `${a.schluessel}/${sprache}`).toBeGreaterThan(0);
    }
    expect(a.sortierung, a.schluessel).toBeGreaterThan(letzte);
    letzte = a.sortierung;
  }
}

describe('O-148 — Posten- und Schlüsselarten der Voreinstellung', () => {
  it('sechs Postenarten, eindeutig, in drei Sprachen, geordnet', () => {
    pruefeListe(POSTENART_VOREINSTELLUNG, 6);
    expect(POSTENART_VOREINSTELLUNG.map((a) => a.schluessel)).toContain('objektschutz');
    expect(POSTENART_VOREINSTELLUNG.map((a) => a.schluessel)).toContain('veranstaltung');
  });

  it('fünf Schlüsselarten, eindeutig, in drei Sprachen, geordnet', () => {
    pruefeListe(SCHLUESSELART_VOREINSTELLUNG, 5);
    expect(SCHLUESSELART_VOREINSTELLUNG.map((a) => a.schluessel)).toContain('transponder');
  });
});

describe('O-342 — die § 34a-Nachweise der Voreinstellung', () => {
  it('ein Posten verlangt die Unterrichtung für jede Kraft — als einzige Zeile', () => {
    expect(ANFORDERUNG_VOREINSTELLUNG.posten).toEqual([
      { qualifikation: '34a_unterrichtung', geltung: 'jeder', rechtsgrundlage: '§ 34a Abs. 1a GewO' },
    ]);
  });

  it('eine Veranstaltung verlangt dazu mindestens eine Sachkunde', () => {
    const v = ANFORDERUNG_VOREINSTELLUNG.veranstaltung;
    expect(v.map((z) => z.qualifikation)).toEqual(['34a_unterrichtung', '34a_sachkunde']);
    expect(v.find((z) => z.qualifikation === '34a_sachkunde')?.geltung).toBe('mindestens_einer');
    for (const z of [...ANFORDERUNG_VOREINSTELLUNG.posten, ...v]) {
      expect(z.rechtsgrundlage, z.qualifikation).toContain('§ 34a');
    }
  });
});

/**
 * Die eigene Art (D-783, Prüfstand PR #33): ein Mensch tippt die Bezeichnung,
 * der Schlüssel entsteht daraus — klein, ASCII, Unterstrich — und die Prüfung
 * sagt mit einem Grund, was sie abweist.
 */
describe('eine eigene Art: Schlüssel aus der Bezeichnung, Prüfung mit Grund', () => {
  it('der Schlüssel ist klein, ASCII und mit Unterstrich', () => {
    expect(artSchluessel('Mechanischer Schlüssel')).toBe('mechanischer_schluessel');
    expect(artSchluessel('  Empfang & Pforte ')).toBe('empfang_pforte');
    expect(artSchluessel('Straßenbahn-Depot')).toBe('strassenbahn_depot');
    expect(artSchluessel('Café')).toBe('cafe');
    expect(artSchluessel('???')).toBe('');
  });

  it('die Schlüssel der Voreinstellung sind ihr eigener Schlüssel', () => {
    for (const a of [...POSTENART_VOREINSTELLUNG, ...SCHLUESSELART_VOREINSTELLUNG]) {
      expect(artSchluessel(a.schluessel), a.schluessel).toBe(a.schluessel);
    }
  });

  it('prüft Bezeichnung und Übersetzungen; leere Übersetzungen fallen weg', () => {
    expect(pruefeArtEingabe({
      bezeichnung: ' Hundeführer ', uebersetzungen: { en: 'Dog handler', ar: '  ', tr: undefined },
    })).toEqual({
      schluessel: 'hundefuehrer', bezeichnung: 'Hundeführer', uebersetzungen: { en: 'Dog handler' },
    });
    expect(() => pruefeArtEingabe({ bezeichnung: '   ' })).toThrow(ArtFehler);
    expect(() => pruefeArtEingabe({ bezeichnung: '!!!' })).toThrow(/Buchstaben/u);
    expect(() => pruefeArtEingabe({ bezeichnung: 'x'.repeat(121) })).toThrow(/höchstens/u);
    expect(() => pruefeArtEingabe({ bezeichnung: 'Pforte', uebersetzungen: { en: 'y'.repeat(121) } }))
      .toThrow(/Übersetzung/u);
  });

  it('der Fehler trägt Grund, Code und Status für Formular und Programm', () => {
    const zuLang = new ArtFehler('bezeichnung_zu_lang', 'x');
    expect(zuLang.grund).toBe('bezeichnung_zu_lang');
    expect(zuLang.code).toBe('ungueltige_eingabe');
    expect(zuLang.status).toBe(422);
    expect(new ArtFehler('doppelt', 'x').status).toBe(409);
    expect(new ArtFehler('nicht_gefunden', 'x')).toMatchObject({ code: 'nicht_gefunden', status: 404 });
  });
});

/**
 * Der Katalogblock spricht beide Sprachen der Verwaltung (D-82, Wache
 * `seite-ohne-uebersetzung`): jeder Satz, den die Route als `?arten=` zurückgibt,
 * hat in de und en ein Wort — sonst stünde der Schlüssel auf dem Schirm.
 */
describe('die Wörter des Artenkatalogs (de/en)', () => {
  it('jede Meldung der Route hat in beiden Sprachen einen Satz', () => {
    for (const sprache of ['de', 'en'] as const) {
      for (const m of ARTEN_MELDUNGEN) {
        expect(ARTEN_TEXTE[sprache].meldung[m].length, `${sprache}/${m}`).toBeGreaterThan(20);
      }
      expect(ARTEN_TEXTE[sprache].katalog.postenart.titel).toContain('Postenart');
      expect(ARTEN_TEXTE[sprache].katalog.schluesselart.titel).toContain('Schlüsselart');
      expect(ARTEN_TEXTE[sprache].keine('X')).toContain('O-148');
    }
    expect(Object.keys(ARTEN_TEXTE.en).sort()).toEqual(Object.keys(ARTEN_TEXTE.de).sort());
  });
});
