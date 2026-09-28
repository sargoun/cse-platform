/**
 * Tage und Mengen im Arbeiterportal stehen als Zahl, nicht als Postgres-Text
 * (V-194, EMP-05, EMP-10, EMP-12, CLN-04, BAU-07).
 *
 * **Der Befund.** `abwesenheit.tage_angerechnet` ist `numeric(12,3)` und kommt
 * als Text „5.000" — das IST die Zahl fünf. Das Blatt einer Abwesenheit teilte
 * sie trotzdem durch 1000 und zeigte eine fünftägige Krankmeldung mit „0";
 * die Liste unter „Anträge" gab „5.000" roh aus, und das liest ein deutscher
 * Leser als fünftausend. Dieselbe Rohform stand bei der Menge auf dem
 * Unterschriftsblatt des Leistungsnachweises („12.500") und bei der Menge
 * einer Bautagebuchzeile.
 *
 * Geprüft werden zwei Dinge: die Umformung selbst — und am QUELLBAUM, dass
 * keine Seite unter `src/app/portal/mein` einen dieser Werte wieder roh in JSX
 * reicht. Eine neue Seite ist damit geprüft, bevor irgendeine Liste sie kennt.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatiereTage, milliMenge, tageAusPostgres,
} from '../../src/server/services/finanz/menge.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const MEIN = join(WURZEL, 'src/app/portal/mein');

function dateien(verzeichnis: string): string[] {
  const alle: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) alle.push(...dateien(voll));
    else if (voll.endsWith('.tsx')) alle.push(voll);
  }
  return alle;
}

describe('formatiereTage / tageAusPostgres (V-194)', () => {
  it('„5.000" ist fünf Tage — nicht fünftausend und nicht null', () => {
    expect(tageAusPostgres('5.000')).toBe('5');
    expect(tageAusPostgres('5.000', 'de')).toBe('5');
  });

  it('ein halber Tag bleibt sichtbar, ohne Nullen am Ende', () => {
    expect(tageAusPostgres('1.500')).toBe('1,5');
    expect(tageAusPostgres('0.500', 'tr')).toBe('0,5');
    expect(tageAusPostgres('2.250', 'ar')).toBe('2,25');
  });

  it('englisch mit englischem Dezimalzeichen, sonst die deutsche Form', () => {
    expect(tageAusPostgres('1.500', 'en')).toBe('1.5');
    expect(formatiereTage(milliMenge(1_234_000n), 'en')).toBe('1,234');
    expect(formatiereTage(milliMenge(1_234_000n), 'de')).toBe('1.234');
  });

  it('„noch nicht berechnet" ist ein Gedankenstrich, keine Null', () => {
    expect(tageAusPostgres(null)).toBe('—');
    expect(tageAusPostgres(null, 'en')).toBe('—');
  });

  it('eine Form, die nicht aus der Spalte kommt, wird abgewiesen statt geraten', () => {
    expect(() => tageAusPostgres('5,000')).toThrow();
    expect(() => tageAusPostgres('1.2345')).toThrow();
  });
});

describe('keine Seite des Arbeiterportals reicht eine numeric-Spalte roh durch', () => {
  const alle = dateien(MEIN);

  it('die Wache liest überhaupt Seiten', () => {
    expect(alle.length).toBeGreaterThan(20);
  });

  it('Tage und Mengen stehen nie roh in einer JSX-Klammer', () => {
    // `{a.abwesenheit.tageAngerechnet ?? '—'}`, `{p.menge}`, `{q.menge ?? '—'}` —
    // nicht aber die BESCHRIFTUNG `{t.menge}` aus `MeinTexte`.
    const ROH =
      /\{\s*(?!t\.|texte\.)[\w.]+\.(?:tageAngerechnet|menge|anspruchTage|restTage)\s*(?:\?\?\s*'[^']*')?\s*\}/u;
    const funde = alle
      .filter((d) => ROH.test(readFileSync(d, 'utf8')))
      .map((d) => relative(WURZEL, d));
    expect(funde).toEqual([]);
  });

  it('und niemand teilt eine Tageszahl durch 1000', () => {
    const funde = alle
      .filter((d) => /tage\w*\s*\)?\s*\/\s*1000\b|zahl\s*\/\s*1000\b/iu.test(readFileSync(d, 'utf8')))
      .map((d) => relative(WURZEL, d));
    expect(funde).toEqual([]);
  });
});
