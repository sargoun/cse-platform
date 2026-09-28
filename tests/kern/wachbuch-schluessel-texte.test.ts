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
 *
 * **Und der Rückfall wiederholt die Überschrift nicht** (V-180, Prüfung der
 * Gruppe „einsatz"). Die Seiten setzen `<strong>{abgewiesen}</strong>
 * {fehler}`, und ein unbekannter Grund fällt auf `fehlerUnbekannt` zurück. In
 * allen drei Tabellen war das derselbe Satz wie die Überschrift („Der Eintrag
 * wurde nicht geschrieben. Der Eintrag wurde nicht geschrieben."), beim
 * Gewerk fast derselbe — gezeigt etwa, wenn ein Leser die Richtigstellung
 * abschickte und das Rechtetor `NICHT_GEFUNDEN` warf.
 */
import { describe, expect, it } from 'vitest';
import { WACHBUCH_SCHICHT_TEXTE } from '../../src/lib/i18n/wachbuch-schicht.js';
import {
  QUITTUNG_WACHBUCH_TEXTE, WACHBUCH_TEXTE,
} from '../../src/lib/i18n/verwaltung/wachbuch.js';
import { GEWERK_TEXTE } from '../../src/lib/i18n/verwaltung/gewerke.js';

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

describe('(3) der Rückfall für einen unbekannten Grund sagt etwas anderes als die Überschrift', () => {
  /** Groß-/Kleinschreibung, Satzzeichen und Leerraum zählen nicht — nur die Worte. */
  const worte = (t: string): string => t.toLocaleLowerCase('de').replace(/[\p{P}\s]+/gu, ' ').trim();

  const tabellen: readonly (readonly [string, { abgewiesen: string; fehlerUnbekannt: string }])[] = [
    ...(['de', 'en', 'ar', 'tr'] as const).map((s) =>
      [`Wachbuch der Schicht ${s}`, WACHBUCH_SCHICHT_TEXTE[s]] as const),
    ...(['de', 'en'] as const).flatMap((s) => [
      [`Wachbuch der Leitstelle ${s}`, WACHBUCH_TEXTE[s]] as const,
      [`Schlüsselquittung ${s}`, QUITTUNG_WACHBUCH_TEXTE[s]] as const,
      [`Gewerkekatalog ${s}`, GEWERK_TEXTE[s]] as const,
    ]),
  ];

  for (const [name, t] of tabellen) {
    it(name, () => {
      expect(t.fehlerUnbekannt).toMatch(/\S/u);
      expect(worte(t.fehlerUnbekannt)).not.toBe(worte(t.abgewiesen));
      expect(worte(t.fehlerUnbekannt)).not.toContain(worte(t.abgewiesen));
      expect(worte(t.abgewiesen)).not.toContain(worte(t.fehlerUnbekannt));
    });
  }
});
