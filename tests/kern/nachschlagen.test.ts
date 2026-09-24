/**
 * **Ein Grund aus der Adresse wird nur als EIGENER Eintrag nachgeschlagen**
 * (V-159, D-653).
 *
 * Der Befund: `bewerbungsMeldung` schlug `?fehler=<grund>` in einem
 * gewöhnlichen Objektliteral nach. `?fehler=__proto__` fand
 * `Object.prototype`, `?fehler=toString` eine Funktion — der Rückfall auf den
 * allgemeinen Satz griff in beiden Fällen nicht, React warf beim Zeichnen, und
 * die öffentlichen Karriereseiten antworteten mit einer Fehlerseite. Dasselbe
 * Nachschlagen stand in den Portalseiten, die diese Gruppe angelegt oder
 * geändert hat.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { pflichtwegMeldung } from '../../src/lib/i18n/texte.js';
import { WEBSITE_REFERENZ_TEXTE } from '../../src/lib/i18n/verwaltung/website-referenz.js';
import { SCHICHT_TEXTE } from '../../src/lib/i18n/verwaltung/dienstplan-schicht.js';

/** Was `Object.prototype` mitbringt — jeder Name ist in der Adresse tippbar. */
const PROTOTYP = [
  '__proto__', 'constructor', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty',
  'isPrototypeOf', 'propertyIsEnumerable', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__',
] as const;

describe('eigenerEintrag', () => {
  const tabelle: Readonly<Record<string, string>> = { da: 'Satz', leer: '' };

  it('findet, was die Tabelle selbst trägt — auch einen leeren Satz', () => {
    expect(eigenerEintrag(tabelle, 'da')).toBe('Satz');
    expect(eigenerEintrag(tabelle, 'leer')).toBe('');
    expect(eigenerEintrag(tabelle, 'fehlt')).toBeUndefined();
  });

  it('findet nichts, was nur der Prototyp trägt', () => {
    for (const schluessel of PROTOTYP) {
      // Die Gegenprobe: der gewöhnliche Zugriff findet etwas — genau der Befund.
      expect((tabelle as Record<string, unknown>)[schluessel], schluessel).toBeDefined();
      expect(eigenerEintrag(tabelle, schluessel), schluessel).toBeUndefined();
    }
  });

  it('nimmt nur eine Zeichenkette als Schlüssel', () => {
    for (const schluessel of [undefined, null, 1, ['da'], { toString: () => 'da' }]) {
      expect(eigenerEintrag(tabelle, schluessel)).toBeUndefined();
    }
  });
});

describe('die Tabellen hinter ?fehler= kennen keinen Schlüssel des Prototyps', () => {
  it('Referenzen und Schichtblatt, in beiden Sprachen', () => {
    for (const sprache of ['de', 'en'] as const) {
      for (const schluessel of PROTOTYP) {
        expect(eigenerEintrag(WEBSITE_REFERENZ_TEXTE[sprache].fehler, schluessel)).toBeUndefined();
        expect(eigenerEintrag(WEBSITE_REFERENZ_TEXTE[sprache].statusFehler, schluessel))
          .toBeUndefined();
        expect(eigenerEintrag(SCHICHT_TEXTE[sprache].fehler, schluessel)).toBeUndefined();
      }
    }
  });

  it('pflichtwegMeldung gibt für einen fremden Grund den allgemeinen Satz, nie eine Funktion', () => {
    for (const schluessel of PROTOTYP) {
      const anfrage = pflichtwegMeldung('anfrage', 'en', schluessel, 'deutsch');
      const barriere = pflichtwegMeldung('barriere', 'en', schluessel, 'deutsch');
      expect(typeof anfrage, schluessel).toBe('string');
      expect(anfrage, schluessel).toBe(pflichtwegMeldung('anfrage', 'en', 'sonst', ''));
      expect(barriere, schluessel).toBe(pflichtwegMeldung('barriere', 'en', 'sonst', ''));
    }
  });
});

describe('die Seiten schlagen den Grund aus der Adresse nur als eigenen Eintrag nach', () => {
  const SEITEN = [
    'src/app/(public)/karriere/meldung.ts',
    'src/app/portal/[mandant]/website/referenzen/page.tsx',
    'src/app/portal/[mandant]/website/referenzen/neu/page.tsx',
    'src/app/portal/[mandant]/website/referenzen/[id]/page.tsx',
    'src/app/portal/[mandant]/website/referenzen/[id]/veroeffentlichen/page.tsx',
    'src/app/portal/[mandant]/dienstplan/einsatz/[id]/page.tsx',
  ];

  it('kein `TABELLE[grund] ??` mehr — sondern `eigenerEintrag(…)`', () => {
    for (const seite of SEITEN) {
      const quelle = readFileSync(seite, 'utf8');
      expect(quelle, seite).toContain('eigenerEintrag(');
      expect(quelle, seite).not.toMatch(
        /\b(?:t\.fehler|t\.statusFehler|FEHLER|BEWERBUNG_MELDUNG)\[(?:abgewiesen|grund)\]\s*\?\?/u);
    }
  });
});
