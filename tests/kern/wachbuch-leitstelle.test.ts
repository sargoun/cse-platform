/**
 * Die Wachbuchseiten der Leitstelle — was die Prüfung der Gruppe „einsatz"
 * an ihnen fand (V-180, D-599, D-674).
 *
 * Die Seiten lesen die Datenbank und lassen sich ohne sie nicht rendern;
 * geprüft wird deshalb der Quellbaum, und zwar genau die Stellen, an denen
 * die Befunde saßen:
 *
 *  1. **Eine Abweisung am stornierten Eintrag ist sichtbar.** Korrigieren
 *     zwei Kräfte dieselbe Seite, wirft die zweite Richtigstellung
 *     `SchonStorniert` (`ungueltiger_zustand`), und die Route führt auf das
 *     Blatt zurück — das inzwischen storniert ist. Der Grund stand nur im
 *     Abschnitt „Richtigstellen", und der fehlt am stornierten Eintrag: die
 *     Seite sah aus wie ein Erfolg, Text und Fotos waren verworfen.
 *  2. **Das Formular der Richtigstellung nur mit `wachbuch.schreiben`.** Das
 *     Blatt verlangt nur `wachbuch.lesen`; ein Leser bekam das Formular und
 *     danach den unbekannten Grund `NICHT_GEFUNDEN` aus dem Rechtetor.
 *  3. **Die Art „Schlüssel" nur, wenn ein Schlüssel wählbar ist.** Ohne
 *     `schluessel.lesen` oder ohne erfassten Schlüssel konnte sie nur an
 *     `schluessel_fehlt` scheitern — der getippte Text war danach weg.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WACHBUCH_TEXTE } from '../../src/lib/i18n/verwaltung/wachbuch.js';

const BLATT = readFileSync('src/app/portal/[mandant]/security/wachbuch/[id]/page.tsx', 'utf8');
const NEU = readFileSync('src/app/portal/[mandant]/security/wachbuch/neu/page.tsx', 'utf8');

/** Der Quelltext ohne Kommentare — eine Erwähnung ist keine Stelle. */
function ohneKommentare(q: string): string {
  return q.replace(/\{\/\*[\s\S]*?\*\/\}/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n').map((z) => z.replace(/(^|\s)\/\/.*$/u, '$1')).join('\n');
}

describe('(1) die Abweisung steht über dem Blatt — auch am stornierten Eintrag', () => {
  const q = ohneKommentare(BLATT);

  it('der Hinweis steht vor dem Blatt und nur einmal', () => {
    const hinweis = q.indexOf('cse="wachbuch-abgewiesen"');
    expect(hinweis).toBeGreaterThan(-1);
    expect(q.indexOf('cse="wachbuch-abgewiesen"', hinweis + 1)).toBe(-1);
    expect(hinweis).toBeLessThan(q.indexOf('<article'));
  });

  it('und hängt an keiner Bedingung „nicht storniert"', () => {
    const vorHinweis = q.slice(0, q.indexOf('cse="wachbuch-abgewiesen"'));
    const block = vorHinweis.slice(vorHinweis.lastIndexOf('{'));
    expect(block).toMatch(/^\{fehler !== null && \(/u);
    expect(block).not.toContain('storniert');
  });

  it('am stornierten Eintrag verweist er auf die Seite, an die eine Korrektur anknüpft', () => {
    const hinweis = q.slice(q.indexOf('cse="wachbuch-abgewiesen"'), q.indexOf('<article'));
    expect(hinweis).toContain('eintrag.storniert && eintrag.ersetztDurchId !== null');
    expect(hinweis).toContain('/security/wachbuch/${eintrag.ersetztDurchId}');
    expect(hinweis).toContain('{tW.zurRichtigstellung}');
    for (const s of ['de', 'en'] as const) {
      expect(WACHBUCH_TEXTE[s].zurRichtigstellung).toMatch(/\S/u);
      /* Der Satz zu `ungueltiger_zustand` nennt genau diesen Fall. */
      expect(WACHBUCH_TEXTE[s].fehler['ungueltiger_zustand']).toMatch(/storniert|cancelled/u);
    }
  });
});

describe('(2) richtigstellen darf, wer schreiben darf', () => {
  const q = ohneKommentare(BLATT);

  it('das Blatt fragt wachbuch.schreiben', () => {
    expect(q).toContain("haeltRechte(sitzung, 'schluessel.lesen', 'wachbuch.schreiben')");
  });

  it('Formular nur mit dem Recht, ohne es der Satz', () => {
    const formular = q.indexOf('Richtigstellung schreiben');
    const vorFormular = q.slice(0, formular);
    expect(vorFormular.slice(vorFormular.lastIndexOf('{!eintrag.storniert')))
      .toMatch(/^\{!eintrag\.storniert && darf\['wachbuch\.schreiben'\] === true && \(/u);
    expect(q).toMatch(
      /\{!eintrag\.storniert && darf\['wachbuch\.schreiben'\] !== true && \(\s*<p[^>]*data-cse="richtigstellen-ohne-recht"/u);
    for (const s of ['de', 'en'] as const) {
      expect(WACHBUCH_TEXTE[s].richtigstellenOhneRecht).toMatch(/\S/u);
    }
  });
});

describe('(3) die Art „Schlüssel" nur mit einem wählbaren Schlüssel', () => {
  const q = ohneKommentare(NEU);

  it('die Arten sind gefiltert, und die Auswahl hängt an derselben Bedingung', () => {
    expect(q).toContain('const schluesselWaehlbar = schluessel !== null && schluessel.length > 0;');
    expect(q).toContain(
      "WACHBUCH_ARTEN.filter((a) => a !== 'schluessel' || schluesselWaehlbar)");
    expect(q).toContain('{arten.map((a) => (');
    expect(q).not.toContain('WACHBUCH_ARTEN.map(');
    expect(q).toContain('{schluesselWaehlbar && (');
  });

  it('ohne sie steht der Grund: kein Recht oder kein erfasster Schlüssel', () => {
    expect(q).toContain('{schluessel === null ? tW.schluesselOhneRecht : tW.keinSchluessel}');
    for (const s of ['de', 'en'] as const) {
      expect(WACHBUCH_TEXTE[s].schluesselOhneRecht).toMatch(/\S/u);
      expect(WACHBUCH_TEXTE[s].keinSchluessel).toMatch(/\S/u);
    }
  });
});
