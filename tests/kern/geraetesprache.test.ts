/**
 * Stempeluhr und Anmeldung der Beschäftigten sprechen die vier Sprachen des
 * Arbeiterportals (V-200, EMP-12, SEITENKARTE §12).
 *
 * Geprüft wird die Regel, aus der die Sprache entsteht (Keks, dann
 * `Accept-Language`, dann Deutsch), die Vollständigkeit der Texte in allen
 * vier Sprachen, und dass die Flächen selbst keinen festen deutschen Satz mehr
 * tragen und `lang`/`dir` setzen.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  geraeteSprache, setzeEin, spracheAusKopf, SPRACH_KEKS,
} from '../../src/lib/i18n/geraetesprache.js';
import { ANMELDUNG_TEXTE, STEMPEL_TEXTE } from '../../src/lib/i18n/vor-anmeldung.js';
import { PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';

const WURZEL = resolve(import.meta.dirname, '../..');

function quelle(pfad: string): string {
  return readFileSync(join(WURZEL, pfad), 'utf8');
}

/** Der Quelltext ohne Block- und Zeilenkommentare. */
function ohneKommentare(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

describe('die Sprache einer Fläche ohne Sitzung', () => {
  it('Accept-Language: die erste der vier Sprachen nach Gewicht', () => {
    expect(spracheAusKopf('tr-TR,tr;q=0.9,en;q=0.8')).toBe('tr');
    expect(spracheAusKopf('ar-EG')).toBe('ar');
    expect(spracheAusKopf('fr-FR,en;q=0.5')).toBe('en');
    expect(spracheAusKopf('en;q=0.4,ar;q=0.9')).toBe('ar');
    expect(spracheAusKopf('de-DE,de;q=0.9')).toBe('de');
  });

  it('bei gleichem Gewicht gewinnt, was zuerst steht', () => {
    expect(spracheAusKopf('tr, ar')).toBe('tr');
    expect(spracheAusKopf('en;q=0.5, de;q=0.5')).toBe('en');
  });

  it('nichts Brauchbares ist null — `*`, q=0, fremde Sprachen, Unsinn', () => {
    expect(spracheAusKopf(null)).toBeNull();
    expect(spracheAusKopf('')).toBeNull();
    expect(spracheAusKopf('*')).toBeNull();
    expect(spracheAusKopf('fr-FR,es;q=0.5')).toBeNull();
    expect(spracheAusKopf('ar;q=0')).toBeNull();
    expect(spracheAusKopf('ar;q=abc')).toBeNull();
    expect(spracheAusKopf(';;,,')).toBeNull();
  });

  it('der Keks geht vor, dann der Kopf, dann Deutsch', () => {
    expect(geraeteSprache('ar', 'tr-TR')).toBe('ar');
    expect(geraeteSprache(undefined, 'tr-TR')).toBe('tr');
    expect(geraeteSprache('fr', 'en-GB')).toBe('en');
    expect(geraeteSprache(undefined, 'fr-FR')).toBe('de');
    expect(geraeteSprache(null, null)).toBe('de');
    // Ein Keks ist eine Eingabe des Browsers — nur die vier Werte zählen.
    expect(geraeteSprache('__proto__', null)).toBe('de');
  });

  it('der Keks heisst, wie die Route ihn setzt', () => {
    expect(SPRACH_KEKS).toBe('cse_sprache');
    expect(quelle('src/app/api/geraetesprache/route.ts')).toContain('SPRACH_KEKS');
  });

  it('setzeEin füllt nur, was es gibt', () => {
    expect(setzeEin('{anzahl} Einträge', { anzahl: '3' })).toBe('3 Einträge');
    expect(setzeEin('{fehlt} und {anzahl}', { anzahl: '2' })).toBe('{fehlt} und 2');
    expect(setzeEin('{constructor}', {})).toBe('{constructor}');
  });
});

/** Alle Zeichenketten eines Textsatzes, flach. */
function flach(wert: object): Readonly<Record<string, string>> {
  const raus: Record<string, string> = {};
  for (const [k, v] of Object.entries(wert)) {
    if (typeof v === 'string') raus[k] = v;
  }
  return raus;
}

describe.each([
  ['Stempeluhr', STEMPEL_TEXTE],
  ['Anmeldung', ANMELDUNG_TEXTE],
] as const)('%s: keine halbe Übersetzung', (_name, texte) => {
  const deutsch = flach(texte.de);
  const schluessel = Object.keys(deutsch);

  it('jede Sprache trägt jeden Schlüssel, und keiner ist leer', () => {
    expect(schluessel.length).toBeGreaterThan(15);
    for (const s of PORTAL_SPRACHEN) {
      const t = flach(texte[s]);
      expect(Object.keys(t).sort(), s).toEqual([...schluessel].sort());
      for (const k of schluessel) expect(t[k]?.trim(), `${s}.${k}`).not.toBe('');
    }
  });

  it('und keine Sprache ausser Deutsch gibt den deutschen Text zurück', () => {
    for (const s of PORTAL_SPRACHEN.filter((x) => x !== 'de')) {
      const t = flach(texte[s]);
      const gleich = schluessel.filter((k) => t[k] === deutsch[k]);
      expect(gleich, s).toEqual([]);
    }
  });

  it('die Platzhalter stehen in jeder Sprache', () => {
    for (const s of PORTAL_SPRACHEN) {
      const t = flach(texte[s]);
      for (const k of schluessel) {
        const soll = (deutsch[k]?.match(/\{\w+\}/gu) ?? []).sort();
        expect((t[k]?.match(/\{\w+\}/gu) ?? []).sort(), `${s}.${k}`).toEqual(soll);
      }
    }
  });
});

describe('die Flächen selbst', () => {
  const FLAECHEN = [
    'src/app/check-in/[token]/page.tsx',
    'src/app/check-in/[token]/Stempeluhr.tsx',
    'src/app/check-in/[token]/Schichtfoto.tsx',
    'src/app/auth/mitarbeiter/page.tsx',
    'src/app/auth/mitarbeiter/code/page.tsx',
  ] as const;

  it.each(FLAECHEN)('%s trägt keinen der alten deutschen Sätze mehr', (datei) => {
    const s = quelle(datei);
    for (const satz of [
      '>Zeiterfassung<', 'Ein Tipp genügt', "'Einstempeln'", 'Ohne Verbindung gemerkt',
      "'Dieser Link ist nicht gültig.'", 'Foto von der Schicht', 'Mobilnummer"',
      'Code anfordern', 'Code eingeben', 'Sechsstelliger Code', 'Andere Nummer',
    ]) {
      /* Kommentare dürfen die Sätze nennen — der Bildschirm nicht. */
      expect(ohneKommentare(s), `${datei}: ${satz}`).not.toContain(satz);
    }
  });

  it('die Seiten lesen die Sprache des Geräts und setzen lang und dir', () => {
    for (const datei of [
      'src/app/check-in/[token]/page.tsx',
      'src/app/auth/mitarbeiter/page.tsx',
      'src/app/auth/mitarbeiter/code/page.tsx',
    ]) {
      const s = quelle(datei);
      expect(s, datei).toContain('geraeteSprache(');
      expect(s, datei).toMatch(/accept-language/iu);
      /* Die Stempeluhr setzt `lang` selbst, die Anmeldung über ihren Rahmen. */
      expect(s, datei).toMatch(/PORTAL_BCP47\[|sprache=\{sprache\}/u);
    }
    // Der Rahmen der Anmeldung trägt `lang` und `dir` selbst.
    const schale = quelle('src/app/auth/AuthSchale.tsx');
    expect(schale).toMatch(/\blang:\s*PORTAL_BCP47\[sprache\]/u);
    expect(schale).toMatch(/\bdir:\s*PORTAL_RICHTUNG\[sprache\]/u);
  });

  it('die Stempeluhr zeigt eine Ablehnung in IHRER Sprache, nicht den Satz des Servers', () => {
    const uhr = quelle('src/app/check-in/[token]/Stempeluhr.tsx');
    expect(uhr).not.toMatch(/error\?\.message\s*\?\?/u);
    const foto = quelle('src/app/check-in/[token]/Schichtfoto.tsx');
    expect(foto).not.toMatch(/daten\.error\.message/u);
  });

  it('Arabisch ist RTL — die Richtung kommt aus derselben Tabelle wie im Portal', () => {
    const seite = quelle('src/app/check-in/[token]/page.tsx');
    expect(seite).toContain('PORTAL_RICHTUNG');
  });
});
