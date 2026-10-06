/**
 * Die Voreinstellung der Prüfliste einer Vergabemappe (O-194, D-784) — die
 * FORM der Liste: zwölf Unterlagen, eindeutig, jede mit einer Bezeichnung, die
 * `ergaenzePosition` annimmt (mindestens drei Zeichen, höchstens 200), einer
 * der drei Arten und einem Pflichtkennzeichen; die Nachunternehmererklärung
 * ist die einzige freiwillige Zeile. Die Datenbankseite prüft
 * `tests/isolation/vergabemappe.test.ts` (6).
 */
import { describe, expect, it } from 'vitest';
import { PRUEFLISTE_VOREINSTELLUNG } from '../../src/server/services/vergabe/mappe.js';

describe('O-194 — die zwölf Unterlagen der Voreinstellung', () => {
  it('zwölf Zeilen, eindeutig, mit tragfähiger Bezeichnung und einer der drei Arten', () => {
    expect(PRUEFLISTE_VOREINSTELLUNG).toHaveLength(12);
    const namen = PRUEFLISTE_VOREINSTELLUNG.map((p) => p.bezeichnung.toLowerCase());
    expect(new Set(namen).size).toBe(namen.length);
    for (const p of PRUEFLISTE_VOREINSTELLUNG) {
      expect(p.bezeichnung.trim().length, p.bezeichnung).toBeGreaterThanOrEqual(3);
      expect(p.bezeichnung.length, p.bezeichnung).toBeLessThanOrEqual(200);
      expect(['Angebot', 'Eignung', 'Erklärung'], p.bezeichnung).toContain(p.kategorie);
    }
  });

  it('nur die Nachunternehmererklärung ist freiwillig; Angebot und Eignung sind Pflicht', () => {
    const freiwillig = PRUEFLISTE_VOREINSTELLUNG.filter((p) => !p.pflicht);
    expect(freiwillig.map((p) => p.bezeichnung))
      .toEqual(['Erklärung zu Nachunternehmen und Eignungsleihe']);
    expect(PRUEFLISTE_VOREINSTELLUNG.filter((p) => p.kategorie === 'Angebot')).toHaveLength(2);
    expect(PRUEFLISTE_VOREINSTELLUNG.filter((p) => p.kategorie === 'Eignung')).toHaveLength(8);
    expect(PRUEFLISTE_VOREINSTELLUNG.filter((p) => p.kategorie === 'Erklärung')).toHaveLength(2);
  });
});
