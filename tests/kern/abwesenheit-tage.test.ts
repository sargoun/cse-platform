import { describe, expect, it } from 'vitest';
import {
  rechneTage, ZeitraumFehler, ARBEITSTAGE_PLATZHALTER,
} from '@/server/services/abwesenheit/tage';
import { mengeNachPostgres } from '@/server/services/finanz/menge';

/**
 * Die Tagesrechnung einer Abwesenheit — die Zahl, die am Ende auf dem
 * Urlaubskonto steht.
 *
 * Sie ist in Tausendsteln gerechnet und nicht in Gleitkomma: ein halber Tag
 * ist `500n`. Zehn halbe Tage in `double precision` sind nicht zuverlässig
 * fünf, und der Fehler zeigt sich als ein Urlaubstag, der im Dezember fehlt.
 */
describe('rechneTage', () => {
  it('zählt Arbeitstage, nicht Kalendertage', () => {
    // Fr 2026-09-11 bis Mo 2026-09-14: Freitag und Montag.
    expect(mengeNachPostgres(rechneTage({ von: '2026-09-11', bis: '2026-09-14' })))
      .toBe('2.000');
  });

  it('lässt gesetzliche Feiertage in Berlin aus (§ 3 Abs. 2 BUrlG)', () => {
    /**
     * Der 3. Oktober 2026 ist ein Samstag — er fällt schon durchs Wochenende.
     * Der 1. Mai 2026 ist ein Freitag: eine Woche vom 27.04. bis 01.05. hat
     * damit VIER Urlaubstage, nicht fünf. Genau dieser Fall ist der Grund für
     * die Feiertagsprüfung.
     */
    expect(mengeNachPostgres(rechneTage({ von: '2026-04-27', bis: '2026-05-01' })))
      .toBe('4.000');
  });

  it('und den Berliner Frauentag, den es anderswo nicht gibt', () => {
    // 8. März 2026 ist ein Sonntag; 2027 ein Montag — dann zählt er.
    expect(mengeNachPostgres(rechneTage({ von: '2027-03-08', bis: '2027-03-08' })))
      .toBe('0.000');
  });

  it('halbiert die Ränder', () => {
    expect(mengeNachPostgres(rechneTage({
      von: '2026-09-07', bis: '2026-09-11', vonHalbtags: true,
    }))).toBe('4.500');
    expect(mengeNachPostgres(rechneTage({
      von: '2026-09-07', bis: '2026-09-11', vonHalbtags: true, bisHalbtags: true,
    }))).toBe('4.000');
  });

  it('ein einzelner halber Tag ist ein halber, kein leerer', () => {
    // Beide Flaggen an EINEM Tag: vormittags Urlaub, nachmittags Fortbildung.
    // Zweimal zu halbieren ergäbe null — und damit einen Urlaubstag, den
    // niemand abgibt.
    expect(mengeNachPostgres(rechneTage({
      von: '2026-09-09', bis: '2026-09-09', vonHalbtags: true, bisHalbtags: true,
    }))).toBe('0.500');
  });

  it('ein Zeitraum ganz im Wochenende kostet nichts', () => {
    expect(mengeNachPostgres(rechneTage({ von: '2026-09-12', bis: '2026-09-13' })))
      .toBe('0.000');
  });

  it('nimmt eine andere Arbeitswoche entgegen — die Regel ist ein Parameter', () => {
    // Eine Reinigungskraft mit Samstagsturnus: Sa zählt, Mo nicht.
    expect(mengeNachPostgres(rechneTage({
      von: '2026-09-12', bis: '2026-09-14', arbeitstage: [6],
    }))).toBe('1.000');
    // Und die ausgelieferte Vorgabe ist Mo–Fr (O-18).
    expect(ARBEITSTAGE_PLATZHALTER).toEqual([1, 2, 3, 4, 5]);
  });

  it('weist einen verdrehten Zeitraum zurück statt ihn zu rechnen', () => {
    expect(() => rechneTage({ von: '2026-09-14', bis: '2026-09-11' }))
      .toThrow(ZeitraumFehler);
    expect(() => rechneTage({ von: '14.09.2026', bis: '2026-09-15' }))
      .toThrow(ZeitraumFehler);
    // Ein Tippfehler im Jahr wird zur Meldung, nicht zu einer Schleife über
    // tausend Tage.
    expect(() => rechneTage({ von: '2026-09-14', bis: '2036-09-15' }))
      .toThrow(ZeitraumFehler);
  });
});
