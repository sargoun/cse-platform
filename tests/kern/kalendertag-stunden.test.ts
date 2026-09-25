import { describe, expect, it } from 'vitest';
import {
  istGueltigerKalendertag, monatsgrenzen, montag, tagePlus,
} from '@/lib/datum/kalendertag';
import { stundenAusMinuten, stundenMinutenText } from '@/lib/datum/stunden';

/**
 * Die beiden kleinen Module, die überall im Baum benutzt werden — und deshalb
 * geprüft gehören, obwohl jede einzelne Funktion in drei Zeilen passt.
 *
 * Vorher standen sie viermal (Kalender) beziehungsweise dreimal (Stunden) im
 * Baum. Die Gefahr einer solchen Verdopplung ist nicht, dass eine Fassung
 * falsch ist: sie ist, dass eine Fassung SPÄTER falsch wird und die anderen
 * richtig bleiben — zwei Bildschirme, zwei Wochen, kein Fehler zu sehen.
 */
describe('Kalendertag', () => {
  it('findet den Montag — auch wenn der Tag selbst schon Montag ist', () => {
    // 2026-09-10 ist ein Donnerstag.
    expect(montag('2026-09-10')).toBe('2026-09-07');
    expect(montag('2026-09-07')).toBe('2026-09-07');
    // Sonntag gehört zur ABLAUFENDEN Woche, nicht zur nächsten: die deutsche
    // Woche endet am Sonntag, und ein Plan, der ihn nach vorn schöbe, hätte
    // sechs Tage in der einen und acht in der anderen Woche.
    expect(montag('2026-09-13')).toBe('2026-09-07');
  });

  it('und über den Jahreswechsel hinweg', () => {
    // 2027-01-01 ist ein Freitag; sein Montag liegt noch in 2026.
    expect(montag('2027-01-01')).toBe('2026-12-28');
  });

  it('rechnet Tage vor und zurück, über Monats- und Jahresgrenzen', () => {
    expect(tagePlus('2026-09-10', 7)).toBe('2026-09-17');
    expect(tagePlus('2026-09-10', -7)).toBe('2026-09-03');
    expect(tagePlus('2026-09-30', 1)).toBe('2026-10-01');
    expect(tagePlus('2026-12-31', 1)).toBe('2027-01-01');
    expect(tagePlus('2028-02-28', 1)).toBe('2028-02-29');
  });

  /**
   * Die eigentliche Probe: an den Umstellungstagen darf sich NICHTS ändern.
   *
   * Am 29.03.2026 hat der Berliner Tag 23 Stunden, am 25.10.2026 deren 25.
   * Würde hier in Ortszeit gerechnet — `new Date(datum)` statt `T00:00:00Z` —,
   * spränge `tagePlus` an genau diesen beiden Tagen um einen Tag daneben. Der
   * Kalendertag ist eine Beschriftung; die Zone gehört nicht hierher.
   */
  it('bleibt an beiden Zeitumstellungen exakt', () => {
    expect(tagePlus('2026-03-28', 1)).toBe('2026-03-29');
    expect(tagePlus('2026-03-29', 1)).toBe('2026-03-30');
    expect(tagePlus('2026-10-24', 1)).toBe('2026-10-25');
    expect(tagePlus('2026-10-25', 1)).toBe('2026-10-26');
    expect(montag('2026-03-29')).toBe('2026-03-23');
    expect(montag('2026-10-25')).toBe('2026-10-19');
  });

  it('nennt die Monatsgrenzen, auch im Februar eines Schaltjahres', () => {
    expect(monatsgrenzen('2026-09-10')).toEqual({ von: '2026-09-01', bis: '2026-09-30' });
    expect(monatsgrenzen('2026-02-14')).toEqual({ von: '2026-02-01', bis: '2026-02-28' });
    expect(monatsgrenzen('2028-02-14')).toEqual({ von: '2028-02-01', bis: '2028-02-29' });
    expect(monatsgrenzen('2026-12-31')).toEqual({ von: '2026-12-01', bis: '2026-12-31' });
  });

  it('erkennt einen Tag, den es gibt — das Muster allein genügt nicht (V-217)', () => {
    expect(istGueltigerKalendertag('2026-02-28')).toBe(true);
    expect(istGueltigerKalendertag('2028-02-29')).toBe(true);
    // Das Muster passt, den Tag gibt es nicht: vorher 22008 aus der Datenbank.
    expect(istGueltigerKalendertag('2026-02-31')).toBe(false);
    expect(istGueltigerKalendertag('2026-02-29')).toBe(false);
    expect(istGueltigerKalendertag('2026-13-01')).toBe(false);
    expect(istGueltigerKalendertag('2026-00-10')).toBe(false);
    expect(istGueltigerKalendertag('26-02-01')).toBe(false);
    expect(istGueltigerKalendertag('2026-02-01T00:00')).toBe(false);
    expect(istGueltigerKalendertag('')).toBe(false);
  });
});

describe('Stundenanzeige', () => {
  it('schreibt deutsch — Komma, zwei Nachkommastellen', () => {
    expect(stundenAusMinuten(480)).toBe('8,00 h');
    expect(stundenAusMinuten(450)).toBe('7,50 h');
    expect(stundenAusMinuten(210)).toBe('3,50 h');
    expect(stundenAusMinuten(0)).toBe('0,00 h');
  });

  /**
   * Die drei Nächte aus K-11, als Anzeige gelesen: dieselbe Wanduhrschicht
   * 22:00–06:00 ist 480, 420 oder 540 Minuten lang. Die Formatierung darf
   * daran nichts glätten.
   */
  it('zeigt die drei Nächte unterschiedlich — weil sie es sind', () => {
    expect(stundenAusMinuten(480)).toBe('8,00 h');
    expect(stundenAusMinuten(420)).toBe('7,00 h');
    expect(stundenAusMinuten(540)).toBe('9,00 h');
  });

  it('rundet auf zwei Stellen statt zu kürzen', () => {
    // 7 h 20 min = 7,333… → 7,33; nicht 7,3 und nicht 7,34.
    expect(stundenAusMinuten(440)).toBe('7,33 h');
    expect(stundenAusMinuten(445)).toBe('7,42 h');
  });

  it('kennt daneben die Uhrenschreibweise', () => {
    expect(stundenMinutenText(450)).toBe('7:30 h');
    expect(stundenMinutenText(60)).toBe('1:00 h');
    expect(stundenMinutenText(5)).toBe('0:05 h');
    expect(stundenMinutenText(0)).toBe('0:00 h');
  });

  it('und verschluckt ein Minus nicht', () => {
    // Eine negative Dauer sollte es nicht geben. Käme sie doch, ist eine
    // sichtbare Zahl besser als eine stille: `-1:30 h` fällt auf, `1:30 h`
    // nicht.
    expect(stundenMinutenText(-90)).toBe('-1:30 h');
  });
});
