/**
 * Die Abgabefrist des Vergaberadars in Worten und in Farbe (RAD-06, SPEC §14).
 *
 * **Warum das geprüft wird.** Die Fünf-Tage-Grenze ist keine Gestaltungsfrage:
 * unter fünf Tagen ist eine Bekanntmachung praktisch nicht mehr zu bieten, und
 * RAD-06 verlangt, dass sie rot dasteht. Die Zahl stand in `radar/page.tsx`
 * und wäre mit `/radar/[id]/status` ein zweites Mal dortgestanden — zwei
 * Abschriften einer Schwelle laufen auseinander, und die Liste hätte dann eine
 * andere Farbe als die Seite, auf die sie führt.
 *
 * **Und die Grenze ist `< 5`, nicht `<= 5`.** RAD-06 sagt „red under five
 * days"; bei genau fünf Tagen steht die Warnstufe. Eine Verschiebung um einen
 * Tag klingt harmlos und ist es nicht: sie macht aus der Liste, die morgens
 * durchgesehen wird, eine mit einem Tag zu wenig.
 */
import { describe, expect, it } from 'vitest';
import {
  BALD_TAGE, KNAPP_TAGE, fristKlasse, fristText, istKnapp,
} from '../../src/app/portal/[mandant]/radar/frist.js';
import { FRIST_KNAPP_TAGE } from '../../src/server/services/radar/gewichte.platzhalter.js';

describe('die Schwelle stammt aus RAD-06 und steht nur einmal', () => {
  it('KNAPP_TAGE ist dieselbe Zahl wie FRIST_KNAPP_TAGE der Bewertung', () => {
    /*
     * Zwei Stellen nennen „fuenf Tage": die Bewertung (das Fristkriterium) und
     * die Anzeige (die Farbe). Liefen sie auseinander, wuerde eine
     * Bekanntmachung rot dastehen, deren Fristkriterium noch nicht abzieht —
     * oder umgekehrt, und das ist die gefaehrlichere Richtung.
     */
    expect(KNAPP_TAGE).toBe(FRIST_KNAPP_TAGE);
    expect(KNAPP_TAGE).toBe(5);
  });

  it('die zweite Stufe liegt darüber', () => {
    expect(BALD_TAGE).toBeGreaterThan(KNAPP_TAGE);
  });
});

describe('istKnapp', () => {
  it('trifft vier Tage, drei, einen und heute', () => {
    for (const tage of [0, 1, 2, 3, 4]) {
      expect(istKnapp(tage), `${String(tage)} Tage`).toBe(true);
    }
  });

  it('trifft genau fünf Tage NICHT — RAD-06 sagt „unter fünf"', () => {
    expect(istKnapp(5)).toBe(false);
    expect(istKnapp(6)).toBe(false);
  });

  it('nennt eine abgelaufene Frist nicht „knapp" — sie ist etwas anderes', () => {
    /*
     * „Knapp" heisst: es ist noch zu schaffen, aber eng. Eine abgelaufene
     * Frist ist nicht eng, sondern vorbei, und die Liste zeigt dafuer die
     * Pille „Ueberfaellig" statt roter Schrift.
     */
    expect(istKnapp(-1)).toBe(false);
    expect(istKnapp(-100)).toBe(false);
  });

  it('nennt eine fehlende Frist nicht „knapp"', () => {
    /*
     * Keine genannte Frist ist keine kurze Frist. Eine Bekanntmachung ohne
     * Abgabetermin rot zu faerben hiesse, eine Dringlichkeit zu behaupten,
     * die die Quelle nicht hergibt.
     */
    expect(istKnapp(null)).toBe(false);
  });
});

describe('fristKlasse — die Farbe trägt die Bedeutung nie allein (DESIGN §9)', () => {
  it('unter fünf Tagen: danger', () => {
    expect(fristKlasse(4)).toContain('text-danger');
    expect(fristKlasse(0)).toContain('text-danger');
  });

  it('fünf bis dreizehn Tage: warning', () => {
    expect(fristKlasse(5)).toContain('text-warning');
    expect(fristKlasse(13)).toContain('text-warning');
  });

  it('ab vierzehn Tagen: gedämpft, keine Warnung', () => {
    expect(fristKlasse(14)).toBe('text-text-muted');
    expect(fristKlasse(90)).toBe('text-text-muted');
  });

  it('abgelaufen und ohne Frist: gedämpft — nicht rot', () => {
    expect(fristKlasse(-1)).toBe('text-text-subtle');
    expect(fristKlasse(null)).toBe('text-text-subtle');
  });

  it('gibt nur Klassen aus dem Satz von DESIGN §1 zurück', () => {
    /*
     * Eine Wache prueft Tailwind-Farben im Quelltext; dieser Fall prueft, dass
     * diese Funktion keine erfindet — sie ist die Stelle, an der eine Farbe
     * aus einer Zahl entsteht.
     */
    const erlaubt = new Set([
      'text-text-subtle', 'text-danger font-semibold', 'text-warning', 'text-text-muted',
    ]);
    for (const tage of [null, -5, 0, 4, 5, 13, 14, 365]) {
      expect(erlaubt.has(fristKlasse(tage)), String(tage)).toBe(true);
    }
  });
});

describe('fristText — die Zahl steht immer daneben', () => {
  it('beugt den Singular und nennt heute „heute"', () => {
    expect(fristText(0)).toBe('heute');
    expect(fristText(1)).toBe('noch 1 Tag');
    expect(fristText(2)).toBe('noch 2 Tage');
  });

  it('sagt „abgelaufen" statt einer negativen Zahl', () => {
    expect(fristText(-1)).toBe('Frist abgelaufen');
    expect(fristText(-90)).toBe('Frist abgelaufen');
  });

  it('sagt bei fehlender Frist, dass die QUELLE keine nennt', () => {
    /*
     * Nicht „keine Frist": das liesse sich als „unbefristet" lesen. Die
     * Bekanntmachung hat eine, nur steht sie nicht in der Antwort der Quelle.
     */
    expect(fristText(null)).toBe('keine Frist genannt');
  });
});
