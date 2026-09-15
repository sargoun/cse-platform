import { describe, expect, it } from 'vitest';
import {
  ankerAus, ansichtAus, fensterFuer, letzterTagDesMonats, monatsGitter, plusTage, wochentag,
} from '../../src/server/services/kalender/fenster.js';

/**
 * Die Fensterarithmetik des Kalenders (CAL-01) — ohne Datenbank und ohne
 * `Date` als Wahrheit.
 *
 * Geprüft wird das, woran Kalenderarithmetik scheitert: Monatsenden,
 * Schaltjahre, Wochen über den Monatswechsel, und die Zeitumstellung, bei der
 * ein Tag 23 oder 25 Stunden hat.
 */

describe('Tagesarithmetik', () => {
  it('ein Tag weiter ist ein Tag weiter — auch über Monats- und Jahresgrenzen', () => {
    expect(plusTage('2026-09-15', 1)).toBe('2026-09-16');
    expect(plusTage('2026-09-30', 1)).toBe('2026-10-01');
    expect(plusTage('2026-12-31', 1)).toBe('2027-01-01');
    expect(plusTage('2026-01-01', -1)).toBe('2025-12-31');
  });

  /**
   * **Die Nächte der Zeitumstellung.** Der 29.3.2026 hat 23 Stunden, der
   * 25.10.2026 hat 25. Wer Tage als Millisekunden rechnet, springt in der
   * einen Nacht einen Tag zu weit und in der anderen keinen.
   */
  it('überspringt keinen Tag bei der Zeitumstellung', () => {
    expect(plusTage('2026-03-28', 1)).toBe('2026-03-29');
    expect(plusTage('2026-03-29', 1)).toBe('2026-03-30');
    expect(plusTage('2026-10-24', 1)).toBe('2026-10-25');
    expect(plusTage('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('Schaltjahre', () => {
    expect(letzterTagDesMonats(2024, 2)).toBe(29);
    expect(letzterTagDesMonats(2026, 2)).toBe(28);
    expect(plusTage('2024-02-28', 1)).toBe('2024-02-29');
    expect(plusTage('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('die Woche beginnt am Montag (ISO 8601)', () => {
    // 14.9.2026 ist ein Montag.
    expect(wochentag('2026-09-14')).toBe(1);
    expect(wochentag('2026-09-20')).toBe(7);
  });
});

describe('Das Fenster', () => {
  it('der Monat läuft vom Ersten bis zum Letzten', () => {
    const f = fensterFuer('monat', '2026-09-15');
    expect(f.von).toBe('2026-09-01');
    expect(f.bis).toBe('2026-09-30');
    expect(f.bezeichnung).toBe('September 2026');
    expect(f.vorher).toBe('2026-08-31');
    expect(f.nachher).toBe('2026-10-01');
  });

  it('die Woche beginnt am Montag, egal welcher Tag der Anker ist', () => {
    for (const tag of ['2026-09-14', '2026-09-17', '2026-09-20']) {
      const f = fensterFuer('woche', tag);
      expect(f.von, tag).toBe('2026-09-14');
      expect(f.bis, tag).toBe('2026-09-20');
    }
  });

  /**
   * Eine Woche, die zwei Monate kreuzt, ist der häufigste Fall, den eine
   * naive Beschriftung falsch macht — „29. – 5. Oktober" liest sich wie ein
   * Zeitraum von 27 Tagen rückwärts.
   */
  it('eine Woche über den Monatswechsel nennt beide Monate', () => {
    const f = fensterFuer('woche', '2026-09-30');
    expect(f.von).toBe('2026-09-28');
    expect(f.bis).toBe('2026-10-04');
    expect(f.bezeichnung).toBe('28. September – 4. Oktober 2026');
  });

  it('eine Woche innerhalb eines Monats nennt ihn einmal', () => {
    expect(fensterFuer('woche', '2026-09-15').bezeichnung).toBe('14. – 20. September 2026');
  });

  it('der Tag ist der Tag', () => {
    const f = fensterFuer('tag', '2026-09-15');
    expect(f.von).toBe('2026-09-15');
    expect(f.bis).toBe('2026-09-15');
    expect(f.bezeichnung).toBe('15. September 2026');
    expect(f.vorher).toBe('2026-09-14');
  });
});

describe('Das Monatsgitter', () => {
  it('beginnt am Montag und endet am Sonntag', () => {
    const zellen = monatsGitter('2026-09-15');
    expect(zellen.length % 7).toBe(0);
    expect(wochentag(zellen[0]!.tag)).toBe(1);
    expect(wochentag(zellen.at(-1)!.tag)).toBe(7);
  });

  it('trägt die Tage des Nachbarmonats als „ausserhalb"', () => {
    const zellen = monatsGitter('2026-09-15');
    // 1.9.2026 ist ein Dienstag, also ist der 31.8. die erste Zelle.
    expect(zellen[0]!.tag).toBe('2026-08-31');
    expect(zellen[0]!.ausserhalb).toBe(true);
    expect(zellen.find((z) => z.tag === '2026-09-01')!.ausserhalb).toBe(false);
  });

  it('enthält jeden Tag des Monats genau einmal', () => {
    for (const anker of ['2026-01-15', '2026-02-15', '2024-02-15', '2026-11-15']) {
      const zellen = monatsGitter(anker);
      const drin = zellen.filter((z) => !z.ausserhalb).map((z) => z.tag);
      const monat = anker.slice(0, 7);
      expect(new Set(drin).size, anker).toBe(drin.length);
      expect(drin.length, anker)
        .toBe(letzterTagDesMonats(Number(anker.slice(0, 4)), Number(anker.slice(5, 7))));
      expect(drin.every((t) => t.startsWith(monat)), anker).toBe(true);
    }
  });

  /**
   * **Keine leere sechste Zeile.** Ein Februar, der an einem Montag beginnt,
   * passt in genau vier Zeilen; immer sechs zu zeichnen hiesse, in den
   * meisten Monaten Leerraum zu zeigen, den niemand braucht.
   */
  it('hört auf, sobald der Monat vorbei und die Woche voll ist', () => {
    // Februar 2027 beginnt an einem Montag und hat 28 Tage: genau vier Wochen.
    expect(monatsGitter('2027-02-15')).toHaveLength(28);

    /*
     * Und allgemein: die LETZTE Zeile enthaelt mindestens einen Tag des
     * Monats. Eine feste Zahl zu erwarten hiesse, sie fuer jeden Monat
     * nachzurechnen -- und ich hatte sie fuer den Mai falsch (35 statt der
     * vermuteten 42). Die Eigenschaft ist das, was zaehlt.
     */
    for (const anker of [
      '2026-01-15', '2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15',
      '2024-02-15', '2027-02-15',
    ]) {
      const zellen = monatsGitter(anker);
      const letzteZeile = zellen.slice(-7);
      expect(letzteZeile.some((z) => !z.ausserhalb), `${anker}: leere Schlusszeile`).toBe(true);
      const ersteZeile = zellen.slice(0, 7);
      expect(ersteZeile.some((z) => !z.ausserhalb), `${anker}: leere Kopfzeile`).toBe(true);
    }
  });
});

describe('Was aus der Adresse kommt, ist geprüft', () => {
  it('ein gültiger Tag geht durch, alles andere wird heute', () => {
    expect(ankerAus('2026-09-15', '2026-01-01')).toBe('2026-09-15');
    expect(ankerAus(undefined, '2026-01-01')).toBe('2026-01-01');
    expect(ankerAus('morgen', '2026-01-01')).toBe('2026-01-01');
    expect(ankerAus('2026-13-01', '2026-01-01')).toBe('2026-01-01');
    // Der 31. Februar ist kein Tag.
    expect(ankerAus('2026-02-31', '2026-01-01')).toBe('2026-01-01');
    expect(ankerAus('1899-01-01', '2026-01-01')).toBe('2026-01-01');
    expect(ankerAus(['2026-09-15'], '2026-01-01')).toBe('2026-01-01');
  });

  it('die Ansicht ist eine von dreien, im Zweifel der Monat', () => {
    expect(ansichtAus('woche')).toBe('woche');
    expect(ansichtAus('tag')).toBe('tag');
    expect(ansichtAus('jahr')).toBe('monat');
    expect(ansichtAus(undefined)).toBe('monat');
  });
});

/**
 * **Was gezeigt wird und was geholt wird, ist nicht dasselbe** (CAL-01).
 *
 * Das Monatsgitter zeichnet volle Wochen und damit die Randtage der
 * Nachbarmonate. Geholt wurde aber der 1. bis zum Letzten — jene Zellen waren
 * IMMER leer, egal was in ihnen stand. Eine Zelle, die aussieht wie ein Tag
 * ohne Termine, und eine ohne Daten sind für den Leser dasselbe Bild.
 */
describe('Der Abfragebereich eines Fensters', () => {
  it('deckt im Monat das ganze Gitter ab, nicht nur den Monat', () => {
    /* Oktober 2026 beginnt an einem Donnerstag — Mo 28.09. ist die erste Zelle. */
    const f = fensterFuer('monat', '2026-10-15');
    expect(f.von).toBe('2026-10-01');
    expect(f.bis).toBe('2026-10-31');

    const gitter = monatsGitter('2026-10-15');
    expect(f.abfrageVon).toBe(gitter[0]!.tag);
    expect(f.abfrageBis).toBe(gitter[gitter.length - 1]!.tag);
    expect(f.abfrageVon <= f.von, 'der Rand liegt vor dem Monat').toBe(true);
    expect(f.abfrageBis >= f.bis, 'und dahinter').toBe(true);
    /* Genau die Zellen, die das Gitter zeichnet — keine mehr, keine weniger. */
    expect(f.abfrageVon).toBe('2026-09-28');
  });

  it('ist in Tag und Woche derselbe wie der Zeitraum', () => {
    const tag = fensterFuer('tag', '2026-10-15');
    expect([tag.abfrageVon, tag.abfrageBis]).toEqual([tag.von, tag.bis]);
    const woche = fensterFuer('woche', '2026-10-15');
    expect([woche.abfrageVon, woche.abfrageBis]).toEqual([woche.von, woche.bis]);
  });

  it('ein Monat, der genau an einem Montag beginnt, braucht keinen Rand davor', () => {
    /* Juni 2026 beginnt an einem Montag. */
    const f = fensterFuer('monat', '2026-06-10');
    expect(f.von).toBe('2026-06-01');
    expect(f.abfrageVon).toBe('2026-06-01');
  });
});
