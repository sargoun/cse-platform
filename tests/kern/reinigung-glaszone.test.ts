/**
 * Eine Glaszone rechnet auf die Glasfläche (V-358, O-349, D-830).
 *
 * Unterhaltsreinigung und Glasreinigung sind zwei Reviere über denselben
 * Räumen (CLN-05). Die Rechnung bleibt `berechneRevierSollzeit`; was die
 * Bezugsgrösse ändert, ist ihre Eingabe (`eingabeNachBezug`). Den Weg durch
 * die Datenbank prüft `tests/isolation/revier-glas.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  berechneRevierSollzeit, BEZUGSGROESSEN, eingabeNachBezug, GLAS_CODE, summeDerRaeume,
  type Glaswert, type RaumGrundlage,
} from '../../src/server/services/reinigung/sollzeit.js';
import type { MilliMenge } from '../../src/server/services/finanz/menge.js';

const milli = (wert: number): MilliMenge => BigInt(Math.round(wert * 1000)) as MilliMenge;

function raum(
  id: string, flaeche: number, glas: number, belag: { id: string; lw: number } | null, i: number,
): RaumGrundlage {
  return {
    raumId: id,
    belagsartId: belag?.id ?? null,
    belagsartBezeichnung: belag === null ? null : 'PVC',
    flaeche: milli(flaeche),
    fensterFlaeche: milli(glas),
    leistungswert: belag === null ? null : milli(belag.lw),
    reihenfolge: i,
  };
}

const PVC = { id: 'pvc', lw: 250 };
const GLAS: Glaswert = { belagsartId: 'glas', bezeichnung: 'Glas', leistungswert: milli(50) };

/** Büro mit Glas, Lager ohne Belag und ohne Glas, Foyer mit viel Glas. */
const RAEUME: readonly RaumGrundlage[] = [
  raum('buero', 20, 12.5, PVC, 0),
  raum('lager', 15, 0, null, 1),
  raum('foyer', 30, 30, PVC, 2),
];

describe('V-358 — die Bezugsgrösse bestimmt Fläche und Leistungswert', () => {
  it('es gibt genau zwei, und die Katalogzeile heisst GLAS', () => {
    expect(BEZUGSGROESSEN).toEqual(['boden', 'glas']);
    expect(GLAS_CODE).toBe('GLAS');
  });

  it('eine Glaszone rechnet Σ Glasfläche ÷ Leistungswert Glas — der Belag spielt keine Rolle', () => {
    const ohneBelag = raum('wintergarten', 10, 5, null, 3);
    const eingabe = eingabeNachBezug([...RAEUME, ohneBelag], 'glas', GLAS);
    // Das Lager hat kein Glas und fehlt; der Wintergarten ohne Belag zählt.
    expect(eingabe.map((e) => [e.raumId, e.flaeche, e.leistungswert])).toEqual([
      ['buero', milli(12.5), milli(50)],
      ['foyer', milli(30), milli(50)],
      ['wintergarten', milli(5), milli(50)],
    ]);
    const zeit = berechneRevierSollzeit(eingabe);
    // 47,5 m² Glas ÷ 50 m²/h = 0,95 h = 57 Minuten.
    expect(zeit.sekunden).toBe(3420n);
    expect(zeit.sollzeitMinuten).toBe('57.00');
    expect(zeit.raeume.map((r) => [r.raumId, r.sollzeitMinuten])).toEqual([
      ['buero', '15.00'], ['foyer', '36.00'], ['wintergarten', '6.00'],
    ]);
    expect(summeDerRaeume(zeit)).toBe(zeit.hundertstelMinuten);
  });

  it('eine Bodenzone rechnet wie bisher — der Raum ohne Belag fehlt und wird benannt', () => {
    const eingabe = eingabeNachBezug(RAEUME, 'boden', GLAS);
    expect(eingabe.map((e) => [e.raumId, e.flaeche, e.leistungswert])).toEqual([
      ['buero', milli(20), milli(250)],
      ['foyer', milli(30), milli(250)],
    ]);
    // 50 m² ÷ 250 m²/h = 0,2 h = 12 Minuten; das Glas zählt hier nicht.
    expect(berechneRevierSollzeit(eingabe).sollzeitMinuten).toBe('12.00');
  });

  it('ohne Katalogzeile GLAS lässt sich in einer Glaszone kein Raum rechnen', () => {
    expect(eingabeNachBezug(RAEUME, 'glas', null)).toEqual([]);
    expect(eingabeNachBezug(RAEUME, 'glas', { ...GLAS, leistungswert: 0n as MilliMenge }))
      .toEqual([]);
  });

  it('dieselben Räume ergeben je Bezugsgrösse eine andere Zeit', () => {
    const glas = berechneRevierSollzeit(eingabeNachBezug(RAEUME, 'glas', GLAS));
    const boden = berechneRevierSollzeit(eingabeNachBezug(RAEUME, 'boden', GLAS));
    expect(glas.sollzeitMinuten).not.toBe(boden.sollzeitMinuten);
  });
});
