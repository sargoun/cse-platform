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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { pflichtwegMeldung } from '../../src/lib/i18n/texte.js';
import { WEBSITE_REFERENZ_TEXTE } from '../../src/lib/i18n/verwaltung/website-referenz.js';
import { SCHICHT_TEXTE } from '../../src/lib/i18n/verwaltung/dienstplan-schicht.js';
import { ZUGANG_TEXTE } from '../../src/lib/i18n/verwaltung/einstellungen/zugang.js';
import { MODUL_ZUWEISUNG_TEXTE } from '../../src/lib/i18n/verwaltung/einstellungen/module-zuweisung.js';

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

/**
 * **Das Benutzerblatt: `?konto=`, `?module=` und `?anzahl=`** (V-168).
 *
 * Die Prüfung über den ganzen Baum unten sucht `[fehler]` und `[grund]`;
 * das Benutzerblatt nannte seine Schlüssel `stand` und `modulStandRoh` und
 * schlug sie als `t.meldung[…]` nach. `?module=__proto__` warf beim
 * Zeichnen, `?konto=` gab einen fremden Wert roh aus.
 */
describe('das Benutzerblatt schlägt seine Meldungen nur als eigenen Eintrag nach', () => {
  const SEITE = 'src/app/portal/[mandant]/einstellungen/benutzer/[id]/page.tsx';

  it('eigenerEintrag statt `.meldung[…]`, und die Anzahl nur als Zahl', () => {
    const quelle = readFileSync(SEITE, 'utf8');
    expect(quelle).toContain('eigenerEintrag(tZugang.meldung, kontoRoh)');
    expect(quelle).toContain('eigenerEintrag(tModule.meldung, modulStandRoh)');
    expect(quelle).not.toMatch(/\.meldung\[/u);
    expect(quelle).not.toMatch(/\?\? stand\}/u);
    expect(quelle).toMatch(/\/\^\\d\{1,6\}\$\/u\.test\(suche\['anzahl'\]\)/u);
  });

  it('die beiden Tabellen kennen keinen Schlüssel des Prototyps, in beiden Sprachen', () => {
    for (const sprache of ['de', 'en'] as const) {
      for (const schluessel of PROTOTYP) {
        expect(eigenerEintrag(ZUGANG_TEXTE[sprache].meldung, schluessel)).toBeUndefined();
        expect(eigenerEintrag(MODUL_ZUWEISUNG_TEXTE[sprache].meldung, schluessel))
          .toBeUndefined();
      }
    }
  });
});

/**
 * **Überall, nicht nur in einer Liste von Seiten** (V-234, D-728).
 *
 * Die Liste oben nannte die sechs Seiten, die eine Gruppe angefasst hatte.
 * Dasselbe Nachschlagen stand in 45 weiteren Dateien — jede Portalseite mit
 * `?fehler=`: `/portal/…/angebote/…?fehler=__proto__` antwortete ebenso mit
 * einer Fehlerseite. Eine Liste schützt, was jemand hineinschreibt; diese
 * Prüfung liest den ganzen Quellbaum.
 */
describe('kein Quelltext schlägt einen Grund aus der Adresse im Prototyp nach', () => {
  function dateien(wurzel: string): string[] {
    const aus: string[] = [];
    for (const e of readdirSync(wurzel, { withFileTypes: true })) {
      const pfad = join(wurzel, e.name);
      if (e.isDirectory()) aus.push(...dateien(pfad));
      else if (/\.(ts|tsx)$/u.test(e.name)) aus.push(pfad);
    }
    return aus;
  }
  const BAUM = ['src/app', 'src/components', 'src/lib'].flatMap(dateien);

  it('liest einen echten Baum', () => {
    expect(BAUM.length).toBeGreaterThan(300);
  });

  it('`TABELLE[fehler]` und `TABELLE[grund]` stehen nirgends ausserhalb von Kommentaren', () => {
    const verstoesse: string[] = [];
    for (const datei of BAUM) {
      readFileSync(datei, 'utf8').split('\n').forEach((zeile, i) => {
        const code = zeile.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        if (/[\w\]]\[(?:fehler|grund)\]/u.test(code)) verstoesse.push(`${datei}:${String(i + 1)}`);
      });
    }
    expect(
      verstoesse,
      'Ein Schlüssel aus der Adresse findet über `[]` auch `__proto__` und `toString` — '
      + 'die Seite antwortet dann mit 500. `eigenerEintrag(tabelle, schluessel)` nehmen.',
    ).toEqual([]);
  });
});
