/**
 * D-487 — die Wochenregel einer Serie, ohne Datenbank.
 *
 * Wochentage werden zu `FREQ=WEEKLY;BYDAY=…` — in Wochenreihenfolge, ohne
 * Doppelte, ohne Anker — und der Generator liest die Regel mit demselben
 * Parser. Was kein Wochentag ist, ist ein Fehler, keine Auslassung.
 */
import { describe, expect, it } from 'vitest';
import { SerieEingabeFehlt, wochenRegel } from '../../src/server/services/dienstplan/serie.js';
import { leseRegel } from '../../src/lib/datum/rrule.js';

describe('wochenRegel', () => {
  it('ordnet, entdoppelt und liest Kleinschreibung', () => {
    expect(wochenRegel(['MO', 'WE', 'FR'])).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(wochenRegel(['fr', 'MO', 'mo', 'SU'])).toBe('FREQ=WEEKLY;BYDAY=MO,FR,SU');
    expect(wochenRegel(['TU'])).toBe('FREQ=WEEKLY;BYDAY=TU');
  });

  it('liefert, was der Generator liest — kein Anker in der Regel', () => {
    const regel = wochenRegel(['MO', 'TU', 'WE', 'TH', 'FR']);
    const r = leseRegel(regel);
    expect(r.freq).toBe('WEEKLY');
    expect(r.byday).toEqual(['MO', 'TU', 'WE', 'TH', 'FR']);
    expect(regel).not.toMatch(/DTSTART|TZID|RRULE:/u);
  });

  it('weist Unbekanntes und Leeres ab', () => {
    expect(() => wochenRegel([])).toThrow(SerieEingabeFehlt);
    expect(() => wochenRegel(['MO', 'Montag'])).toThrow(SerieEingabeFehlt);
    expect(() => wochenRegel(['XX'])).toThrow(/kein Wochentag/u);
  });
});
