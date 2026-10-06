/**
 * Die Toleranz des Mannstundenabgleichs — die Voreinstellung zu O-280 (D-782).
 *
 * Sie BESCHRIFTET, sie glaettet nicht: eine Differenz ab einer Minute bleibt
 * eine Abweichung, und der Satz sagt dazu, ob sie ueber oder unter 30 Minuten
 * liegt. Genau 30 Minuten sind noch innerhalb; das Vorzeichen zaehlt nicht.
 */
import { describe, expect, it } from 'vitest';
import {
  ABGLEICH_TOLERANZ_MINUTEN, istAuffaellig, toleranzSatz,
} from '../../src/server/services/bau/bautagebuch.js';

describe('O-280 — auffällig ab mehr als 30 Minuten, in beide Richtungen', () => {
  it('die Voreinstellung ist 30 Minuten', () => {
    expect(ABGLEICH_TOLERANZ_MINUTEN).toBe(30);
  });

  it('30 ist innerhalb, 31 ist darüber — mit und ohne Vorzeichen', () => {
    expect(istAuffaellig(0)).toBe(false);
    expect(istAuffaellig(30)).toBe(false);
    expect(istAuffaellig(-30)).toBe(false);
    expect(istAuffaellig(31)).toBe(true);
    expect(istAuffaellig(-31)).toBe(true);
    expect(istAuffaellig(480)).toBe(true);
  });

  it('der Satz nennt die Zahl, die Nummer und die Richtung — und verschweigt nichts', () => {
    expect(toleranzSatz(15)).toMatch(/innerhalb der Voreinstellung von 30 Minuten/u);
    expect(toleranzSatz(15)).toContain('O-280');
    expect(toleranzSatz(15)).toMatch(/gemeldet, nicht geglättet/u);
    expect(toleranzSatz(-45)).toMatch(/über der Voreinstellung von 30 Minuten/u);
    expect(toleranzSatz(-45)).toMatch(/auffällig/u);
  });
});
