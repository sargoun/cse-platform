/**
 * Die Fristenlage einer Aufgabe — in Europe/Berlin, mit beiden
 * Umstellungsnächten (OPS-11, Invariante 2).
 *
 * **Warum das eine eigene Prüfung braucht.** „Überfällig" sieht wie eine
 * Vergleichsoperation aus und ist zwei verschiedene Fragen:
 *
 *  · `faellig_am` ist ein Zeitpunkt. Der Vergleich ist die Differenz zweier
 *    Instants und braucht keine Zeitzone — „heute" braucht sie doch, denn ob
 *    22:30 UTC noch heute ist, entscheidet der Berliner Kalendertag, und im
 *    Sommer ist das bereits morgen.
 *  · `faellig_datum` ist ein TAG. „Bis Freitag" läuft um 24:00 Berliner Zeit
 *    ab, nicht um 24:00 UTC. Ein Vergleich gegen einen UTC-Mitternachtsinstant
 *    markiert die Aufgabe im Sommer zwei Stunden zu früh als überfällig — und
 *    zwar jeden Tag, ohne dass es jemandem auffällt.
 *
 * Die Prüfung nennt beide Umstellungsnächte ausdrücklich, weil genau dort ein
 * fester Versatz (`+01:00`) die halbe Jahreshälfte richtig ist.
 */
import { describe, expect, it } from 'vitest';
import { fristlage, istOffen, OFFENE_ZUSTAENDE } from '../../src/server/services/kern/aufgabe.js';

/** Ein UTC-Instant, ausgeschrieben — damit im Test keine Zone geraten wird. */
function utc(text: string): Date {
  return new Date(text);
}

describe('ohne Frist gibt es keine Lage', () => {
  it('beide Spalten leer heisst `ohne` — nicht „überfällig"', () => {
    // Die häufigste Aufgabe hat keine Frist. Sie als überfällig zu zeigen
    // hiesse, die Liste mit roten Zeilen zu füllen, die keine Frist haben.
    expect(fristlage({ faelligAm: null, faelligDatum: null }, utc('2026-06-15T10:00:00Z')))
      .toBe('ohne');
  });
});

describe('ein ZEITPUNKT als Frist', () => {
  it('ein vergangener Zeitpunkt ist überfällig', () => {
    expect(fristlage(
      { faelligAm: utc('2026-06-15T08:00:00Z'), faelligDatum: null },
      utc('2026-06-15T10:00:00Z'),
    )).toBe('ueberfaellig');
  });

  it('der Zeitpunkt JETZT ist überfällig und nicht „heute"', () => {
    // Die Grenze gehört der strengeren Seite: eine Frist, die gerade abläuft,
    // ist abgelaufen. „Heute" nach dem Ablauf zu sagen verschiebt die
    // Mahnung um einen Tag.
    const jetzt = utc('2026-06-15T10:00:00Z');
    expect(fristlage({ faelligAm: jetzt, faelligDatum: null }, jetzt)).toBe('ueberfaellig');
  });

  it('später am selben BERLINER Tag ist `heute`', () => {
    expect(fristlage(
      { faelligAm: utc('2026-06-15T15:00:00Z'), faelligDatum: null },
      utc('2026-06-15T10:00:00Z'),
    )).toBe('heute');
  });

  /**
   * **22:30 UTC im Sommer ist in Berlin schon morgen — und derselbe
   * Zeitstempel im Winter nicht.**
   *
   * Das ist die ganze Begründung dafür, dass „heute" über den Berliner
   * Kalendertag entschieden wird und nicht über den UTC-Tag. Gleicher
   * UTC-Zeitstempel, gleiche Uhrzeit der Anfrage, zwei verschiedene
   * Antworten — weil Berlin im Sommer zwei und im Winter eine Stunde vor UTC
   * liegt. Wer in UTC rechnet, bekommt eine Liste, in der eine Aufgabe von
   * morgen als heute fällig steht, und zwar ein halbes Jahr lang.
   */
  it('22:30 UTC im Sommer ist in Berlin schon der nächste Tag', () => {
    // jetzt: 12:00 UTC = 14:00 Berlin am 15. Juni.
    // Frist: 22:30 UTC = 00:30 Berlin am 16. Juni → morgen.
    expect(fristlage(
      { faelligAm: utc('2026-06-15T22:30:00Z'), faelligDatum: null },
      utc('2026-06-15T12:00:00Z'),
    )).toBe('demnaechst');
  });

  it('derselbe Zeitstempel im Winter bleibt derselbe Berliner Tag', () => {
    // jetzt: 12:00 UTC = 13:00 Berlin am 15. Januar.
    // Frist: 22:30 UTC = 23:30 Berlin am 15. Januar → heute.
    expect(fristlage(
      { faelligAm: utc('2026-01-15T22:30:00Z'), faelligDatum: null },
      utc('2026-01-15T12:00:00Z'),
    )).toBe('heute');
  });
});

describe('ein TAG als Frist', () => {
  it('ein früherer Tag ist überfällig', () => {
    expect(fristlage(
      { faelligAm: null, faelligDatum: '2026-06-14' },
      utc('2026-06-15T10:00:00Z'),
    )).toBe('ueberfaellig');
  });

  it('der heutige Berliner Tag ist `heute`', () => {
    expect(fristlage(
      { faelligAm: null, faelligDatum: '2026-06-15' },
      utc('2026-06-15T10:00:00Z'),
    )).toBe('heute');
  });

  it('ein späterer Tag ist `demnaechst`', () => {
    expect(fristlage(
      { faelligAm: null, faelligDatum: '2026-06-20' },
      utc('2026-06-15T10:00:00Z'),
    )).toBe('demnaechst');
  });

  /**
   * **Der Tag endet um 24:00 BERLINER Zeit, nicht um 24:00 UTC.**
   *
   * 22:30 UTC am 15. Juni ist 00:30 Berliner Zeit am 16. Juni: die Frist
   * „bis 15. Juni" ist dann ABGELAUFEN. Ein Vergleich gegen UTC-Mitternacht
   * hätte sie noch als „heute" geführt — also zwei Stunden lang eine Frist
   * angezeigt, die schon vorbei war.
   */
  it('nach Berliner Mitternacht ist der Vortag überfällig, auch wenn es in UTC noch derselbe Tag ist', () => {
    expect(fristlage(
      { faelligAm: null, faelligDatum: '2026-06-15' },
      utc('2026-06-15T22:30:00Z'),
    )).toBe('ueberfaellig');
  });

  it('und kurz VOR Berliner Mitternacht ist er noch heute', () => {
    // 21:30 UTC = 23:30 Berliner Zeit am 15. Juni.
    expect(fristlage(
      { faelligAm: null, faelligDatum: '2026-06-15' },
      utc('2026-06-15T21:30:00Z'),
    )).toBe('heute');
  });
});

describe('die beiden Umstellungsnächte (K-11)', () => {
  /**
   * **Frühjahr: 29. März 2026.** Um 02:00 Berliner Zeit springt die Uhr auf
   * 03:00; der Tag hat 23 Stunden. 22:30 UTC am 29. März ist 00:30 Berliner
   * Zeit am 30. März — die Frist „bis 29. März" ist abgelaufen.
   */
  it('Frühjahr — der verkürzte Tag endet trotzdem zur Berliner Mitternacht', () => {
    expect(fristlage(
      { faelligAm: null, faelligDatum: '2026-03-29' },
      utc('2026-03-29T21:30:00Z'),
    )).toBe('heute');
    expect(fristlage(
      { faelligAm: null, faelligDatum: '2026-03-29' },
      utc('2026-03-29T22:30:00Z'),
    )).toBe('ueberfaellig');
  });

  /**
   * **Herbst: 25. Oktober 2026.** Um 03:00 Berliner Zeit fällt die Uhr auf
   * 02:00; der Tag hat 25 Stunden, und um 23:00 UTC ist es in Berlin erst
   * 00:00 des nächsten Tages. Die Frist „bis 25. Oktober" läuft also eine
   * Stunde später ab als am Tag davor — genau das, was ein fester Versatz
   * falsch macht.
   */
  it('Herbst — der verlängerte Tag läuft eine Stunde länger', () => {
    // 22:30 UTC = 23:30 Berliner Zeit (schon +01:00), also noch heute.
    expect(fristlage(
      { faelligAm: null, faelligDatum: '2026-10-25' },
      utc('2026-10-25T22:30:00Z'),
    )).toBe('heute');
    // 23:30 UTC = 00:30 am 26. Oktober — abgelaufen.
    expect(fristlage(
      { faelligAm: null, faelligDatum: '2026-10-25' },
      utc('2026-10-25T23:30:00Z'),
    )).toBe('ueberfaellig');
  });

  it('ein ZEITPUNKT in der Umstellungsnacht bleibt eine Differenz von Instants', () => {
    // Die Umstellung ändert die Wanduhr, nicht die Dauer: 01:30 UTC am
    // 25. Oktober liegt VOR 02:30 UTC, ganz gleich, was die Uhr anzeigt.
    expect(fristlage(
      { faelligAm: utc('2026-10-25T01:30:00Z'), faelligDatum: null },
      utc('2026-10-25T02:30:00Z'),
    )).toBe('ueberfaellig');
  });
});

describe('beide Spalten gesetzt — der Zeitpunkt gewinnt', () => {
  it('die Datenbank verbietet es; der Dienst stürzt trotzdem nicht ab', () => {
    // `aufgabe_eine_frist` lässt die Zeile nicht entstehen. Ein Dienst, der
    // bei widersprüchlichen Eingaben wirft, wäre die schlechtere von zwei
    // Antworten — die Liste fiele wegen einer Zeile ganz aus.
    expect(fristlage(
      { faelligAm: utc('2026-06-20T10:00:00Z'), faelligDatum: '2026-06-01' },
      utc('2026-06-15T10:00:00Z'),
    )).toBe('demnaechst');
  });
});

describe('welche Zustände noch Arbeit bedeuten', () => {
  it('offen, in Arbeit und wartend — und sonst keiner', () => {
    expect([...OFFENE_ZUSTAENDE]).toEqual(['offen', 'in_arbeit', 'wartend']);
    expect(istOffen('offen')).toBe(true);
    expect(istOffen('wartend')).toBe(true);
    // Erledigt und abgebrochen sind Zustände, keine Löschung — aber sie sind
    // keine Arbeit mehr. Die Liste sortiert sie nach unten.
    expect(istOffen('erledigt')).toBe(false);
    expect(istOffen('abgebrochen')).toBe(false);
    expect(istOffen('erfunden')).toBe(false);
  });
});
