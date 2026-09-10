/**
 * Die Umrechnungen der Bestaetigung — ganzzahlig, oder gar nicht.
 *
 * Ein Zuschlag, der als Gleitkommazahl durch das Formular kommt, ist der
 * Anfang eines Preises, den niemand nachrechnen kann. Deshalb gehen beide
 * Eingaben durch eine geprueft Funktion (Invariante 1 und 6), und was keine
 * Zahl ist, wird abgewiesen statt gerundet.
 */
import { describe, expect, it } from 'vitest';
import {
  prozentInBasispunkte, stundensatzInCent, KalkulationFehler,
} from '../../src/server/services/kalkulation/bestaetigung.js';

describe('Prozent in Basispunkte', () => {
  it.each([
    ['15', 1500],
    ['15,5', 1550],
    ['15,55', 1555],
    ['0', 0],
    ['3', 300],
    ['100', 10_000],
    [' 8 % ', 800],
  ])('%s → %i', (eingabe, erwartet) => {
    expect(prozentInBasispunkte(eingabe)).toBe(erwartet);
  });

  it('rechnet ohne Gleitkomma — 15,5 % ist 1550, nicht 1549 oder 1551', () => {
    // 15.5 * 100 ist in JavaScript 1550.0000000000002.
    expect(prozentInBasispunkte('15,5')).toBe(1550);
    expect(Number.isInteger(prozentInBasispunkte('15,5'))).toBe(true);
  });

  it.each([
    ['abc', 'Buchstaben'],
    ['', 'leer'],
    ['15,555', 'drei Nachkommastellen'],
    ['-5', 'negativ'],
    ['15,', 'Komma ohne Stellen'],
    ['1.500', 'drei Stellen — koennte 1500 % meinen'],
  ])('%s (%s) wird abgewiesen', (eingabe) => {
    expect(() => prozentInBasispunkte(eingabe)).toThrow(KalkulationFehler);
  });

  it('ein Zuschlag jenseits der Spaltengrenze ebenso', () => {
    expect(() => prozentInBasispunkte('1001')).toThrow(/ausserhalb/u);
  });

  /**
   * Hier ist der englische Punkt ausdruecklich ERLAUBT — anders als bei einer
   * Flaeche. Der Grund ist der Unterschied, um den es geht: `12.50` m² kann
   * 1250 oder 12,5 meinen, ein Faktor 100. `15.5 %` kann nur 15,5 % meinen —
   * einen Tausenderpunkt gibt es bei einem Zuschlag nicht, und drei Stellen
   * nach dem Punkt weist die Pruefung oben ohnehin ab.
   */
  it('der englische Punkt ist bei einem Prozentsatz eindeutig und wird gelesen', () => {
    expect(prozentInBasispunkte('15.5')).toBe(1550);
    expect(prozentInBasispunkte('15.5')).toBe(prozentInBasispunkte('15,5'));
  });
});

describe('Stundensatz in Cent', () => {
  it('geht durch die Geldfunktion, nicht durch Number', () => {
    expect(stundensatzInCent('29,00')).toBe(2900n);
    expect(stundensatzInCent('29')).toBe(2900n);
    expect(stundensatzInCent('1.234,56')).toBe(123_456n);
  });

  it('und was kein Betrag ist, wird abgewiesen', () => {
    expect(() => stundensatzInCent('neunundzwanzig')).toThrow(KalkulationFehler);
    expect(() => stundensatzInCent('')).toThrow(KalkulationFehler);
  });
});
