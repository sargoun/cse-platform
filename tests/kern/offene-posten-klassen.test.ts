/**
 * Die Altersklassen der offenen Posten (`buchhaltung/offene-posten.ts`) —
 * dieselben Grenzen wie im SQL, hier an den Kanten geprueft.
 */
import { describe, expect, it } from 'vitest';
import { KLASSEN, klasseFuer } from '../../src/server/services/buchhaltung/offene-posten.js';
import { KALENDERJAHR, type Wirtschaftsjahr } from '../../src/server/services/buchhaltung/wirtschaftsjahr.js';
import { monateDesWirtschaftsjahrs } from '../../src/server/services/buchhaltung/monatszahlen.js';

describe('Altersklassen', () => {
  it('teilt an den Kanten 0, 30, 60, 90 — und nicht faellig davor', () => {
    expect(klasseFuer(-1)).toBe('nicht_faellig');
    expect(klasseFuer(0)).toBe('bis30');
    expect(klasseFuer(30)).toBe('bis30');
    expect(klasseFuer(31)).toBe('bis60');
    expect(klasseFuer(60)).toBe('bis60');
    expect(klasseFuer(61)).toBe('bis90');
    expect(klasseFuer(90)).toBe('bis90');
    expect(klasseFuer(91)).toBe('ueber90');
    expect(klasseFuer(400)).toBe('ueber90');
  });

  it('kennt genau fuenf Klassen, jede Zahl faellt in eine', () => {
    expect(KLASSEN).toHaveLength(5);
    for (let t = -100; t <= 400; t += 1) expect(KLASSEN).toContain(klasseFuer(t));
  });
});

describe('Monate eines Wirtschaftsjahrs', () => {
  it('Kalenderjahr: Januar bis Dezember mit Monatsgrenzen', () => {
    const m = monateDesWirtschaftsjahrs(2026, KALENDERJAHR);
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ monat: '2026-01', label: 'Januar 2026', von: '2026-01-01', bis: '2026-01-31' });
    expect(m[1]?.bis).toBe('2026-02-28');
    expect(m[11]).toEqual({ monat: '2026-12', label: 'Dezember 2026', von: '2026-12-01', bis: '2026-12-31' });
  });

  it('abweichend ab Juli: Juli bis Juni des Folgejahrs — ueber den Jahreswechsel und die Umstellung hinweg', () => {
    const wj: Wirtschaftsjahr = { beginnMonat: 7, beginnTag: 1, istPlatzhalter: false };
    const m = monateDesWirtschaftsjahrs(2026, wj);
    expect(m[0]?.monat).toBe('2026-07');
    expect(m[5]?.monat).toBe('2026-12');
    expect(m[6]?.monat).toBe('2027-01');
    expect(m[8]).toEqual({ monat: '2027-03', label: 'März 2027', von: '2027-03-01', bis: '2027-03-31' });
    expect(m[11]?.monat).toBe('2027-06');
  });
});
