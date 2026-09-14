/**
 * Das Wirtschaftsjahr (`buchhaltung/wirtschaftsjahr.ts`) — Zeitraeume ohne
 * Uhr und ohne Zone.
 */
import { describe, expect, it } from 'vitest';
import {
  KALENDERJAHR, WirtschaftsjahrFehler, wirtschaftsjahrVon, wirtschaftsjahrZeitraum,
} from '../../src/server/services/buchhaltung/wirtschaftsjahr.js';

const JULI = { beginnMonat: 7, beginnTag: 1, istPlatzhalter: false };

describe('Zeitraum', () => {
  it('Kalenderjahr: 1.1. bis 31.12., benannt nach dem Jahr', () => {
    expect(wirtschaftsjahrZeitraum(2026, KALENDERJAHR))
      .toEqual({ von: '2026-01-01', bis: '2026-12-31', bezeichnung: '2026' });
  });

  it('abweichend ab 1. Juli: bis zum 30. Juni des Folgejahrs, benannt mit beiden Jahren', () => {
    expect(wirtschaftsjahrZeitraum(2026, JULI))
      .toEqual({ von: '2026-07-01', bis: '2027-06-30', bezeichnung: '2026/2027' });
  });

  it('ein Schaltjahr aendert nichts an den Grenzen, nur an der Laenge', () => {
    expect(wirtschaftsjahrZeitraum(2028, { beginnMonat: 3, beginnTag: 1, istPlatzhalter: false }))
      .toEqual({ von: '2028-03-01', bis: '2029-02-28', bezeichnung: '2028/2029' });
    expect(wirtschaftsjahrZeitraum(2027, { beginnMonat: 3, beginnTag: 1, istPlatzhalter: false }).bis)
      .toBe('2028-02-29');
  });

  it('ein Beginn, den es nicht gibt, ist ein Fehler — keine stille Verschiebung', () => {
    expect(() => wirtschaftsjahrZeitraum(2026, { beginnMonat: 2, beginnTag: 30, istPlatzhalter: false }))
      .toThrow(WirtschaftsjahrFehler);
    expect(() => wirtschaftsjahrZeitraum(1800, KALENDERJAHR)).toThrow(WirtschaftsjahrFehler);
  });
});

describe('Zuordnung eines Tages', () => {
  it('Kalenderjahr: das Jahr des Datums', () => {
    expect(wirtschaftsjahrVon('2026-12-31', KALENDERJAHR)).toBe(2026);
  });

  it('abweichend: vor dem Beginn zaehlt das Vorjahr', () => {
    expect(wirtschaftsjahrVon('2027-03-15', JULI)).toBe(2026);
    expect(wirtschaftsjahrVon('2026-07-01', JULI)).toBe(2026);
    expect(wirtschaftsjahrVon('2026-06-30', JULI)).toBe(2025);
  });

  it('kein ISO-Tag ist ein Fehler', () => {
    expect(() => wirtschaftsjahrVon('15.03.2027', JULI)).toThrow(WirtschaftsjahrFehler);
  });
});
