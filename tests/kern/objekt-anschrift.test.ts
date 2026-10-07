/**
 * **Ist das dieselbe Anschrift?** (V-361, O-70, D-817) — ohne Datenbank.
 *
 * Die Normalisierung entscheidet, ob `legeObjektAn` nachfragt. Zu streng,
 * und dasselbe Haus steht zweimal im Bestand; zu weit, und eine Wohnanlage
 * mit zwei Häusern liesse sich nicht anlegen, ohne dass jemand bestätigt,
 * was gar keine Dublette ist.
 */
import { describe, expect, it } from 'vitest';
import {
  anschriftSchluessel, normalisierteHausnummer, normalisierteStrasse, zurueckgereichteWerte,
} from '../../src/server/services/objekt/anschrift.js';

const gleich = (a: [string, string, string], b: [string, string, string]): boolean =>
  anschriftSchluessel({ strasse: a[0], hausnummer: a[1], plz: a[2] })
  === anschriftSchluessel({ strasse: b[0], hausnummer: b[1], plz: b[2] });

describe('V-361 — dieselbe Anschrift in anderer Schreibweise', () => {
  it.each([
    [['Hauptstraße', '5', '10115'], ['Hauptstr.', '5', '10115']],
    [['Hauptstraße', '5', '10115'], ['HAUPTSTRASSE', '5', '10115']],
    [['Hauptstrasse', '5a', '10115'], ['Hauptstr', '5 A', '10115']],
    [['Karl-Marx-Allee', '31', '10178'], ['karl marx allee', '31', '10178']],
    [['Straße des 17. Juni', '135', '10623'], ['Str. des 17. Juni', '135', '10623']],
    [['Müllerstraße', '12-14', '13353'], ['Muellerstr.', '12–14', '13353']],
    [['Rue Café', '1', '10115'], ['rue cafe', '1', ' 10115 ']],
  ] as const)('%j = %j', (a, b) => {
    expect(gleich([...a], [...b])).toBe(true);
  });
});

describe('V-361 — was verschieden bleibt', () => {
  it.each([
    [['Hauptstraße', '5', '10115'], ['Hauptstraße', '5a', '10115']],
    [['Hauptstraße', '5', '10115'], ['Hauptstraße', '6', '10115']],
    [['Hauptstraße', '5', '10115'], ['Hauptstraße', '5', '10117']],
    [['Hauptstraße', '5', '10115'], ['Nebenstraße', '5', '10115']],
    [['Strassburger Platz', '1', '10115'], ['Str. Platz', '1', '10115']],
  ] as const)('%j ≠ %j', (a, b) => {
    expect(gleich([...a], [...b])).toBe(false);
  });

  it('„Str" mitten im Wort ist keine Abkürzung', () => {
    expect(normalisierteStrasse('Strassburger Platz')).toBe('strassburgerplatz');
    expect(normalisierteStrasse('Am Strand')).toBe('amstrand');
    expect(normalisierteStrasse('Bahnhofstraße')).toBe('bahnhofstr');
    expect(normalisierteHausnummer(null)).toBe('');
  });
});

describe('V-361 — was ins Formular zurückreist', () => {
  it('nur bekannte Felder, nur Text, nicht zu lang', () => {
    const roh = JSON.stringify({
      strasse: 'Hauptstraße', plz: '10115', zutrittHinweis: 'Code 4711', bemerkung: 'x',
      etagenAnzahl: 3, ort: 'B'.repeat(201), fremd: 'y',
    });
    expect(zurueckgereichteWerte(roh)).toEqual({ strasse: 'Hauptstraße', plz: '10115' });
  });

  it('Unsinn heisst: nichts mitgebracht', () => {
    for (const roh of [undefined, '', 'kein json', '[1,2]', 'null', '"text"', 'x'.repeat(5000)]) {
      expect(zurueckgereichteWerte(roh)).toEqual({});
    }
  });
});
