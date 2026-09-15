import { describe, expect, it } from 'vitest';
import { pruefeZahlenherkunft } from '../../src/server/agent/zahlenherkunft.js';

/**
 * **Invariante 6 als Laufzeitwache** (D-510).
 *
 * Bisher bewies ein Isolationstest gegen den Demobetrieb, dass keine Zahl
 * erfunden wird. Über einen echten Anbieter beweist das nichts: er hätte eine
 * Frist, eine Menge oder einen Betrag erfinden können, und daraus wäre ein
 * freigabefähiger Entwurf geworden. Die Wache steht deshalb im Betrieb, vor
 * dem Einfügen der Freigabe — und hier steht, was sie fängt.
 */
describe('Zahlenherkunft', () => {
  const tatsachen = {
    betrag: '1.234,56 €',
    frist: '14.09.2026',
    anzahl: '9',
  };

  it('was in den Tatsachen steht, darf im Entwurf stehen', () => {
    const befund = pruefeZahlenherkunft(
      'Der offene Betrag von 1.234,56 € ist seit dem 14.09.2026 fällig; es sind 9 Vorgänge.',
      tatsachen);
    expect(befund.sauber).toBe(true);
    expect(befund.erfunden).toEqual([]);
  });

  /**
   * Der Fall, wegen dessen es die Wache gibt: eine Zahl, die plausibel
   * aussieht und nirgends herkommt. Ein Mensch im Posteingang liest „binnen
   * 30 Tagen" und hält es für gerechnet.
   */
  it('eine erfundene Frist fällt auf', () => {
    const befund = pruefeZahlenherkunft(
      'Bitte begleichen Sie 1.234,56 € binnen 30 Tagen.', tatsachen);
    expect(befund.sauber).toBe(false);
    expect(befund.erfunden).toEqual(['30']);
  });

  /**
   * **Die Grenze der Wache, ausgeschrieben — und sie ist Absicht.**
   *
   * `binnen 14 Tagen` kommt DURCH, weil `14` als Ziffernfolge im Datum
   * `14.09.2026` steht. Die Wache prüft Herkunft, nicht Bedeutung: sie
   * beweist, dass jede Ziffernfolge schon einmal dastand, nicht dass sie im
   * richtigen Zusammenhang steht.
   *
   * Das ist die Grenze, die eine stumpfe Wache hat, und die Alternative wäre
   * schlechter: eine Wache, die Bedeutung beurteilt, urteilt selbst — und
   * dann steht zwischen dem Modell und der Freigabe ein zweites Modell. Der
   * Schutz gegen diesen Rest ist der Mensch im Posteingang, und er sieht die
   * Tatsachen neben dem Entwurf.
   *
   * Dieser Test steht hier, damit niemand die Lücke später für einen Fehler
   * hält und die Wache „verbessert", bis sie rät.
   */
  it('eine Ziffernfolge im falschen Zusammenhang fängt sie NICHT — und das ist bekannt', () => {
    const befund = pruefeZahlenherkunft(
      'Bitte begleichen Sie 1.234,56 € binnen 14 Tagen.', tatsachen);
    expect(befund.sauber, '14 steht als Ziffernfolge im Datum 14.09.2026').toBe(true);
  });

  /**
   * **Keine Toleranz, auch nicht für „kleine" Zahlen.** Eine Wache, die
   * entscheidet, welche erfundene Zahl harmlos ist, ist keine Wache — und
   * „3 Objekte" statt „9 Objekte" ist kein kleiner Fehler.
   */
  it('auch eine kleine Zahl ist erfunden, wenn sie nirgends steht', () => {
    const befund = pruefeZahlenherkunft('Es sind 3 Vorgänge offen.', tatsachen);
    expect(befund.sauber).toBe(false);
    expect(befund.erfunden).toEqual(['3']);
  });

  it('ein Entwurf ohne Zahlen ist immer sauber', () => {
    expect(pruefeZahlenherkunft('Bitte prüfen Sie die offenen Vorgänge.', tatsachen).sauber)
      .toBe(true);
  });

  /**
   * **Die Vorlage gehört mit in die erlaubte Menge.** Sie ist Text, den diese
   * Anwendung geschrieben hat — ein Gesetzesverweis darin ist keine Erfindung
   * des Modells.
   */
  it('Ziffern aus der Vorlage sind erlaubt', () => {
    const befund = pruefeZahlenherkunft(
      'Nach § 14 Abs. 4 UStG sind 9 Angaben nötig.', tatsachen, '§ 14 Abs. 4 UStG');
    expect(befund.sauber).toBe(true);
  });

  /**
   * „1.234,56" ist eine Zahl und drei Ziffernfolgen. Die Wache verlangt sie
   * einzeln — strenger als ein Zahlenvergleich, und hier ist strenger richtig:
   * „123,45 €" träfe sonst auf „1.234,56 €" zu.
   */
  it('Ziffernfolgen einzeln, nicht Zahlen als Ganzes', () => {
    const befund = pruefeZahlenherkunft('Der Betrag lautet 1.234,78 €.', tatsachen);
    expect(befund.sauber).toBe(false);
    expect(befund.erfunden).toEqual(['78']);
  });
});
