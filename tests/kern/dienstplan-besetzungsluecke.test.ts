/**
 * Die Rechnung hinter `/dienstplan/offene-schichten` — ohne Datenbank
 * (TIM-05, REC-01, O-170, O-210).
 *
 * **Was hier bewiesen wird, und warum es ein Test ist und keine Zeile Prosa:**
 *
 *  1. Die Dringlichkeit einer Luecke kommt aus ZAHLEN und nie aus einer
 *     Formulierung (Invariante 6). Die Grenze ist die Mindestbesetzung, und
 *     gezaehlt werden ZUSAGEN — dieselbe Zaehlung wie in `bedarf()` (REC-01).
 *  2. Eine voll EINGETEILTE Schicht, auf der niemand zugesagt hat, ist
 *     dringend. Genau diesen Fall zeigt die Kachel `schichten_unbesetzt`
 *     nicht, weil sie `besetzt_anzahl` gegen `soll_besetzung` stellt — und
 *     genau er kostet am Einsatztag eine unbesetzte Nacht.
 *  3. Ein leeres oder verkehrtes Fenster ist KEIN „alle Schichten". Ein
 *     Filter, der bei unlesbarer Eingabe die Grenze wegfallen laesst, ist die
 *     teuerste Art von Bequemlichkeit.
 */
import { describe, expect, it } from 'vitest';
import {
  LueckenFensterFehler, dringlichkeit, pruefeFenster,
} from '../../src/server/services/dienstplan/besetzungsluecke.js';

describe('die Dringlichkeit einer Besetzungsluecke', () => {
  it('unter der Mindestbesetzung zaehlen ZUSAGEN, nicht Einteilungen', () => {
    // Zwei Wachen eingeteilt, Minimum zwei — aber niemand hat zugesagt.
    // `besetzt_anzahl < soll_besetzung` waere hier FALSCH und die Kachel
    // still; morgens steht niemand im Objekt.
    expect(dringlichkeit({
      eingeteilt: 2, sollBesetzung: 2, zugesagt: 0, minBesetzung: 2,
    })).toBe('unter_mindest');
  });

  it('die Mindestbesetzung steht, die vereinbarte Staerke nicht', () => {
    expect(dringlichkeit({
      eingeteilt: 1, sollBesetzung: 2, zugesagt: 1, minBesetzung: 1,
    })).toBe('unter_soll');
  });

  it('auch eine volle Einteilung ohne volle Zusage bleibt unter Soll', () => {
    expect(dringlichkeit({
      eingeteilt: 3, sollBesetzung: 3, zugesagt: 2, minBesetzung: 1,
    })).toBe('unter_soll');
  });

  it('beide Zahlen erreicht heisst voll', () => {
    expect(dringlichkeit({
      eingeteilt: 3, sollBesetzung: 3, zugesagt: 3, minBesetzung: 2,
    })).toBe('voll');
  });

  /**
   * O-210: bei einer Veranstaltung ist unklar, ob die vereinbarte Staerke
   * zugleich die Mindestbesetzung ist. `posten` traegt beide getrennt, die
   * Eventschicht bekommt den Spaltenvorgabewert 1 — die Funktion nimmt
   * `min_besetzung`, wie es in der Zeile steht, und leitet nichts ab.
   */
  it('leitet aus soll KEINE Mindestbesetzung ab (O-210)', () => {
    // Zehn vereinbart, Minimum 1 (der Spaltenvorgabewert), einer hat zugesagt:
    // das ist unter Soll und NICHT unter Minimum. Wer soll als Minimum liest,
    // meldet hier einen Notfall, den der Vertrag nicht hergibt.
    expect(dringlichkeit({
      eingeteilt: 1, sollBesetzung: 10, zugesagt: 1, minBesetzung: 1,
    })).toBe('unter_soll');
  });

  /**
   * O-170: ob eine ABSAGE die Besetzung sofort mindert, ist unbeantwortet.
   * Deshalb fuehrt der Dienst zwei Zahlen und nicht eine — und diese Funktion
   * bekommt beide, statt sich eine auszurechnen.
   */
  it('trennt Einteilung und Zusage, statt eine aus der anderen zu schliessen (O-170)', () => {
    const eingeteiltVoll = { eingeteilt: 2, sollBesetzung: 2 };
    expect(dringlichkeit({ ...eingeteiltVoll, zugesagt: 2, minBesetzung: 2 })).toBe('voll');
    expect(dringlichkeit({ ...eingeteiltVoll, zugesagt: 1, minBesetzung: 2 }))
      .toBe('unter_mindest');
  });
});

describe('das Fenster wird geprueft und nicht verbogen', () => {
  it('zwei Kalendertage gehen durch', () => {
    expect(() => pruefeFenster('2026-09-17', '2026-10-01')).not.toThrow();
  });

  it('ein Tagesfenster ist zulaessig — von und bis duerfen gleich sein', () => {
    expect(() => pruefeFenster('2026-09-17', '2026-09-17')).not.toThrow();
  });

  it('ein verkehrtes Fenster wirft, statt alles zu bedeuten', () => {
    expect(() => pruefeFenster('2026-10-01', '2026-09-17'))
      .toThrow(LueckenFensterFehler);
  });

  it('ein unlesbares Datum wirft', () => {
    expect(() => pruefeFenster('naechste Woche', '2026-09-17'))
      .toThrow(LueckenFensterFehler);
    expect(() => pruefeFenster('2026-09-17', '17.09.2026'))
      .toThrow(LueckenFensterFehler);
  });

  it('der Fehler traegt 400 — eine Eingabe, nicht ein Serverfehler', () => {
    expect(new LueckenFensterFehler('x').status).toBe(400);
  });
});
