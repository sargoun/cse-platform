/**
 * PR 1 acceptance (8)–(9) — money and VAT. Invariants 1 and 6.
 */
import { describe, expect, it } from 'vitest';
import {
  addiere,
  anteilInBasisPunkten,
  assertSafeCents,
  basisPunkte,
  cent,
  formatiereGeld,
  GeldFehler,
  multipliziereMitMenge,
  parseGeld,
  subtrahiere,
} from '../../src/server/services/finanz/geld.js';
import {
  berechneSteuer,
  SteuerFehler,
  type SteuerZeile,
  type SteuersatzGruppe,
} from '../../src/server/services/finanz/steuer/satz.js';

describe('parseGeld / formatiereGeld — German notation (acceptance 8)', () => {
  it('19,99 € → 1999n', () => {
    expect(parseGeld('19,99 €')).toBe(1999n);
    expect(parseGeld('19,99')).toBe(1999n);
  });

  it('reads the thousands separator as German, not as a decimal point', () => {
    expect(parseGeld('1.234,56 €')).toBe(123_456n);
    // The Anglophone misreading, asserted as NOT happening.
    expect(parseGeld('1.234,56 €')).not.toBe(123n);
  });

  it('round-trips through the formatter', () => {
    expect(formatiereGeld(cent(123_456n))).toMatch(/1\.234,56/u);
    expect(formatiereGeld(cent(1999n))).toMatch(/19,99/u);
    expect(parseGeld(formatiereGeld(cent(987_654_321n)))).toBe(987_654_321n);
  });

  it('handles negative amounts — a Storno is a real case', () => {
    expect(parseGeld('-19,99 €')).toBe(-1999n);
    expect(formatiereGeld(cent(-1999n))).toMatch(/19,99/u);
  });

  it('refuses a foreign notation rather than guessing it', () => {
    expect(() => parseGeld('19.99')).toThrow(GeldFehler);
    expect(() => parseGeld('1,234.56')).toThrow(GeldFehler);
    expect(() => parseGeld('')).toThrow(GeldFehler);
    expect(() => parseGeld('viel')).toThrow(GeldFehler);
  });

  it('arithmetic is exact at magnitudes a float would lose', () => {
    const gross = cent(9_007_199_254_740_993n); // MAX_SAFE_INTEGER + 2
    expect(subtrahiere(addiere(gross, cent(1n)), cent(1n))).toBe(gross);
    expect(() => assertSafeCents(gross)).toThrow(GeldFehler);
  });

  it('rounds half-up at the rate boundary, and states which way', () => {
    // 5 cents at 50% is 2,5 → 3, not 2.
    expect(anteilInBasisPunkten(cent(5n), basisPunkte(5000))).toBe(3n);
    expect(anteilInBasisPunkten(cent(-5n), basisPunkte(5000))).toBe(-3n);
  });

  it('multiplies by an exact scaled quantity, never a float', () => {
    // 12,500 units at 3,33 € = 41,625 → 41,63 €
    expect(multipliziereMitMenge(cent(333n), 12_500n)).toBe(4163n);
  });
});

const regelsatz: SteuersatzGruppe = {
  schluessel: 'regelsatz',
  satzBp: basisPunkte(1900),
  kategorie: 'regelsatz',
  befreiungsgrundCode: null,
  befreiungsgrundText: null,
};
const ermaessigt: SteuersatzGruppe = {
  schluessel: 'ermaessigt',
  satzBp: basisPunkte(700),
  kategorie: 'ermaessigt',
  befreiungsgrundCode: null,
  befreiungsgrundText: null,
};

describe('berechneSteuer — per group, never from a gross total (acceptance 9)', () => {
  const korb: readonly SteuerZeile[] = [
    { nettoCent: cent(10_000n), gruppe: regelsatz }, // 100,00 € @ 19%
    { nettoCent: cent(3_333n), gruppe: regelsatz }, //  33,33 € @ 19%
    { nettoCent: cent(5_000n), gruppe: ermaessigt }, //  50,00 € @  7%
  ];
  const ergebnis = berechneSteuer(korb);

  it('computes VAT once per group, on the summed net', () => {
    const regel = ergebnis.zeilen.find((z) => z.steuersatzGruppe === 'regelsatz');
    const erm = ergebnis.zeilen.find((z) => z.steuersatzGruppe === 'ermaessigt');
    expect(regel?.nettoCent).toBe(13_333n);
    expect(regel?.steuerCent).toBe(2_533n); // 13333 * 0,19 = 2533,27 → 2533
    expect(erm?.nettoCent).toBe(5_000n);
    expect(erm?.steuerCent).toBe(350n);
    expect(ergebnis.nettoGesamtCent).toBe(18_333n);
    expect(ergebnis.steuerGesamtCent).toBe(2_883n);
    expect(ergebnis.bruttoCent).toBe(21_216n);
  });

  it('CONTROL: a blended rate on the total DIFFERS — the test fails if anyone simplifies', () => {
    // The "simplification" this guards against: one average rate over the whole
    // basket. It is wrong, and it is wrong by an amount a reviewer would not
    // notice on a single invoice.
    const mischsatz = basisPunkte(
      Math.round((1900 * 13_333 + 700 * 5_000) / 18_333),
    );
    const gemischt = anteilInBasisPunkten(cent(18_333n), mischsatz);
    expect(gemischt).not.toBe(ergebnis.steuerGesamtCent);
  });

  it('CONTROL: working VAT back out of a gross total DIFFERS', () => {
    // brutto / 1,19 is the other tempting shortcut. Invariant 1 forbids it.
    const ausBrutto = anteilInBasisPunkten(ergebnis.bruttoCent, basisPunkte(1597));
    expect(ausBrutto).not.toBe(ergebnis.steuerGesamtCent);
  });

  it('orders groups deterministically, because the result enters the hash (K-12)', () => {
    const umgekehrt = berechneSteuer([...korb].reverse());
    expect(umgekehrt.zeilen.map((z) => z.steuersatzGruppe)).toEqual(
      ergebnis.zeilen.map((z) => z.steuersatzGruppe),
    );
    expect(ergebnis.zeilen.map((z) => z.steuersatzGruppe)).toEqual(['ermaessigt', 'regelsatz']);
  });

  it('carries the exemption fields through for BT-120/BT-121', () => {
    const steuerfrei: SteuersatzGruppe = {
      schluessel: 'reverse_charge_13b',
      satzBp: basisPunkte(0),
      kategorie: 'reverse_charge_13b',
      befreiungsgrundCode: 'AE',
      befreiungsgrundText: 'Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)',
    };
    const zeile = berechneSteuer([{ nettoCent: cent(50_000n), gruppe: steuerfrei }]).zeilen[0];
    expect(zeile?.steuerCent).toBe(0n);
    expect(zeile?.befreiungsgrundCode).toBe('AE');
  });

  it('refuses one group appearing with two rates — the rate is dated, not per line', () => {
    expect(() =>
      berechneSteuer([
        { nettoCent: cent(100n), gruppe: regelsatz },
        { nettoCent: cent(100n), gruppe: { ...regelsatz, satzBp: basisPunkte(1600) } },
      ]),
    ).toThrow(SteuerFehler);
  });

  it('an empty basket is zero, not an error', () => {
    expect(berechneSteuer([])).toEqual({
      zeilen: [],
      nettoGesamtCent: 0n,
      steuerGesamtCent: 0n,
      bruttoCent: 0n,
    });
  });
});
