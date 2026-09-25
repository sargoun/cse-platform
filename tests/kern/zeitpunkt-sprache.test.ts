/**
 * Zeitpunkte auf den Flächen der Beschäftigten stehen in der gesetzlichen
 * Form — Berliner Ortszeit, 24-Stunden-Uhr, nie Monat vor Tag (V-201,
 * SEITENKARTE §12, D-693 Nr. 3 berichtigt).
 *
 * **Der Befund.** Abwesenheits- und Antragsblatt, Posteingang, Faden,
 * Einwandblatt und die Sicherheitsseite des Kontos formatierten mit
 * `Intl.DateTimeFormat(<Portalsprache>, …)`: Arabisch „10:30 م", Englisch
 * „Sep 11, 2026, 10:30 PM" und „09/11/2026", Türkisch „11 Eyl 2026 22:30" —
 * neben dem Kalendertag „11.09.2026" desselben Blatts.
 *
 * **Geprüft zweimal:** die Umformung selbst (vier Sprachen, Mitternacht, beide
 * Nächte der Zeitumstellung, Tagesgrenze UTC/Berlin) und der Quellbaum — keine
 * `.tsx` unter den Wurzeln der Beschäftigten formatiert einen Zeitpunkt mit
 * einer anderen Sprache als der festen deutschen Form.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  tagVonZeitpunktInSprache, zeitpunktInSprache,
} from '../../src/lib/datum/zeitpunkt.js';
import { tagInSprache } from '../../src/lib/datum/kalendertag.js';

const WURZEL = join(import.meta.dirname, '..', '..');

describe('zeitpunktInSprache', () => {
  const abend = new Date('2026-09-11T20:30:00Z');

  it('de, ar und tr schreiben TT.MM.JJJJ HH:MM in Berliner Ortszeit', () => {
    for (const s of ['de', 'ar', 'tr']) {
      expect(zeitpunktInSprache(abend, s), s).toBe('11.09.2026 22:30');
    }
  });

  it('en schreibt britisch mit 24-Stunden-Uhr, nie AM/PM, nie Monat vor Tag', () => {
    const en = zeitpunktInSprache(abend, 'en');
    expect(en).toMatch(/^11 Sept? 2026, 22:30$/u);
    expect(en).not.toMatch(/[AP]M/u);
  });

  it('keine Sprache schreibt 12-Stunden-Uhr, arabisch-indische Ziffern oder Schrägstriche', () => {
    for (const s of ['de', 'en', 'ar', 'tr', null, undefined, 'xx']) {
      const text = zeitpunktInSprache(abend, s);
      expect(text, String(s)).not.toMatch(/[AP]M|م|ص|\//u);
      expect(text, String(s)).not.toMatch(/[٠-٩۰-۹]/u);
      expect(text, String(s)).toContain('22:30');
    }
  });

  it('Mitternacht in Berlin ist 00:00, nicht 24:00 — und schon der nächste Tag', () => {
    const d = new Date('2026-01-01T23:00:00Z');
    expect(zeitpunktInSprache(d, 'de')).toBe('02.01.2026 00:00');
    expect(tagVonZeitpunktInSprache(d, 'tr')).toBe('02.01.2026');
  });

  it('die Nacht der Umstellung auf Sommerzeit: 01:59 und dann 03:00', () => {
    expect(zeitpunktInSprache('2026-03-29T00:59:00Z', 'de')).toBe('29.03.2026 01:59');
    expect(zeitpunktInSprache('2026-03-29T01:00:00Z', 'de')).toBe('29.03.2026 03:00');
  });

  it('die Nacht der Umstellung auf Winterzeit: zweimal 02:30, eine Stunde auseinander', () => {
    expect(zeitpunktInSprache('2026-10-25T00:30:00Z', 'ar')).toBe('25.10.2026 02:30');
    expect(zeitpunktInSprache('2026-10-25T01:30:00Z', 'ar')).toBe('25.10.2026 02:30');
  });

  it('leer ergibt leer; was kein Zeitpunkt ist, bleibt sichtbar', () => {
    expect(zeitpunktInSprache(null, 'de')).toBe('');
    expect(zeitpunktInSprache(undefined, 'en')).toBe('');
    expect(zeitpunktInSprache('quatsch', 'de')).toBe('quatsch');
    expect(zeitpunktInSprache(new Date(Number.NaN), 'de')).toBe('');
  });
});

describe('tagVonZeitpunktInSprache', () => {
  it('schreibt denselben Tag wie tagInSprache — in jeder Sprache', () => {
    const d = new Date('2026-09-11T08:00:00Z');
    for (const s of ['de', 'en', 'ar', 'tr']) {
      expect(tagVonZeitpunktInSprache(d, s), s).toBe(tagInSprache('2026-09-11', s));
    }
  });

  it('der Berliner Tag zählt, nicht der UTC-Tag', () => {
    // 22:30 UTC am 10. ist in Berlin (Sommerzeit) 00:30 am 11.
    expect(tagVonZeitpunktInSprache('2026-09-10T22:30:00Z', 'de')).toBe('11.09.2026');
    expect(tagVonZeitpunktInSprache('2026-09-10T22:30:00Z', 'en')).toMatch(/^11 Sept? 2026$/u);
  });

  it('englisch nie „09/11/2026"', () => {
    expect(tagVonZeitpunktInSprache('2026-09-11T08:00:00Z', 'en')).not.toMatch(/\//u);
  });
});

/* ───────────────────────────── Der Quellbaum ───────────────────────────── */

/** Die Flächen der Beschäftigten (SEITENKARTE §12). */
const FLAECHEN = [
  'src/app/portal/mein', 'src/app/portal/konto', 'src/app/check-in', 'src/app/auth/mitarbeiter',
];

function dateien(): readonly string[] {
  return FLAECHEN.flatMap((w) => {
    const pfad = join(WURZEL, w);
    return readdirSync(pfad, { recursive: true, encoding: 'utf8' })
      .filter((d) => d.endsWith('.tsx') || d.endsWith('.ts'))
      .map((d) => join(pfad, d));
  });
}

/** Nur Code: Kommentare sprechen über das alte Muster, sie benutzen es nicht. */
function codeZeilen(pfad: string): readonly [number, string][] {
  return readFileSync(pfad, 'utf8').split('\n')
    .map((z, i): [number, string] => [i + 1, z])
    .filter(([, z]) => !/^\s*(?:\*|\/\/|\/\*|\{\/\*)/u.test(z));
}

describe('Zeitpunkte auf den Flächen der Beschäftigten', () => {
  it('der Quellbaum ist gefunden', () => {
    expect(dateien().length).toBeGreaterThan(40);
  });

  it('kein Intl-Datumsformat in einer anderen Form als der festen deutschen', () => {
    const funde: string[] = [];
    for (const pfad of dateien()) {
      for (const [n, z] of codeZeilen(pfad)) {
        const intl = /Intl\.DateTimeFormat\(\s*([^,)]*)/u.exec(z);
        if (intl !== null && intl[1]?.trim() !== `'de-DE'`) {
          funde.push(`${relative(WURZEL, pfad)}:${String(n)}: ${z.trim()}`);
        }
        if (/\.toLocale(?:Date|Time)?String\(/u.test(z)) {
          funde.push(`${relative(WURZEL, pfad)}:${String(n)}: ${z.trim()}`);
        }
      }
    }
    expect(funde).toEqual([]);
  });

  it('die Gegenprobe: das Muster trifft die alten Fälle', () => {
    const alt = [
      "const zeitpunkt = new Intl.DateTimeFormat(basis.sprache === 'de' ? 'de-DE' : basis.sprache, {",
      'const tagFormat = new Intl.DateTimeFormat(PORTAL_BCP47[basis.sprache], {',
      'const zeit = new Intl.DateTimeFormat(PORTAL_BCP47[aktuell], {',
    ];
    for (const z of alt) {
      const intl = /Intl\.DateTimeFormat\(\s*([^,)]*)/u.exec(z);
      expect(intl?.[1]?.trim(), z).not.toBe(`'de-DE'`);
    }
  });
});
