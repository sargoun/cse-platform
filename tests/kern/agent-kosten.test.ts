/**
 * Die Kostenarithmetik der Agenten (AGT-04, AGT-05, K-16(b), PR 74).
 *
 * **Warum Mikrocent überhaupt.** Der erste Test hier ist der Grund für die
 * ganze Einheit: auf Cent gerundet kostet ein einzelner Modellaufruf 0, und
 * hundert Aufrufe kosten 0 — während die Rechnung des Anbieters wächst. Das
 * Monatsbudget wäre damit eine Zahl, die nie erreicht wird.
 */
import { describe, expect, it } from 'vitest';
import {
  kostenMikrocent, mikrocentAlsEuro, mikrocentNachCent,
} from '../../src/server/agent/kosten.js';

/** Ein realistischer Preis: 300 Mikrocent je 1.000 Token = 300.000 je Mio. */
const PREIS = {
  eingabeJeMioToken: 300_000n,
  ausgabeJeMioToken: 1_500_000n,
  gedankenJeMioToken: null,
};

describe('ein Aufruf kostet Bruchteile eines Cents — und die zählen', () => {
  it('tausend Eingabe-Token sind 300 Mikrocent, nicht 0 Cent', () => {
    const kosten = kostenMikrocent(
      { eingabe: 1000n, ausgabe: 0n, gedanken: 0n }, PREIS);
    expect(kosten).toBe(300n);
    // Und genau hier stirbt die Cent-Rechnung: 300 Mikrocent sind 0 Cent.
    expect(mikrocentNachCent(kosten)).toBe(0n);
  });

  it('hundert solcher Aufrufe sind 3 Cent — die Summe geht nicht verloren', () => {
    let summe = 0n;
    for (let i = 0; i < 100; i += 1) {
      summe += kostenMikrocent({ eingabe: 1000n, ausgabe: 0n, gedanken: 0n }, PREIS);
    }
    expect(summe).toBe(30_000n);
    expect(mikrocentNachCent(summe)).toBe(3n);
  });

  it('Ein- und Ausgabe werden getrennt bepreist', () => {
    expect(kostenMikrocent({ eingabe: 1_000_000n, ausgabe: 1_000_000n, gedanken: 0n }, PREIS))
      .toBe(300_000n + 1_500_000n);
  });

  it('Denk-Token ohne eigenen Preis zählen wie Ausgabe — die teurere Auslegung', () => {
    const mit = kostenMikrocent({ eingabe: 0n, ausgabe: 0n, gedanken: 1_000_000n }, PREIS);
    expect(mit).toBe(1_500_000n);

    const eigen = kostenMikrocent(
      { eingabe: 0n, ausgabe: 0n, gedanken: 1_000_000n },
      { ...PREIS, gedankenJeMioToken: 100_000n });
    expect(eigen).toBe(100_000n);
  });

  it('rundet kaufmännisch, nicht ab', () => {
    // 5 Token × 100.000 je Mio = 0,5 Mikrocent → 1, nicht 0.
    expect(kostenMikrocent({ eingabe: 5n, ausgabe: 0n, gedanken: 0n },
      { ...PREIS, eingabeJeMioToken: 100_000n })).toBe(1n);
    // 4 Token × 100.000 je Mio = 0,4 → 0.
    expect(kostenMikrocent({ eingabe: 4n, ausgabe: 0n, gedanken: 0n },
      { ...PREIS, eingabeJeMioToken: 100_000n })).toBe(0n);
  });

  it('negative Tokens gibt es nicht', () => {
    expect(() => kostenMikrocent({ eingabe: -1n, ausgabe: 0n, gedanken: 0n }, PREIS))
      .toThrow(RangeError);
  });
});

describe('die EINE Umrechnung nach Cent', () => {
  it('rundet halbe Cent auf', () => {
    expect(mikrocentNachCent(4_999n)).toBe(0n);
    expect(mikrocentNachCent(5_000n)).toBe(1n);
    expect(mikrocentNachCent(14_999n)).toBe(1n);
    expect(mikrocentNachCent(15_000n)).toBe(2n);
  });

  it('summiert erst, rundet dann — sonst driftet der Bericht vom Budget ab', () => {
    const zeilen = [4_000n, 4_000n, 4_000n];
    const einmal = mikrocentNachCent(zeilen.reduce((s, z) => s + z, 0n));
    const jeZeile = zeilen.reduce((s, z) => s + mikrocentNachCent(z), 0n);
    expect(einmal).toBe(1n);
    expect(jeZeile, 'je Zeile gerundet ergäbe 0 — deshalb genau eine Umrechnungsstelle')
      .toBe(0n);
  });

  it('zeigt Euro mit zwei Stellen', () => {
    expect(mikrocentAlsEuro(123_400n)).toBe('0,12 €');
    expect(mikrocentAlsEuro(12_340_000n)).toBe('12,34 €');
    expect(mikrocentAlsEuro(0n)).toBe('0,00 €');
  });
});
