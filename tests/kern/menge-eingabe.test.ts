import { describe, expect, it } from 'vitest';
import {
  MengeFehler, mengeAusEingabe, mengeAusPostgres, mengeNachPostgres,
} from '../../src/server/services/finanz/menge.js';

/**
 * **Die Menge aus einem Formular** (V-118, K-16).
 *
 * `mengeAusPostgres` nimmt genau die Gestalt, die die Datenbank ausgibt, und
 * mit Absicht keine andere — ein deutschformatierter Wert bedeutet dort, dass
 * er ungeprüft aus einem Formular kam. `mengeAusEingabe` ist die andere Seite
 * derselben Unterscheidung: sie nimmt, was ein Mensch tippt.
 *
 * Geprüft wird hier vor allem, dass NICHTS gerundet wird und nichts durch eine
 * Gleitkommazahl läuft. Ein Urlaubsanspruch von 25,5 Tagen, der als 25,4999
 * ankommt, ist ein halber Tag, den jemand im Streit sucht.
 */
describe('mengeAusEingabe', () => {
  it('nimmt Komma und Punkt und meint dasselbe', () => {
    expect(mengeAusEingabe('25,5')).toBe(25_500n);
    expect(mengeAusEingabe('25.5')).toBe(25_500n);
  });

  it('füllt die Nachkommastellen nach rechts auf', () => {
    expect(mengeAusEingabe('25')).toBe(25_000n);
    expect(mengeAusEingabe('25,5')).toBe(25_500n);
    expect(mengeAusEingabe('25,05')).toBe(25_050n);
    expect(mengeAusEingabe('25,005')).toBe(25_005n);
  });

  it('nimmt führende und folgende Leerzeichen hin', () => {
    expect(mengeAusEingabe('  30  ')).toBe(30_000n);
  });

  it('kennt das Vorzeichen', () => {
    expect(mengeAusEingabe('-2,5')).toBe(-2_500n);
  });

  /**
   * **Vier Nachkommastellen werden abgewiesen, nicht gerundet.** Die Spalte
   * hält drei; stilles Runden verstecke, dass jemand etwas anderes gemeint
   * hat — und bei einem Urlaubsanspruch ist genau das der Streit.
   */
  it('weist eine vierte Nachkommastelle ab', () => {
    expect(() => mengeAusEingabe('25,0001')).toThrow(MengeFehler);
  });

  it('weist ab, was keine Zahl ist', () => {
    for (const roh of ['', '   ', 'fünfundzwanzig', '25 Tage', '2e3', '1,2,3', '+5']) {
      expect(() => mengeAusEingabe(roh), roh).toThrow(MengeFehler);
    }
  });

  /**
   * Der Rundweg: was ein Mensch tippt, geht als `numeric(12,3)` in die
   * Datenbank und kommt als derselbe Wert zurück. Ohne diese Zusage könnten
   * die beiden Parser auseinanderlaufen, ohne dass es auffiele.
   */
  it('geht durch Postgres und zurück, ohne sich zu ändern', () => {
    for (const roh of ['25,5', '0', '1,001', '-7,25']) {
      const menge = mengeAusEingabe(roh);
      expect(mengeAusPostgres(mengeNachPostgres(menge)), roh).toBe(menge);
    }
  });
});
