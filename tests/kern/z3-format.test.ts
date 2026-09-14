/**
 * PR 66 — das Format des Z3-Pakets, ohne Datenbank (ACC-09, D-485).
 *
 *  1. Betraege: Cent → Dezimalkomma mit Vorzeichen, rein ueber Zeichenketten.
 *  2. CSV-Felder: Text maskiert, Zahlen und Daten geprueft, nichts verlaesst
 *     seine Zeile.
 *  3. Die Tabellenspezifikation ist in sich stimmig: eindeutige Namen,
 *     Schluessel zuerst, jede Spalte in der Abfrage, Parameter wie erklaert.
 *  4. `index.xml` ist wohlgeformt, nennt die DTD, fuehrt je Tabelle die
 *     Spalten in CSV-Reihenfolge — und ist ohne Uhr reproduzierbar.
 */
import { describe, expect, it } from 'vitest';
import {
  DTD_NAME, TABELLEN, Z3Fehler, csvFeld, csvText, dezimalText, indexXml, xmlText,
} from '../../src/server/services/buchhaltung/z3.js';
import { leseXml, type Knoten } from '../../src/server/services/finanz/xml-lesen.js';

function kinder(k: Knoten, name: string): readonly Knoten[] {
  return k.kinder.filter((x) => x.name === name);
}

describe('(1) dezimalText', () => {
  it('schreibt Cent als Dezimalkomma mit Vorzeichen', () => {
    expect(dezimalText(0n)).toBe('0,00');
    expect(dezimalText(5n)).toBe('0,05');
    expect(dezimalText(123456n)).toBe('1234,56');
    expect(dezimalText(-123456n)).toBe('-1234,56');
    expect(dezimalText('1999')).toBe('19,99');
    expect(dezimalText('-7')).toBe('-0,07');
    expect(dezimalText(null)).toBe('');
  });
});

describe('(2) csvFeld und csvText', () => {
  it('maskiert Text und laesst nichts die Zeile verlassen', () => {
    expect(csvFeld('Müller "Süd" GmbH', 'text', 'name')).toBe('"Müller ""Süd"" GmbH"');
    expect(csvFeld('a;b\r\nc\td', 'text', 'name')).toBe('"a;b  c d"');
    expect(csvFeld(null, 'text', 'name')).toBe('');
  });

  it('prueft Zahlen, Betraege und Daten statt sie krumm durchzulassen', () => {
    expect(csvFeld('42', 'zahl', 'n')).toBe('42');
    expect(csvFeld(7n, 'zahl', 'n')).toBe('7');
    expect(csvFeld('-150', 'betrag', 'b')).toBe('-1,50');
    expect(csvFeld('2026-03-29', 'datum', 'd')).toBe('2026-03-29');
    expect(() => csvFeld('1,5', 'betrag', 'b')).toThrow(Z3Fehler);
    expect(() => csvFeld('x', 'zahl', 'n')).toThrow(Z3Fehler);
    expect(() => csvFeld('29.03.2026', 'datum', 'd')).toThrow(Z3Fehler);
  });

  it('schreibt Kopfzeile und Zeilen mit Semikolon und CRLF — und verlangt jede Spalte', () => {
    const spalten = [
      { name: 'id', typ: 'text' as const, schluessel: true as const, text: '' },
      { name: 'betrag', typ: 'betrag' as const, text: '' },
    ];
    expect(csvText(spalten, [{ id: 'a', betrag: '100' }, { id: 'b', betrag: null }]))
      .toBe('id;betrag\r\n"a";1,00\r\n"b";\r\n');
    expect(() => csvText(spalten, [{ id: 'a' }])).toThrow(/Spalte betrag fehlt/u);
  });
});

describe('(3) die Tabellenspezifikation', () => {
  it('hat eindeutige Namen, Schluessel zuerst und jede Spalte in der Abfrage', () => {
    const namen = TABELLEN.map((t) => t.name);
    expect(new Set(namen).size).toBe(namen.length);
    expect(namen).toContain('buchungen');
    expect(namen).toContain('rechnungen');
    expect(namen).toContain('belege');
    for (const t of TABELLEN) {
      const ersteNichtSchluessel = t.spalten.findIndex((s) => s.schluessel !== true);
      const letzterSchluessel = t.spalten.map((s) => s.schluessel === true).lastIndexOf(true);
      expect(letzterSchluessel, t.name).toBeGreaterThanOrEqual(0);
      if (ersteNichtSchluessel >= 0) expect(letzterSchluessel, t.name).toBeLessThan(ersteNichtSchluessel);
      expect(new Set(t.spalten.map((s) => s.name)).size, t.name).toBe(t.spalten.length);
      for (const s of t.spalten) {
        expect(new RegExp(`\\b${s.name}\\b`, 'u').test(t.sql), `${t.name}.${s.name}`).toBe(true);
      }
    }
  });

  it('nennt seine Parameter, wie die Abfrage sie braucht', () => {
    for (const t of TABELLEN) {
      const hat1 = t.sql.includes('$1');
      const hat3 = t.sql.includes('$3');
      expect(hat1, t.name).toBe(t.parameter !== 'keine');
      expect(hat3, t.name).toBe(t.parameter === 'zeitraum');
      expect(t.sql.includes('$4'), t.name).toBe(false);
    }
  });

  it('der Lieferantenstamm traegt keine Bankverbindung (K-05)', () => {
    const l = TABELLEN.find((t) => t.name === 'lieferanten');
    expect(l?.spalten.map((s) => s.name)).not.toContain('iban');
    expect(l?.sql).not.toMatch(/\biban\b/u);
  });
});

describe('(4) index.xml', () => {
  const angaben = {
    firma: 'CSE & Co. <Test> GmbH', ort: 'Berlin', bezeichnung: '2026', von: '2026-01-01', bis: '2026-12-31',
    tabellen: TABELLEN.map((spez) => ({ spez, zeilen: 0 })),
  };

  it('maskiert XML-Sonderzeichen', () => {
    expect(xmlText('a & b < c > "d" \'e\'')).toBe('a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
  });

  it('ist wohlgeformt, nennt die DTD und fuehrt je Tabelle die Spalten in CSV-Reihenfolge', () => {
    const xml = indexXml(angaben);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">')).toBe(true);
    expect(DTD_NAME).toBe('gdpdu-01-09-2004.dtd');
    /* Der Hausleser weist DTDs ab (XXE) — fuer die Gegenprobe faellt die Zeile weg. */
    const wurzel = leseXml(xml.split('\n').filter((z) => !z.startsWith('<!DOCTYPE')).join('\n'));
    expect(wurzel.name).toBe('DataSet');
    expect(kinder(wurzel, 'Version')[0]?.text).toBe('1.0');
    expect(kinder(kinder(wurzel, 'DataSupplier')[0]!, 'Name')[0]?.text).toBe('CSE & Co. <Test> GmbH');
    const tabellen = kinder(kinder(wurzel, 'Media')[0]!, 'Table');
    expect(tabellen).toHaveLength(TABELLEN.length);
    tabellen.forEach((t, i) => {
      const spez = TABELLEN[i]!;
      expect(kinder(t, 'URL')[0]?.text).toBe(`${spez.name}.csv`);
      const vl = kinder(t, 'VariableLength')[0]!;
      expect(kinder(vl, 'ColumnDelimiter')[0]?.text).toBe(';');
      const spalten = vl.kinder.filter((k) => k.name === 'VariablePrimaryKey' || k.name === 'VariableColumn');
      expect(spalten.map((s) => kinder(s, 'Name')[0]?.text)).toEqual(spez.spalten.map((s) => s.name));
      spalten.forEach((s, j) => {
        const erwartet = spez.spalten[j]!;
        expect(s.name).toBe(erwartet.schluessel === true ? 'VariablePrimaryKey' : 'VariableColumn');
        const typ = s.kinder.find((k) => ['AlphaNumeric', 'Numeric', 'Date'].includes(k.name));
        expect(typ?.name).toBe(erwartet.typ === 'text' ? 'AlphaNumeric' : erwartet.typ === 'datum' ? 'Date' : 'Numeric');
        if (erwartet.typ === 'betrag') expect(kinder(typ!, 'Accuracy')[0]?.text).toBe('2');
      });
      expect(kinder(kinder(t, 'Range')[0]!, 'From')[0]?.text).toBe('2');
    });
  });

  it('ist ohne Uhr — zweimal dasselbe', () => {
    expect(indexXml(angaben)).toBe(indexXml(angaben));
  });
});
