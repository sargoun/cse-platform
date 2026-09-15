import { describe, expect, it } from 'vitest';
import {
  abschnitte, ganzesJahr, jahrAus, letzterTag,
} from '../../src/server/services/bericht/zeitraum.js';
import {
  alsCsv, csvFeld, dateiname, prozent, stunden,
} from '../../src/server/services/bericht/ausgabe.js';
import { kalendertage, verzug } from '../../src/server/services/bericht/kennzahlen.js';
import { cent } from '../../src/server/services/finanz/geld.js';

/**
 * Die reinen Teile der Berichte (REP-01…REP-07).
 *
 * Was hier steht, rechnet ohne Datenbank: Zeitraumarithmetik, Formatierung,
 * CSV. Die Abfragen selbst stehen in `tests/isolation/bericht.test.ts` —
 * sie brauchen Zeilen, und Zeilen brauchen RLS.
 */

describe('Zeiträume', () => {
  it('zwölf Monate, und der Februar kennt das Schaltjahr', () => {
    const m = abschnitte(2024, 'monat');
    expect(m).toHaveLength(12);
    expect(m[0]).toMatchObject({ von: '2024-01-01', bis: '2024-01-31', bezeichnung: 'Januar 2024' });
    expect(m[1]!.bis).toBe('2024-02-29');
    expect(m[11]).toMatchObject({ von: '2024-12-01', bis: '2024-12-31' });
  });

  it('2023 ist kein Schaltjahr — dieselbe Funktion, andere Antwort', () => {
    expect(abschnitte(2023, 'monat')[1]!.bis).toBe('2023-02-28');
    expect(letzterTag(2023, 2)).toBe(28);
    expect(letzterTag(2000, 2)).toBe(29);
    expect(letzterTag(1900, 2)).toBe(28);
  });

  it('vier Quartale, lückenlos und überschneidungsfrei', () => {
    const q = abschnitte(2026, 'quartal');
    expect(q.map((z) => [z.von, z.bis])).toEqual([
      ['2026-01-01', '2026-03-31'],
      ['2026-04-01', '2026-06-30'],
      ['2026-07-01', '2026-09-30'],
      ['2026-10-01', '2026-12-31'],
    ]);
    expect(q.map((z) => z.bezeichnung)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
  });

  /**
   * **Ein Wirtschaftsjahr muss nicht im Januar beginnen** (O-05). Dieselbe
   * Funktion, ein Versatz — nicht eine zweite Funktion, die irgendwann eine
   * andere Antwort gibt.
   */
  it('ein verschobenes Wirtschaftsjahr läuft über den Jahreswechsel', () => {
    const wj = ganzesJahr(2026, 3);
    expect(wj.von).toBe('2026-04-01');
    expect(wj.bis).toBe('2027-03-31');

    const monate = abschnitte(2026, 'monat', 3);
    expect(monate[0]!.von).toBe('2026-04-01');
    expect(monate[8]!.von).toBe('2026-12-01');
    expect(monate[9]!.von).toBe('2027-01-01');
    expect(monate[11]!.bis).toBe('2027-03-31');
  });

  it('die Abschnitte eines Jahres schliessen lückenlos aneinander an', () => {
    for (const koernung of ['monat', 'quartal'] as const) {
      const alle = abschnitte(2027, koernung);
      for (let i = 1; i < alle.length; i += 1) {
        const vorherBis = Date.parse(`${alle[i - 1]!.bis}T00:00:00Z`);
        const jetztVon = Date.parse(`${alle[i]!.von}T00:00:00Z`);
        expect(jetztVon - vorherBis, `${koernung} ${String(i)}`).toBe(86400000);
      }
    }
  });

  it('das Jahr aus der Abfrage ist geprüft — und das laufende kommt vom Aufrufer', () => {
    expect(jahrAus('2024', '2026-09-15')).toBe(2024);
    expect(jahrAus(undefined, '2026-09-15')).toBe(2026);
    expect(jahrAus('abc', '2026-09-15')).toBe(2026);
    expect(jahrAus('1789', '2026-09-15')).toBe(2026);
    expect(jahrAus('2999', '2026-09-15')).toBe(2026);
    // Das kommende Jahr ist erlaubt: Planzahlen entstehen im Dezember.
    expect(jahrAus('2027', '2026-09-15')).toBe(2027);
  });

  it('Kalendertage zählen beide Enden mit', () => {
    expect(kalendertage({ von: '2026-01-01', bis: '2026-01-01', bezeichnung: '' })).toBe(1);
    expect(kalendertage({ von: '2026-01-01', bis: '2026-01-31', bezeichnung: '' })).toBe(31);
    expect(kalendertage({ von: '2024-01-01', bis: '2024-12-31', bezeichnung: '' })).toBe(366);
  });

  /**
   * **Über die Sommerzeit hinweg.** Der 25.3.2026 hat 23 Stunden; wer Tage
   * aus Millisekunden rechnet, ohne auf UTC zu gehen, bekommt hier 30,96 und
   * rundet auf 31 — richtig aus dem falschen Grund. Mit UTC stimmt es.
   */
  it('zählt über die Zeitumstellung richtig', () => {
    expect(kalendertage({ von: '2026-03-01', bis: '2026-03-31', bezeichnung: '' })).toBe(31);
    expect(kalendertage({ von: '2026-10-01', bis: '2026-10-31', bezeichnung: '' })).toBe(31);
  });
});

describe('Termintreue', () => {
  it('positiv ist zu spät, negativ ist früher, offen ist null', () => {
    expect(verzug('2026-03-31', '2026-04-07')).toBe(7);
    expect(verzug('2026-03-31', '2026-03-24')).toBe(-7);
    expect(verzug('2026-03-31', '2026-03-31')).toBe(0);
    expect(verzug('2026-03-31', null)).toBeNull();
    expect(verzug(null, '2026-03-31')).toBeNull();
  });

  it('auch über die Zeitumstellung', () => {
    // 29.3.2026 ist die Nacht der Umstellung.
    expect(verzug('2026-03-28', '2026-03-30')).toBe(2);
    expect(verzug('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('CSV (REP-07)', () => {
  it('schützt Semikolon, Anführungszeichen und Zeilenumbruch', () => {
    expect(csvFeld('schlicht')).toBe('schlicht');
    expect(csvFeld('mit;Semikolon')).toBe('"mit;Semikolon"');
    expect(csvFeld('mit "Zitat"')).toBe('"mit ""Zitat"""');
    expect(csvFeld('zwei\nZeilen')).toBe('"zwei\nZeilen"');
    expect(csvFeld(null)).toBe('');
    expect(csvFeld(42)).toBe('42');
  });

  it('trägt ein BOM und CRLF — sonst liest Excel Umlaute falsch', () => {
    const csv = alsCsv([{ kopf: 'Gebäude', wert: (z: { a: string }) => z.a }], [{ a: 'Straße' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('Straße');
  });

  it('eine Geldspalte bringt ihre Cent-Spalte mit', () => {
    const csv = alsCsv(
      [{ kopf: 'Umsatz', wert: () => '1.234,56 €', cent: () => cent(123456n) }],
      [{}],
    );
    const [kopf, zeile] = csv.replace('﻿', '').trim().split('\r\n');
    expect(kopf).toBe('Umsatz;Umsatz (Cent)');
    // Nicht in Anfuehrungszeichen: der Betrag traegt kein Semikolon und kein
    // Zitat. RFC 4180 maskiert nur, was maskiert werden MUSS.
    expect(zeile).toBe('1.234,56 €;123456');
  });

  it('kein Feld entkommt der Maskierung — auch der Kopf nicht', () => {
    const csv = alsCsv([{ kopf: 'A;B', wert: () => 'x' }], [{}]);
    expect(csv).toContain('"A;B"');
  });
});

describe('Formatierung', () => {
  it('Basispunkte werden zu Prozent mit zwei Stellen', () => {
    expect(prozent(2500)).toBe('25,00 %');
    expect(prozent(10000)).toBe('100,00 %');
    expect(prozent(7)).toBe('0,07 %');
    expect(prozent(0)).toBe('0,00 %');
    expect(prozent(-1250)).toBe('-12,50 %');
    expect(prozent(null)).toBe('');
  });

  it('Minuten werden zu Stunden — ohne Fliesskomma', () => {
    expect(stunden(90)).toBe('1:30 h');
    expect(stunden(60)).toBe('1:00 h');
    expect(stunden(5)).toBe('0:05 h');
    expect(stunden(0)).toBe('0:00 h');
    expect(stunden(-75)).toBe('−1:15 h');
    expect(stunden(null)).toBe('');
  });

  it('der Dateiname trägt keine Pfadtrenner und keine Umlaute', () => {
    expect(dateiname('Umsatz', 'CSE Dienstleistungen', '2026'))
      .toBe('Umsatz_CSE-Dienstleistungen_2026.csv');
    expect(dateiname('Mitarbeiter/Stunden', '../etc', 'Q1 2026'))
      .toBe('Mitarbeiter-Stunden_etc_Q1-2026.csv');
  });
});
