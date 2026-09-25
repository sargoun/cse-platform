/**
 * Die Abweisungen des Wachbuchs haben in jeder Sprache einen Satz (V-180,
 * D-599, D-728, EMP-12).
 *
 * Die Routen schicken den GRUND als `?fehler=` zurück; die Seiten schlagen
 * ihn als eigenen Eintrag nach. Fehlt ein Grund in einer Sprache, sähe die
 * Arbeiterin auf Arabisch den deutschen Rückfall oder gar nichts — und genau
 * die Abweisung, die sie am Objekt verstehen muss („dieser Schlüssel gehört
 * zu einem anderen Objekt"), bliebe stumm. Deshalb: dieselben Schlüssel in
 * allen vier Sprachen des Mitarbeiterportals und in beiden der Verwaltung.
 */
import { describe, expect, it } from 'vitest';
import { WACHBUCH_SCHICHT_TEXTE } from '../../src/lib/i18n/wachbuch-schicht.js';
import {
  QUITTUNG_WACHBUCH_TEXTE, WACHBUCH_TEXTE,
} from '../../src/lib/i18n/verwaltung/wachbuch.js';

function schluessel(t: Readonly<Record<string, string>>): readonly string[] {
  return Object.keys(t).sort();
}

describe('(1) das Wachbuch auf der Schicht — vier Sprachen, dieselben Gründe', () => {
  const de = schluessel(WACHBUCH_SCHICHT_TEXTE.de.fehler);
  for (const sprache of ['en', 'ar', 'tr'] as const) {
    it(`${sprache} kennt jeden Grund, den die Route schickt`, () => {
      expect(schluessel(WACHBUCH_SCHICHT_TEXTE[sprache].fehler)).toEqual(de);
      for (const text of Object.values(WACHBUCH_SCHICHT_TEXTE[sprache].fehler)) {
        expect(text).toMatch(/\S/u);
      }
    });
  }

  it('die Gründe der Route stehen alle darin', () => {
    for (const g of ['unbekannte_art', 'kein_betreff', 'kein_text', 'schluessel_fehlt',
      'fremder_schluessel', 'fremder_kontrollpunkt', 'kein_objekt']) {
      expect(de).toContain(g);
    }
  });
});

describe('(2) die Leitstelle — zwei Sprachen, dieselben Gründe', () => {
  it('Wachbuch und Quittung', () => {
    expect(schluessel(WACHBUCH_TEXTE.en.fehler)).toEqual(schluessel(WACHBUCH_TEXTE.de.fehler));
    expect(schluessel(QUITTUNG_WACHBUCH_TEXTE.en.fehler))
      .toEqual(schluessel(QUITTUNG_WACHBUCH_TEXTE.de.fehler));
    expect(schluessel(WACHBUCH_TEXTE.de.fehler)).toContain('fremder_schluessel');
    expect(schluessel(QUITTUNG_WACHBUCH_TEXTE.de.fehler)).toContain('kein_urheber');
  });
});
