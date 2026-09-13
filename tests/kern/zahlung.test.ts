/**
 * PR 54.1 — was ohne Datenbank entschieden wird: IBAN, Skonto, Verteilung.
 *
 * Die Aussagen über Auslöser, Rechte und Mandantengrenzen stehen in
 * `tests/isolation/zahlung.test.ts`; hier steht die Arithmetik. Sie ist
 * getrennt, weil sie in Millisekunden läuft und weil ein Rechenfehler hier
 * jede Zahlung falsch macht, nicht nur eine.
 */
import { describe, expect, it } from 'vitest';
import { cent, verteileNachAnteil, GeldFehler } from '../../src/server/services/finanz/geld.js';
import {
  formatiereIban, ibanGeprueft, istBicGueltig, istIbanGueltig, normalisiereIban, IbanFehler,
} from '../../src/server/services/finanz/zahlung/iban.js';
import {
  verteileSkonto, SkontoFehler, type SteuerGruppe,
} from '../../src/server/services/finanz/zahlung/skonto.js';
import { SKONTO_PLATZHALTER } from '../../src/server/services/finanz/zahlung/skonto.platzhalter.js';

describe('(1) Die IBAN — Gestalt und Prüfziffer', () => {
  it('nimmt eine gültige deutsche IBAN an, geschrieben wie ein Mensch sie schreibt', () => {
    expect(istIbanGueltig('DE02 1203 0000 0000 2020 51')).toBe(true);
    expect(istIbanGueltig('de02120300000000202051')).toBe(true);
    expect(normalisiereIban('de02 1203-0000 0000 2020 51'))
      .toBe('DE02120300000000202051');
  });

  it('weist einen Zahlendreher ab — genau das, was eine Prüfziffer kann', () => {
    // Zwei Ziffern getauscht: Gestalt tadellos, Prüfziffer falsch.
    expect(istIbanGueltig('DE02120300000000200251')).toBe(false);
    expect(() => ibanGeprueft('DE02120300000000200251'))
      .toThrow(expect.objectContaining({ grund: 'pruefziffer' }) as Error);
  });

  it('und unterscheidet den Gestaltfehler vom Prüfziffernfehler', () => {
    expect(() => ibanGeprueft('DE1')).toThrow(IbanFehler);
    expect(() => ibanGeprueft('DE1')).toThrow(
      expect.objectContaining({ grund: 'gestalt' }) as Error);
  });

  it('rechnet auch die längsten IBANs richtig — nie über ein `number`', () => {
    /*
     * Malta, 31 Zeichen. Als Zahl wären das 62 Stellen; `Number` trägt 15.
     * Eine stückweise Rechnung ist hier nicht Feinschliff, sondern der
     * Unterschied zwischen richtig und still falsch.
     */
    expect(istIbanGueltig('MT84MALT011000012345MTLCAST001S')).toBe(true);
    expect(istIbanGueltig('MT84MALT011000012345MTLCAST001T')).toBe(false);
  });

  it('kennt die Formen des BIC — acht Stellen und elf', () => {
    expect(istBicGueltig('DEUTDEFF')).toBe(true);
    expect(istBicGueltig('DEUTDEFF500')).toBe(true);
    expect(istBicGueltig('DEUTDEF')).toBe(false);
    expect(istBicGueltig('12UTDEFF')).toBe(false);
  });

  it('und zeigt eine IBAN in Vierergruppen', () => {
    expect(formatiereIban('DE02120300000000202051'))
      .toBe('DE02 1203 0000 0000 2020 51');
  });
});

describe('(2) Die Verteilung verliert keinen Cent', () => {
  it('drei gleiche Anteile von 100 sind 34 + 33 + 33, nicht 33 + 33 + 33', () => {
    const teile = verteileNachAnteil(cent(100n), [1n, 1n, 1n]);
    expect(teile).toEqual([34n, 33n, 33n]);
    expect(teile.reduce((a, b) => a + b, 0n)).toBe(100n);
  });

  it('gibt den Rest dem größten Bruchteil, bei Gleichstand dem früheren', () => {
    // 10 auf Gewichte 1:1:1 → 4,3,3; auf 3:3:4 → 3,3,4.
    expect(verteileNachAnteil(cent(10n), [1n, 1n, 1n])).toEqual([4n, 3n, 3n]);
    expect(verteileNachAnteil(cent(10n), [3n, 3n, 4n])).toEqual([3n, 3n, 4n]);
  });

  it('verteilt auch einen negativen Betrag exakt', () => {
    const teile = verteileNachAnteil(cent(-100n), [1n, 1n, 1n]);
    expect(teile).toEqual([-34n, -33n, -33n]);
    expect(teile.reduce((a, b) => a + b, 0n)).toBe(-100n);
  });

  it('bei lauter Nullgewichten kommt nichts heraus — und es wirft nicht', () => {
    expect(verteileNachAnteil(cent(500n), [0n, 0n])).toEqual([0n, 0n]);
  });

  it('ein negatives Gewicht ist ein Aufruferfehler und wird benannt', () => {
    expect(() => verteileNachAnteil(cent(100n), [1n, -1n])).toThrow(GeldFehler);
  });

  it('und über tausend Anteile summiert sich alles noch auf den Cent', () => {
    const gewichte = Array.from({ length: 1000 }, (_, i) => BigInt(i + 1));
    const teile = verteileNachAnteil(cent(123_457n), gewichte);
    expect(teile.reduce((a, b) => a + b, 0n)).toBe(123_457n);
  });
});

describe('(3) Skonto ist eine §17-UStG-Korrektur je Steuergruppe', () => {
  const regelsatz: SteuerGruppe = {
    steuersatzGruppeId: 'g-19', nettoCent: cent(100_000n), steuerCent: cent(19_000n),
    satzBp: 1900,
  };
  const reverseCharge: SteuerGruppe = {
    steuersatzGruppeId: 'g-13b', nettoCent: cent(100_000n), steuerCent: cent(0n),
    satzBp: 0,
  };

  it('bei einer Gruppe rechnet es das Netto aus dem Brutto heraus', () => {
    // 2 % von 1.190,00 € = 23,80 € brutto = 20,00 € netto + 3,80 € Steuer.
    const [a] = verteileSkonto(cent(2380n), [regelsatz]);
    expect(a).toEqual({
      steuersatzGruppeId: 'g-19', bruttoCent: 2380n, nettoCent: 2000n, steuerCent: 380n,
    });
  });

  it('teilt über zwei Sätze nach BRUTTO — jede Gruppe verliert denselben Prozentsatz Netto', () => {
    /*
     * Der Fall, an dem eine Aufteilung „im Verhältnis der Nettos" scheitert:
     * 1.000,00 € zu 19 % und 1.000,00 € nach §13b. Der Kunde zieht 2 % von
     * 2.190,00 € = 43,80 €. Richtig sind 23,80 € auf die 19 %-Gruppe und
     * 20,00 € auf die §13b-Gruppe — beide Nettos sinken um exakt 2 %.
     * Nach Netto geteilt wären es 21,90 € und 21,90 €: die Summe stimmte,
     * jede einzelne Zeile wäre falsch, und die Voranmeldung zöge daraus.
     */
    const anteile = verteileSkonto(cent(4380n), [regelsatz, reverseCharge]);
    expect(anteile).toEqual([
      { steuersatzGruppeId: 'g-19',  bruttoCent: 2380n, nettoCent: 2000n, steuerCent: 380n },
      { steuersatzGruppeId: 'g-13b', bruttoCent: 2000n, nettoCent: 2000n, steuerCent: 0n },
    ]);
    for (const a of anteile) expect(a.nettoCent).toBe(2000n);
  });

  it('und die Summe der Anteile ist immer genau der Skonto', () => {
    const anteile = verteileSkonto(cent(1n), [regelsatz, reverseCharge]);
    expect(anteile.reduce((s, a) => s + a.bruttoCent, 0n)).toBe(1n);
    // Eine Gruppe ohne Anteil fällt heraus: eine Korrekturbuchung über 0,00 €
    // beschreibt nichts.
    expect(anteile).toHaveLength(1);
  });

  it('weist einen Skonto ab, der größer ist als die Rechnung', () => {
    expect(() => verteileSkonto(cent(300_000n), [regelsatz])).toThrow(SkontoFehler);
  });

  it('weist null und negativ ab, und eine Rechnung ohne Steuerzeilen ebenso', () => {
    expect(() => verteileSkonto(cent(0n), [regelsatz])).toThrow(SkontoFehler);
    expect(() => verteileSkonto(cent(-100n), [regelsatz])).toThrow(SkontoFehler);
    expect(() => verteileSkonto(cent(100n), [])).toThrow(SkontoFehler);
  });
});

describe('(4) Ob überhaupt ein Skonto gewährt wird, hat niemand entschieden', () => {
  it('die Toleranz ist null, und der Platzhalter sagt es', () => {
    expect(SKONTO_PLATZHALTER.toleranzCent).toBe(0n);
    expect(SKONTO_PLATZHALTER.istPlatzhalter).toBe(true);
    expect(SKONTO_PLATZHALTER.herkunft).toContain('O-177');
  });
});
