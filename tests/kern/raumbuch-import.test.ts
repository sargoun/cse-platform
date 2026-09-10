/**
 * Der Tabellenleser des Raumbuch-Imports — und die eine Zahl, die alles
 * entscheidet.
 *
 * `1.234` heisst in einer deutschen Tabelle 1234 und in einer englischen
 * 1,234. Wer das falsch liest, importiert das Tausendfache oder ein
 * Tausendstel einer Flaeche — und das faellt erst im Angebotspreis auf, wo
 * beide Zahlen plausibel aussehen.
 */
import { describe, expect, it } from 'vitest';
import {
  alsNumerisch, deutscheZahl, leseZahl, leseCsv, TabellenFehler, trennzeichenAus,
} from '../../src/server/services/raumbuch/tabelle.js';
import { schlageZuordnungVor } from '../../src/server/services/raumbuch/import.js';

describe('(1) Deutsche Zahlen', () => {
  it('Komma ist der Dezimaltrenner', () => {
    expect(deutscheZahl('12,5')).toBe(12_500n);
    expect(deutscheZahl('0,001')).toBe(1n);
    expect(deutscheZahl('1234')).toBe(1_234_000n);
  });

  it('der Tausenderpunkt faellt weg', () => {
    expect(deutscheZahl('1.234,5')).toBe(1_234_500n);
    expect(deutscheZahl('12.345.678')).toBe(12_345_678_000n);
  });

  /**
   * 08-PR-PLAN §288 (3): „`12,50` parses correctly; a control row `12.50` is
   * **flagged, not silently coerced**.“
   *
   * Der frühere Test hier hielt das stumme Umdeuten fest — er war gruen und
   * beschrieb genau das Verhalten, das die Abnahme ausschliesst. Deutsch
   * gelesen sind `12.50` eintausendzweihundertfuenfzig, englisch zwoelf
   * Komma fuenfzig: Faktor 100 auf einer Flaeche, aus der ein Preis wird.
   */
  it('ein Punkt mit hoechstens zwei Nachkommastellen wird GEMELDET, nicht stumm gedeutet',
    () => {
      const b = leseZahl('12.50');
      expect(b.wert).toBe(12_500n);
      expect(b.mehrdeutig).toBe(true);
      expect(b.deutung).toContain('Dezimaltrenner');

      // Und die eindeutige deutsche Schreibweise ist NICHT mehrdeutig.
      expect(leseZahl('12,50')).toMatchObject({ wert: 12_500n, mehrdeutig: false });
      expect(leseZahl('12.500')).toMatchObject({ wert: 12_500_000n, mehrdeutig: false });
      expect(leseZahl('1234')).toMatchObject({ wert: 1_234_000n, mehrdeutig: false });
    });

  /**
   * Interpunktion ohne Ziffern und falsch gruppierte Punkte ergaben vorher
   * ECHTE Zahlen: `.` → 0, `1..2` → 12000, `1.2.3` → 123000. Werte, die
   * aussehen wie Messwerte und keine sind — und als Flaeche in einen Preis
   * gehen.
   */
  it.each([
    ['.', 'nur ein Punkt'],
    [',', 'nur ein Komma'],
    ['..', 'zwei Punkte'],
    ['-.', 'Vorzeichen und Punkt'],
    ['1..2', 'doppelter Punkt'],
    ['1.2.3', 'falsch gruppiert'],
    ['1.', 'Punkt am Ende'],
    ['1.2345', 'vier Stellen nach dem Punkt'],
    ['12.34.5', 'gemischt'],
  ])('%s (%s) ist KEINE Zahl', (eingabe) => {
    expect(deutscheZahl(eingabe)).toBeNull();
  });

  it('und die gueltige Gruppierung bleibt gueltig', () => {
    expect(deutscheZahl('1.234')).toBe(1_234_000n);
    expect(deutscheZahl('12.345.678')).toBe(12_345_678_000n);
    expect(deutscheZahl('1.234.567,89')).toBe(1_234_567_890n);
  });

  it('drei Stellen nach dem Punkt sind dagegen der Tausenderpunkt', () => {
    expect(deutscheZahl('12.500')).toBe(12_500_000n);
  });

  it('das Trennzeichen wird NUR ausserhalb von Anfuehrungszeichen gezaehlt', () => {
    /**
     * Zwei Semikola trennen die Spalten, drei Kommata stehen INNERHALB der
     * Ueberschriften. Wer alle zaehlt, waehlt das Komma — und danach ist jede
     * Spalte um eins verrutscht, worauf die Flaeche in der Nutzungsart landet
     * und die Vorschau ordentlich aussieht, weil sie zeigt, was gelesen wurde.
     */
    expect(trennzeichenAus('Etage;"Bezeichnung, lang";"Flaeche, m², netto"')).toBe(';');
    // Ohne Anfuehrungszeichen gewinnt das Komma zu Recht.
    expect(trennzeichenAus('Etage,Raum,Flaeche,Belag')).toBe(',');
    // Ein doppeltes Anfuehrungszeichen im Feld ist ein Zeichen, kein Wechsel.
    expect(trennzeichenAus('A;"B ""gross"", weit";C')).toBe(';');
  });

  it('Leerzeichen und leere Felder', () => {
    expect(deutscheZahl(' 12,5 ')).toBe(12_500n);
    expect(deutscheZahl('')).toBeNull();
    expect(deutscheZahl('   ')).toBeNull();
  });

  it('was keine Zahl ist, wird nicht zu einer', () => {
    expect(deutscheZahl('ca. 12')).toBeNull();
    expect(deutscheZahl('12,5,5')).toBeNull();
    expect(deutscheZahl('zwölf')).toBeNull();
  });

  it('mehr als drei Nachkommastellen passen nicht in numeric(12,3)', () => {
    expect(deutscheZahl('12,3456')).toBeNull();
  });

  it('und die Rueckgabe ist die Form, die Postgres erwartet', () => {
    expect(alsNumerisch(12_500n)).toBe('12.500');
    expect(alsNumerisch(1n)).toBe('0.001');
    expect(alsNumerisch(-2_000n)).toBe('-2.000');
  });
});

describe('(2) CSV, wie Excel es schreibt', () => {
  it('Semikolon ist das deutsche Trennzeichen', () => {
    expect(trennzeichenAus('Etage;Raum;Fläche')).toBe(';');
    expect(trennzeichenAus('Etage,Raum,Fläche')).toBe(',');
    expect(trennzeichenAus('Etage\tRaum\tFläche')).toBe('\t');
  });

  it('eine einfache Tabelle', () => {
    const t = leseCsv('Etage;Raum;Fläche\nEG;101;25,5\n1;201;30\n');
    expect(t.kopf).toEqual(['Etage', 'Raum', 'Fläche']);
    expect(t.zeilen).toHaveLength(2);
    expect(t.zeilen[0]).toEqual({ Etage: 'EG', Raum: '101', 'Fläche': '25,5' });
  });

  it('Anfuehrungszeichen halten das Trennzeichen zusammen', () => {
    const t = leseCsv('Raum;Bezeichnung;Fläche\n101;"Büro, gross";25,5\n');
    expect(t.zeilen[0]?.['Bezeichnung']).toBe('Büro, gross');
    expect(t.zeilen[0]?.['Fläche']).toBe('25,5');
  });

  it('ein verdoppeltes Anfuehrungszeichen ist eines', () => {
    const t = leseCsv('Raum;Bezeichnung\n101;"Raum ""A"""\n');
    expect(t.zeilen[0]?.['Bezeichnung']).toBe('Raum "A"');
  });

  it('das BOM aus Excel verschwindet — sonst hiesse die erste Spalte anders', () => {
    const t = leseCsv('﻿Etage;Raum\nEG;101\n');
    expect(t.kopf[0]).toBe('Etage');
  });

  it('Windows-Zeilenenden', () => {
    const t = leseCsv('Etage;Raum\r\nEG;101\r\n');
    expect(t.zeilen[0]).toEqual({ Etage: 'EG', Raum: '101' });
  });

  it('eine leere Schlusszeile ist kein Raum', () => {
    const t = leseCsv('Etage;Raum\nEG;101\n;\n\n');
    expect(t.zeilen).toHaveLength(1);
  });

  it('eine leere Datei wird benannt abgewiesen', () => {
    expect(() => leseCsv('')).toThrow(TabellenFehler);
    expect(() => leseCsv('   ')).toThrow(/leer/u);
  });
});

describe('(3) Die Spaltenzuordnung ist ein VORSCHLAG', () => {
  it('sie findet die ueblichen Ueberschriften', () => {
    const z = schlageZuordnungVor(['Etage', 'Raumnummer', 'Bezeichnung', 'Fläche m²', 'Belag']);
    expect(z.etage).toBe('Etage');
    expect(z.raumnummer).toBe('Raumnummer');
    expect(z.bezeichnung).toBe('Bezeichnung');
    expect(z.flaeche_qm).toBe('Fläche m²');
    expect(z.belagsart_code).toBe('Belag');
  });

  it('sie belegt keine Spalte zweimal', () => {
    const z = schlageZuordnungVor(['Raum', 'Raumnummer']);
    const belegt = Object.values(z);
    expect(new Set(belegt).size).toBe(belegt.length);
  });

  it('und die genaue Uebereinstimmung geht der enthaltenen vor', () => {
    // "Raumnummer" darf nicht die Spalte "Raum" bekommen, waehrend die
    // Nummernspalte leer ausgeht.
    const z = schlageZuordnungVor(['Raumnummer', 'Raum']);
    expect(z.raumnummer).toBe('Raumnummer');
  });

  it('was sie nicht erkennt, laesst sie leer statt zu raten', () => {
    const z = schlageZuordnungVor(['Spalte A', 'Spalte B']);
    expect(z.flaeche_qm).toBeUndefined();
    expect(z.raumnummer).toBeUndefined();
  });
});
