/**
 * Die Sollzeit eines Reviers (CLN-01, OPS-07, K-16(c)) — Abnahmekriterium 3.
 *
 * Geprüft wird genau die Zusage aus dem PR-Plan, in ihren drei Teilen:
 *
 *   1. `Σ revier_raum.sollzeit_minuten` = `revier.sollzeit_minuten`, und zwar
 *      exakt, nicht „auf ein Hundertstel genau".
 *   2. Beides stimmt mit der Kalkulation aus PR 25 für dieselben Räume
 *      überein — verglichen wird gegen `sekundenJeDurchgang` selbst, nicht
 *      gegen eine im Test nachgebaute Formel. Ein Test, der die Formel
 *      nachbaut, prüft den Test.
 *   3. Kein doppeltes Runden: die naive Umsetzung — jeden Raum einzeln auf
 *      zwei Nachkommastellen runden und dann summieren — muss an mindestens
 *      einem Fall sichtbar danebenliegen, sonst wäre die Zusage leer.
 */
import { describe, expect, it } from 'vitest';
import {
  alsMinutenText, berechneRevierSollzeit, hundertstelAusSekunden,
  SollzeitFehler, summeDerRaeume, type RaumEingabe,
} from '../../src/server/services/reinigung/sollzeit.js';
import { sekundenJeDurchgang, teileHalbAuf }
  from '../../src/server/services/kalkulation/richtzeit.js';
import type { MilliMenge } from '../../src/server/services/finanz/menge.js';

const milli = (wert: number): MilliMenge => BigInt(Math.round(wert * 1000)) as MilliMenge;

function raum(
  id: string, belagsart: string, flaecheQm: number, leistungswertQmH: number, i = 0,
): RaumEingabe {
  return {
    raumId: id,
    belagsartId: belagsart,
    belagsartBezeichnung: belagsart,
    flaeche: milli(flaecheQm),
    leistungswert: milli(leistungswertQmH),
    reihenfolge: i,
  };
}

describe('Σ der Räume ist die Sollzeit des Reviers (Abnahme 3)', () => {
  it('stimmt auf das Hundertstel genau, über achtzig Räume', () => {
    /**
     * Achtzig Räume, absichtlich krumm: 12,345 m² bei 137 m²/h ergibt keine
     * runde Minute, und genau daran misst K-16(c) seine Begründung.
     */
    const raeume = Array.from({ length: 80 }, (_, i) =>
      raum(`r${String(i)}`, 'pvc', 12.345 + i * 0.017, 137, i));

    const zeit = berechneRevierSollzeit(raeume);

    expect(summeDerRaeume(zeit)).toBe(zeit.hundertstelMinuten);
    expect(zeit.raeume).toHaveLength(80);
  });

  it('auch bei mehreren Belagsarten mit verschiedenen Leistungswerten', () => {
    const raeume = [
      raum('a', 'pvc', 42.5, 250, 0),
      raum('b', 'teppich', 18.75, 180, 1),
      raum('c', 'fliese', 7.125, 95, 2),
      raum('d', 'pvc', 3.33, 250, 3),
      raum('e', 'teppich', 101.4, 180, 4),
    ];
    const zeit = berechneRevierSollzeit(raeume);
    expect(summeDerRaeume(zeit)).toBe(zeit.hundertstelMinuten);
  });

  it('ein Revier ohne Räume hat null Minuten und wirft nicht', () => {
    // Der Zustand direkt nach dem Anlegen einer Zone. Ein Fehler dafür machte
    // den Normalfall zur Ausnahme.
    const zeit = berechneRevierSollzeit([]);
    expect(zeit.sollzeitMinuten).toBe('0.00');
    expect(zeit.raeume).toEqual([]);
  });
});

describe('die Sollzeit ist die Kalkulation aus PR 25 (Abnahme 3)', () => {
  it('je Belagsart genau ein Aufruf von sekundenJeDurchgang', () => {
    const raeume = [
      raum('a', 'pvc', 42.5, 250, 0),
      raum('b', 'pvc', 3.33, 250, 1),
      raum('c', 'teppich', 18.75, 180, 2),
    ];

    /**
     * Die Gegenrechnung läuft über DIESELBE Funktion, die PR 25 benutzt, und
     * gruppiert wie PR 25 gruppiert: Fläche je Belagsart summieren, EINMAL
     * teilen. Käme hier eine eigene Formel, prüfte der Test seine eigene
     * Arithmetik.
     */
    const erwartet =
      sekundenJeDurchgang({
        belagsartId: 'pvc', bezeichnung: 'pvc',
        flaeche: (milli(42.5) + milli(3.33)) as MilliMenge,
        leistungswert: milli(250),
      })
      + sekundenJeDurchgang({
        belagsartId: 'teppich', bezeichnung: 'teppich',
        flaeche: milli(18.75), leistungswert: milli(180),
      });

    const zeit = berechneRevierSollzeit(raeume);
    expect(zeit.sekunden).toBe(erwartet);
    // Und die gespeicherte Größe ist genau EINE Umrechnung davon.
    expect(zeit.hundertstelMinuten).toBe(hundertstelAusSekunden(erwartet));
    expect(zeit.sollzeitMinuten).toBe(alsMinutenText(hundertstelAusSekunden(erwartet)));
  });

  it('drei Räume derselben Belagsart werden EINMAL geteilt, nicht dreimal', () => {
    /**
     * Der Fall, den die Gruppierung rettet. Einzeln gerundet ergeben die drei
     * Räume eine andere Sekundenzahl als ihre Summe — bis zu anderthalb
     * Sekunden, jedes Mal in dieselbe Richtung.
     */
    const drei = [
      raum('a', 'pvc', 10.001, 137, 0),
      raum('b', 'pvc', 10.001, 137, 1),
      raum('c', 'pvc', 10.001, 137, 2),
    ];
    const einzeln = drei.reduce(
      (s, r) => s + sekundenJeDurchgang({
        belagsartId: r.belagsartId, bezeichnung: r.belagsartBezeichnung,
        flaeche: r.flaeche, leistungswert: r.leistungswert,
      }),
      0n,
    );
    const gemeinsam = sekundenJeDurchgang({
      belagsartId: 'pvc', bezeichnung: 'pvc',
      flaeche: (milli(10.001) * 3n) as MilliMenge,
      leistungswert: milli(137),
    });

    // Die beiden Wege gehen wirklich auseinander — sonst wäre die
    // Gruppierung eine Behauptung ohne Gegenstand.
    expect(einzeln).not.toBe(gemeinsam);
    expect(berechneRevierSollzeit(drei).sekunden).toBe(gemeinsam);
  });
});

describe('es wird nicht zweimal gerundet (Abnahme 3)', () => {
  it('die naive Fassung — je Raum runden, dann summieren — liegt daneben', () => {
    const raeume = Array.from({ length: 40 }, (_, i) =>
      raum(`r${String(i)}`, 'pvc', 5.007 + i * 0.003, 211, i));

    const zeit = berechneRevierSollzeit(raeume);

    /**
     * Die Falle, um die es geht: jeder Raum für sich über PR 25 gerechnet und
     * auf Hundertstelminuten gerundet, dann summiert. Das ist die Umsetzung,
     * die jemand schreibt, der K-16(c) nicht gelesen hat.
     */
    const naiv = raeume.reduce(
      (s, r) => s + hundertstelAusSekunden(sekundenJeDurchgang({
        belagsartId: r.belagsartId, bezeichnung: r.belagsartBezeichnung,
        flaeche: r.flaeche, leistungswert: r.leistungswert,
      })),
      0n,
    );

    expect(naiv).not.toBe(zeit.hundertstelMinuten);
    // Und die Kopfsumme ist die richtige: eine einzige Umrechnung der
    // PR-25-Sekunden.
    expect(zeit.hundertstelMinuten).toBe(hundertstelAusSekunden(zeit.sekunden));
  });

  it('die Räume bekommen Anteile, keine eigenen Rundungen', () => {
    const raeume = [
      raum('a', 'pvc', 1, 60, 0),
      raum('b', 'pvc', 1, 60, 1),
      raum('c', 'pvc', 1, 60, 2),
    ];
    // 3 m² bei 60 m²/h = 180 Sekunden = 3,00 Minuten = 300 Hundertstel.
    const zeit = berechneRevierSollzeit(raeume);
    expect(zeit.hundertstelMinuten).toBe(300n);
    expect(summeDerRaeume(zeit)).toBe(300n);
    expect(zeit.raeume.map((r) => r.sollzeitMinuten)).toEqual(['1.00', '1.00', '1.00']);
  });
});

describe('die Verteilung ist deterministisch', () => {
  it('dieselben Räume in anderer Eingabereihenfolge ergeben dieselben Anteile', () => {
    const raeume = [
      raum('a', 'pvc', 3.337, 137, 0),
      raum('b', 'pvc', 3.337, 137, 1),
      raum('c', 'pvc', 3.337, 137, 2),
      raum('d', 'teppich', 9.991, 180, 3),
    ];
    const vorwaerts = berechneRevierSollzeit(raeume);
    const rueckwaerts = berechneRevierSollzeit([...raeume].reverse());

    expect(rueckwaerts.hundertstelMinuten).toBe(vorwaerts.hundertstelMinuten);
    const nach = (z: typeof vorwaerts): Record<string, string> =>
      Object.fromEntries(z.raeume.map((r) => [r.raumId, r.sollzeitMinuten]));
    expect(nach(rueckwaerts)).toEqual(nach(vorwaerts));
  });
});

describe('was nicht gerechnet wird', () => {
  it('ein Raum ohne Leistungswert wirft, statt null Minuten zu ergeben', () => {
    // Eine Division, die durchginge, machte daraus eine verschwundene Zeit —
    // und damit einen Preis, den niemand gesetzt hat (O-17).
    expect(() => berechneRevierSollzeit([
      { ...raum('a', 'pvc', 10, 1), leistungswert: 0n as MilliMenge },
    ])).toThrow(SollzeitFehler);
  });

  it('eine negative Fläche wirft', () => {
    expect(() => berechneRevierSollzeit([
      { ...raum('a', 'pvc', 10, 250), flaeche: -1n as MilliMenge },
    ])).toThrow(SollzeitFehler);
  });
});

describe('die Minutendarstellung', () => {
  it('schreibt zwei Nachkommastellen, wie numeric(8,2) sie liest', () => {
    expect(alsMinutenText(0n)).toBe('0.00');
    expect(alsMinutenText(5n)).toBe('0.05');
    expect(alsMinutenText(12_345n)).toBe('123.45');
  });

  it('rechnet Sekunden kaufmännisch in Hundertstelminuten um', () => {
    // 100 s = 1,6667 min → 166,67 Hundertstel.
    expect(hundertstelAusSekunden(100n)).toBe(teileHalbAuf(100n * 100n, 60n));
    expect(hundertstelAusSekunden(60n)).toBe(100n);
  });
});
