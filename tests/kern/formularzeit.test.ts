/**
 * Die Zeitangabe aus einem Formular — der Fehler, den niemand sieht.
 *
 * `<input type="datetime-local">` schickt Wanduhrzeit ohne Zone.
 * `new Date('2026-07-01T06:00')` liest sie als Ortszeit DES PROZESSES; im
 * Container und auf Vercel ist das UTC, und aus „06:00" wird 08:00 Berliner
 * Zeit. Diese Datei haelt fest, dass die Umrechnung ueber Berlin laeuft — und
 * dass eine Angabe MIT Zone unangetastet bleibt.
 */
import { describe, expect, it } from 'vitest';
import { berlinFormularZeit, berlinFormularZeitpunkt } from '../../src/lib/datum/formularzeit.js';

describe('Wanduhrzeit ohne Zone ist BERLINER Zeit', () => {
  it('Sommer: 06:00 Berlin sind 04:00 UTC', () => {
    const z = berlinFormularZeitpunkt('2026-07-01T06:00');
    expect(z?.toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });

  it('Winter: 06:00 Berlin sind 05:00 UTC', () => {
    const z = berlinFormularZeitpunkt('2026-01-15T06:00');
    expect(z?.toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });

  /**
   * Dieser Fall hiess „mit Sekunden gelesen" und bewies das Gegenteil: er
   * erwartete `04:00:00Z` fuer `06:00:30` — also genau die Verkuerzung, die
   * die Umsetzung vornahm. Test und Code trugen denselben Irrtum, und damit
   * war er gruen. Dasselbe Muster wie beim HEIC-Test und bei der
   * Geraeteabweichung.
   */
  it('mit Sekunden gelesen — und die Sekunden bleiben stehen', () => {
    const z = berlinFormularZeitpunkt('2026-07-01T06:00:30');
    expect(z?.toISOString()).toBe('2026-07-01T04:00:30.000Z');
  });

  it('auch mit Bruchteilen, und ohne Sekunden bleibt es bei null', () => {
    expect(berlinFormularZeitpunkt('2026-07-01T06:00:30.250')?.toISOString())
      .toBe('2026-07-01T04:00:30.250Z');
    expect(berlinFormularZeitpunkt('2026-07-01T06:00')?.toISOString())
      .toBe('2026-07-01T04:00:00.000Z');
  });

  /**
   * DIE Probe: `new Date(...)` im UTC-Prozess ergäbe hier 06:00Z. Ohne diesen
   * Fall bestünde der Test auch mit der kaputten Umsetzung.
   */
  it('und NICHT das, was der nackte Konstruktor im UTC-Prozess liefert', () => {
    const z = berlinFormularZeitpunkt('2026-07-01T06:00');
    expect(z?.toISOString()).not.toBe(new Date('2026-07-01T06:00Z').toISOString());
  });
});

describe('die beiden Nächte, in denen eine Wanduhrzeit mehrdeutig ist', () => {
  it('02:30 am Tag der Umstellung nach vorn gibt es nicht — die Lage wird benannt', () => {
    const z = berlinFormularZeit('2026-03-29T02:30');
    expect(z).not.toBeNull();
    expect(z!.aufloesung?.anomalie).toBe('dst_luecke');
  });

  it('02:30 am Tag der Rückstellung gibt es zweimal — ebenso', () => {
    const z = berlinFormularZeit('2026-10-25T02:30');
    expect(z!.aufloesung?.anomalie).toBe('dst_doppelt');
    // Vorgabe ist der frühere Zeitpunkt (noch CEST) — §7.2, O-163.
    expect(z!.zeitpunkt.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('ein gewöhnlicher Tag trägt keine Anomalie', () => {
    expect(berlinFormularZeit('2026-05-05T09:15')!.aufloesung?.anomalie).toBe('keine');
  });
});

describe('eine Angabe MIT Zone ist ein Zeitpunkt und bleibt es', () => {
  it('`Z` wird nicht nach Berlin umgedeutet', () => {
    const z = berlinFormularZeit('2026-07-01T06:00:00.000Z');
    expect(z!.zeitpunkt.toISOString()).toBe('2026-07-01T06:00:00.000Z');
    // Nichts aufzulösen: die Angabe brachte ihre Zone mit.
    expect(z!.aufloesung).toBeNull();
  });

  it('ein Offset ebenso wenig', () => {
    const z = berlinFormularZeitpunkt('2026-07-01T06:00:00+02:00');
    expect(z?.toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });
});

describe('was keine Zeitangabe ist, wird zu `null`', () => {
  it.each([['', 'leer'], ['   ', 'nur Leerraum'], ['heute', 'Wort'],
    ['2026-02-31T10:00', 'einen solchen Tag gibt es nicht']])(
    '%s (%s)', (wert) => {
      expect(berlinFormularZeitpunkt(wert)).toBeNull();
    });

  it('und was gar keine Zeichenkette ist, ebenso', () => {
    expect(berlinFormularZeitpunkt(null)).toBeNull();
    expect(berlinFormularZeitpunkt(42)).toBeNull();
    expect(berlinFormularZeitpunkt(undefined)).toBeNull();
  });
});
