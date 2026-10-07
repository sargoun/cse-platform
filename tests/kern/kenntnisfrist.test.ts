/**
 * **Wann eine Kenntnisnahme versäumt ist** (V-382, O-241, D-811) — die Grenze
 * ohne Datenbank.
 *
 * Voreinstellung (D-800): versäumt ab Beginn der ersten Schicht auf dem
 * Objekt nach der Veröffentlichung der geltenden Fassung; davor fällig; ohne
 * eine solche Schicht offen ohne Zeitpunkt. Keine Sperre. Welche Schicht die
 * erste ist, liest `leseErsteSchichten` an echtem Postgres
 * (`tests/isolation/dienstanweisung-versaeumt.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { kenntnisfrist } from '../../src/server/services/security/dienstanweisung.js';

/* 22:00 Berliner Zeit am 3. Oktober 2026 (MESZ) — eine Nachtschicht. */
const schicht = new Date('2026-10-03T20:00:00Z');

describe('V-382 — die Frist der Kenntnisnahme', () => {
  it('bestätigt bleibt bestätigt, auch wenn die Schicht längst lief', () => {
    expect(kenntnisfrist(true, schicht, new Date('2026-10-05T08:00:00Z')))
      .toEqual({ art: 'bestaetigt' });
  });

  it('vor Schichtbeginn ist sie fällig — mit der Schicht als Frist', () => {
    expect(kenntnisfrist(false, schicht, new Date('2026-10-03T19:59:59Z')))
      .toEqual({ art: 'faellig', vor: schicht });
  });

  it('mit Schichtbeginn ist sie versäumt — die Wache steht schon am Objekt', () => {
    expect(kenntnisfrist(false, schicht, new Date('2026-10-03T20:00:00Z')))
      .toEqual({ art: 'versaeumt', seit: schicht });
    expect(kenntnisfrist(false, schicht, new Date('2026-10-04T03:00:00Z')))
      .toEqual({ art: 'versaeumt', seit: schicht });
  });

  it('ohne Schicht nach der Veröffentlichung ist sie offen, aber ohne Zeitpunkt', () => {
    expect(kenntnisfrist(false, null, new Date('2026-10-05T08:00:00Z')))
      .toEqual({ art: 'ohne_schicht' });
  });

  it('die Uhr der Gegenseite zählt nicht: verglichen werden Zeitpunkte, keine Ortszeiten', () => {
    // Die Rücknacht (25. Oktober 2026, 03:00 → 02:00): 00:30 UTC ist 02:30
    // MESZ, 01:30 UTC ist 02:30 MEZ — dieselbe Ortszeit, zwei Zeitpunkte.
    const rueck = new Date('2026-10-25T00:30:00Z');
    expect(kenntnisfrist(false, rueck, new Date('2026-10-25T00:29:59Z')).art).toBe('faellig');
    expect(kenntnisfrist(false, rueck, new Date('2026-10-25T01:30:00Z')).art).toBe('versaeumt');
  });
});
