/**
 * REC-05, REC-08, LEG-12 — die Rangfolge rechnet die ANWENDUNG.
 *
 * Invariante 6 nennt Geld, Mengen und Fristen. Die Reihenfolge, in der
 * Menschen einer Einladung näherkommen, steht nicht in der Liste — und gehört
 * aus demselben Grund hinein: sie muss im Streit erklärbar sein, und ein
 * Modell erklärt nichts nach.
 */
import { describe, expect, it } from 'vitest';
import {
  BewertungFehler, punkteText, punktzahlZehntel, rangfolge, type Kriterium,
} from '../../src/server/services/recruiting/rangfolge.js';

const k = (kriterium: string, gewicht: number, punkte: number): Kriterium =>
  ({ kriterium, gewicht, punkte, begruendung: 'geprüft am Lebenslauf' });

describe('punktzahlZehntel', () => {
  it('gewichtet — und gibt Zehntel, keine Gleitkommazahl', () => {
    // (50*8 + 50*6) / 100 = 7,0
    expect(punktzahlZehntel([k('Erfahrung', 50, 8), k('Sprache', 50, 6)])).toBe(70);
  });

  it('ein schweres Kriterium zieht die Zahl — und zwar nachrechenbar', () => {
    // (80*9 + 20*2) / 100 = 7,6
    expect(punktzahlZehntel([k('§34a', 80, 9), k('Nähe', 20, 2)])).toBe(76);
  });

  it('die Gewichte müssen sich NICHT zu 100 summieren', () => {
    // (3*10 + 1*2) / 4 = 8,0
    expect(punktzahlZehntel([k('A', 3, 10), k('B', 1, 2)])).toBe(80);
  });

  it('rundet kaufmännisch — im Zweifel für die Einladung', () => {
    // (3*5 + 4*6) / 7 = 5,571… → 5,6
    expect(punktzahlZehntel([k('A', 3, 5), k('B', 4, 6)])).toBe(56);
  });

  it('keine Gleitkomma-Überraschung: 0,1 + 0,2 bleibt hier ganzzahlig', () => {
    /*
     * Derselbe Grund wie bei Geld (Invariante 1): eine Zahl, die zwischen
     * zwei Bewerbungen um 0.30000000000000004 abweicht, erzeugt eine
     * Reihenfolge, die niemand erklaeren kann.
     */
    const z = punktzahlZehntel([k('A', 1, 1), k('B', 2, 2)]);
    expect(Number.isInteger(z)).toBe(true);
    expect(z).toBe(17);
  });

  it('ohne Gewicht: 0 — unbewertet, nicht schlecht bewertet', () => {
    expect(punktzahlZehntel([])).toBe(0);
    expect(punktzahlZehntel([k('A', 0, 9)])).toBe(0);
  });

  it('weist ein Gewicht ausserhalb 0…100 ab', () => {
    expect(() => punktzahlZehntel([k('A', 101, 5)])).toThrow(BewertungFehler);
    expect(() => punktzahlZehntel([k('A', -1, 5)])).toThrow(BewertungFehler);
    expect(() => punktzahlZehntel([k('A', 1.5, 5)])).toThrow(BewertungFehler);
  });

  it('und Punkte ausserhalb 0…10', () => {
    expect(() => punktzahlZehntel([k('A', 50, 11)])).toThrow(BewertungFehler);
    expect(() => punktzahlZehntel([k('A', 50, -1)])).toThrow(BewertungFehler);
  });

  it('ein Kriterium ohne Begründung ist keines', () => {
    expect(() => punktzahlZehntel([
      { kriterium: 'Bauchgefühl', gewicht: 90, punkte: 9, begruendung: '   ' },
    ])).toThrow(/keine Begründung/u);
  });
});

describe('punkteText', () => {
  it('deutsches Komma, immer eine Nachkommastelle', () => {
    expect(punkteText(73)).toBe('7,3');
    expect(punkteText(100)).toBe('10,0');
    expect(punkteText(0)).toBe('0,0');
    expect(punkteText(5)).toBe('0,5');
  });
});

describe('rangfolge', () => {
  it('sortiert absteigend und vergibt Ränge', () => {
    const r = rangfolge([
      { eintrag: 'Amir', kriterien: [k('A', 100, 6)] },
      { eintrag: 'Bea', kriterien: [k('A', 100, 9)] },
      { eintrag: 'Cem', kriterien: [k('A', 100, 7)] },
    ]);
    expect(r.map((z) => z.eintrag)).toEqual(['Bea', 'Cem', 'Amir']);
    expect(r.map((z) => z.rang)).toEqual([1, 2, 3]);
  });

  it('Gleichstand teilt den Rang — und der nächste überspringt (1,2,2,4)', () => {
    /*
     * Zwei Bewerbungen mit derselben Punktzahl kuenstlich zu trennen hiesse,
     * eine Reihenfolge zu erfinden, die die Kriterien nicht hergeben — und
     * genau die muesste man im Streit erklaeren.
     */
    const r = rangfolge([
      { eintrag: 'A', kriterien: [k('x', 100, 9)] },
      { eintrag: 'B', kriterien: [k('x', 100, 7)] },
      { eintrag: 'C', kriterien: [k('x', 100, 7)] },
      { eintrag: 'D', kriterien: [k('x', 100, 5)] },
    ]);
    expect(r.map((z) => z.rang)).toEqual([1, 2, 2, 4]);
  });

  it('bei Gleichstand bleibt die Reihenfolge des Eingangs — stabil sortiert', () => {
    const r = rangfolge([
      { eintrag: 'zuerst', kriterien: [k('x', 100, 7)] },
      { eintrag: 'danach', kriterien: [k('x', 100, 7)] },
    ]);
    expect(r.map((z) => z.eintrag)).toEqual(['zuerst', 'danach']);
  });

  it('jede Zeile trägt ihre Kriterien mit — die Zahl allein erklärt nichts', () => {
    const r = rangfolge([{ eintrag: 'A', kriterien: [k('§34a GewO', 80, 9)] }]);
    expect(r[0]?.kriterien).toHaveLength(1);
    expect(r[0]?.kriterien[0]?.kriterium).toBe('§34a GewO');
    expect(r[0]?.kriterien[0]?.begruendung).not.toBe('');
  });

  it('eine leere Liste ist eine leere Liste, kein Fehler', () => {
    expect(rangfolge([])).toEqual([]);
  });
});
