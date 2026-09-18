/**
 * Die reinen Rechenwege der Vertriebsroute — Geld, Prozente, Flaechen.
 *
 * Alle drei gehoeren zu den Groessen, bei denen ein Fehler NICHT auffaellt:
 * ein Einbehaltssatz von 4,35 %, der als 434,99999999999994 Basispunkte
 * ankommt; ein Standardpreis, der als Fliesskommazahl durch die Maske geht;
 * eine Quadratmeterzahl, die beim Zurueckschreiben in das eigene Formular um
 * den Faktor 1000 wandert. Jede dieser Zahlen sieht danach plausibel aus.
 */
import { describe, expect, it } from 'vitest';
import {
  AbschlussFehler, prozentInBasispunkte,
} from '../../src/server/services/auftrag/abschluss.js';
import { alsNumerisch, leseZahl }
  from '../../src/server/services/raumbuch/tabelle.js';
import { formatiereMenge, mengeAusPostgresOderNull }
  from '../../src/server/services/finanz/menge.js';
import { formatiereGeld, parseGeld } from '../../src/server/services/finanz/geld.js';

describe('(1) Der Sicherheitseinbehalt als Basispunkte (O-20)', () => {
  it('ganze Prozente', () => {
    expect(prozentInBasispunkte('0')).toBe(0);
    expect(prozentInBasispunkte('5')).toBe(500);
    expect(prozentInBasispunkte('100')).toBe(10000);
  });

  it('mit Komma — deutsch geschrieben', () => {
    expect(prozentInBasispunkte('5,5')).toBe(550);
    expect(prozentInBasispunkte('0,5')).toBe(50);
    expect(prozentInBasispunkte('12,25')).toBe(1225);
  });

  /**
   * **Der Grund, aus dem hier nicht `Number(x) * 100` steht.**
   *
   * `4.35 * 100` ist in IEEE-754 `434.99999999999994`, `1.15 * 100` ist
   * `114.99999999999999`, `8.45 * 100` ist `844.9999999999999`. Mit
   * `Math.round` ginge das gut aus — solange der Bereich klein bleibt und
   * niemand die Rundung wegnimmt. Die Zerlegung ueber Zeichenketten ist
   * exakt, und das ist dieselbe Absicht wie Invariante 1: eine Zahl, die
   * einen Betrag bestimmt, entsteht nicht aus einem Fliesskommawert.
   *
   * Die drei `not.toBe`-Zeilen sind der Gegenbeweis, und sie stehen hier mit
   * Absicht: ohne sie prueft der Test nur, dass 435 herauskommt — nicht, dass
   * der naheliegende Weg dorthin falsch gewesen waere.
   */
  it('und zwar EXAKT — kein Fliesskommarest', () => {
    expect(prozentInBasispunkte('4,35')).toBe(435);
    expect(prozentInBasispunkte('1,15')).toBe(115);
    expect(prozentInBasispunkte('8,45')).toBe(845);
    expect(4.35 * 100).not.toBe(435);
    expect(1.15 * 100).not.toBe(115);
    expect(8.45 * 100).not.toBe(845);
  });

  it('der Punkt gilt hier als Dezimaltrenner — eine Eingabemaske, kein CSV', () => {
    // `5.5` ist in einem PROZENTFELD nicht mehrdeutig: 5.500 % gibt es nicht.
    expect(prozentInBasispunkte('5.5')).toBe(550);
  });

  it('was keine Prozentangabe ist, wird abgewiesen — nicht geraten', () => {
    for (const roh of ['', 'fuenf', '5%', '-5', '5,', ',5', '1.2.3', '5,555']) {
      expect(() => prozentInBasispunkte(roh), roh).toThrow(AbschlussFehler);
    }
  });

  it('und mehr als 100 Prozent ebenso', () => {
    expect(() => prozentInBasispunkte('101')).toThrow(/zwischen 0 und 100/u);
    // Aber genau 100 geht: ein voller Einbehalt ist eine Vereinbarung, kein Tippfehler.
    expect(prozentInBasispunkte('100')).toBe(10000);
  });
});

describe('(2) Der Standardpreis einer Katalogposition bleibt in Cent', () => {
  it('deutsch eingegeben, ganzzahlig gespeichert', () => {
    expect(parseGeld('12,50')).toBe(1250n);
    expect(parseGeld('1.234,56')).toBe(123456n);
  });

  /**
   * Der Rundweg: was die Maske vorbelegt, muss die Maske auch wieder lesen.
   * Ein Feld, das seinen eigenen Wert beim Speichern verschiebt, ist die
   * teuerste Art von Feld.
   */
  it('und der Rundweg Anzeige → Eingabe trifft denselben Betrag', () => {
    for (const cent of [0n, 1n, 1250n, 123456n, 99999999n]) {
      const angezeigt = formatiereGeld(cent as never).replace(' €', '');
      expect(parseGeld(angezeigt), angezeigt).toBe(cent);
    }
  });
});

describe('(3) Die Quadratmeterzahl des Raumblatts — hin und zurueck', () => {
  /**
   * **Der Rundweg, den das Raumblatt geht:** Postgres liefert `numeric(12,3)`
   * als `"12.500"`, die Seite zeigt daraus ein deutsches Textfeld, der Mensch
   * schickt es unveraendert zurueck, `leseZahl` liest es, `alsNumerisch`
   * schreibt es. Steht in diesem Weg irgendwo eine andere Lesart, wandert die
   * Flaeche um den Faktor 1000 — und eine Flaeche ist der Anfang jedes
   * Reinigungspreises (OPS-02, OPS-07).
   */
  it('Postgres → Anzeige → Eingabe → Postgres ist dieselbe Zahl', () => {
    for (const aus_db of ['12.500', '0.001', '1234.500', '999999.999', '250.000']) {
      const angezeigt = formatiereMenge(mengeAusPostgresOderNull(aus_db));
      const gelesen = leseZahl(angezeigt);
      expect(gelesen.wert, `${aus_db} → ${angezeigt}`).not.toBeNull();
      expect(alsNumerisch(gelesen.wert!), `${aus_db} → ${angezeigt}`)
        .toBe(Number(aus_db).toFixed(3));
    }
  });

  it('der Tausenderpunkt wird NICHT zum Faktor 1000', () => {
    // `1.234,5` ist 1234,5 m² — nicht 1234500.
    expect(leseZahl('1.234,5').wert).toBe(1_234_500n);
    // Und `1.234` ohne Komma ist 1234 m², nicht 1,234.
    expect(leseZahl('1.234').wert).toBe(1_234_000n);
  });

  it('und `12.50` wird als MEHRDEUTIG gemeldet, nicht stumm umgedeutet', () => {
    const befund = leseZahl('12.50');
    expect(befund.wert).toBe(12_500n);
    expect(befund.mehrdeutig).toBe(true);
    expect(befund.deutung).toContain('Dezimaltrenner');
  });

  it('was keine Zahl ist, ist keine — und wird nicht zu 0', () => {
    for (const roh of ['', '.', ',', '1..2', '1.2.3', 'm²', '12,']) {
      expect(leseZahl(roh).wert, roh).toBeNull();
    }
  });
});
