import 'server-only';
import type { GebundenerWert, Quelle, WertToken } from './typen.js';

/**
 * Das Wertregister: jede Zahl und jedes Datum eines Laufs, mit Herkunft
 * (Invariante 6, AGT-07, K-10).
 *
 * **Warum es das gibt.** Ein Modell darf keine Zahl erzeugen und keine
 * ausrechnen. Es darf aber über eine reden — „das Angebot liegt bei 456,00 €"
 * ist ein sinnvoller Satz. Die Auflösung: der Dienst rechnet, das Ergebnis
 * bekommt einen Token, und das Modell schreibt den Token. Beim Zusammenbauen
 * des Textes wird der Token durch `anzeige` ersetzt.
 *
 * **Eine freistehende Zahl im erzeugten Text ist ein harter Fehler.** Nicht
 * ein Schönheitsfehler: sie hat keine Herkunft, niemand kann sie nachrechnen,
 * und im Zweifel steht sie in einem Angebot. `pruefeText` findet sie.
 */

export class RegisterFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'RegisterFehler';
  }
}

export class Wertregister {
  readonly #werte = new Map<WertToken, GebundenerWert>();
  #naechster = 1;

  /**
   * Nimmt einen gerechneten Wert auf und gibt seinen Token zurück.
   *
   * `konfidenz` und `unsicher` werden aus den Eingaben übernommen, nicht neu
   * gesetzt: ein Preis, der auf einer unsicheren Fläche beruht, ist unsicher,
   * auch wenn die Multiplikation selbst exakt war (§5.5 Regel 7).
   */
  binde(teil: {
    readonly art: GebundenerWert['art'];
    readonly betragCent?: bigint;
    readonly wert?: string;
    readonly instant?: string;
    readonly einheit?: string;
    readonly anzeige: string;
    readonly quelle: Quelle;
    readonly abgeleitetVon?: readonly string[];
    readonly eingaben?: readonly GebundenerWert[];
  }): GebundenerWert {
    const token = `z${this.#naechster}` as WertToken;
    this.#naechster += 1;

    const eingaben = teil.eingaben ?? [];
    const gebunden: GebundenerWert = {
      token,
      art: teil.art,
      ...(teil.betragCent === undefined ? {} : { betragCent: teil.betragCent }),
      ...(teil.wert === undefined ? {} : { wert: teil.wert }),
      ...(teil.instant === undefined ? {} : { instant: teil.instant }),
      ...(teil.einheit === undefined ? {} : { einheit: teil.einheit }),
      anzeige: teil.anzeige,
      quelle: teil.quelle,
      /* Das Minimum über die Eingaben — eine Kette ist so sicher wie ihr schwächstes Glied. */
      konfidenz: eingaben.length === 0 ? 1 : Math.min(...eingaben.map((e) => e.konfidenz)),
      unsicher: eingaben.some((e) => e.unsicher),
      abgeleitetVon: teil.abgeleitetVon ?? eingaben.map((e) => e.token),
    };
    this.#werte.set(token, gebunden);
    return gebunden;
  }

  lies(token: string): GebundenerWert {
    const wert = this.#werte.get(token as WertToken);
    if (wert === undefined) throw new RegisterFehler(`Unbekannter Werttoken: ${token}`);
    return wert;
  }

  alle(): readonly GebundenerWert[] { return [...this.#werte.values()]; }

  /**
   * Ersetzt jeden Token durch seine Anzeige — und weist Text zurück, in dem
   * eine Zahl steht, die kein Token ist.
   *
   * **Was als Zahl gilt.** Jede Ziffernfolge, die nicht Teil eines Tokens ist.
   * Das ist streng: „Los 1" und „§ 2 Abs. 6" fallen mit hinein. Deshalb nimmt
   * `pruefeText` eine Liste erlaubter Wendungen — und deshalb ist sie kurz und
   * ausdrücklich, statt dass die Regel weich wird.
   */
  setzeEin(text: string, erlaubt: readonly RegExp[] = []): string {
    const ersetzt = text.replace(/z([0-9]+)/gu, (treffer) => {
      const wert = this.#werte.get(treffer as WertToken);
      return wert === undefined ? treffer : wert.anzeige;
    });

    let rest = ersetzt;
    for (const muster of [...ERLAUBTE_ZAHLEN, ...erlaubt]) {
      rest = rest.replace(muster, '');
    }
    /* Die eingesetzten Anzeigen sind selbst Zahlen — sie stehen jetzt drin und sind gewollt. */
    for (const wert of this.#werte.values()) {
      while (rest.includes(wert.anzeige)) rest = rest.replace(wert.anzeige, '');
    }
    const uebrig = /[0-9]/u.exec(rest);
    if (uebrig !== null) {
      throw new RegisterFehler(
        `Freistehende Zahl im erzeugten Text: „${rest.slice(Math.max(0, uebrig.index - 20), uebrig.index + 20).trim()}". `
        + 'Jede Zahl braucht einen Token aus dem Register (Invariante 6).');
    }
    return ersetzt;
  }
}

/**
 * Zahlen, die keine gerechneten Werte sind — und deshalb keinen Token
 * brauchen. Die Liste ist kurz und ausdrücklich; sie zu verlängern ist eine
 * Entscheidung, die jemand trifft, und keine, die sich einschleicht.
 */
const ERLAUBTE_ZAHLEN: readonly RegExp[] = [
  /§+\s*\d+[a-z]?(\s*Abs\.\s*\d+)?(\s*Nr\.\s*\d+)?/giu,   // Gesetzesstellen
  /\bLos(e)?\s+\d+(\s*(bis|–|-)\s*\d+)?/giu,               // „Lose 1 bis 3"
  /\bVOB\/[ABC]\b/giu,
  /\bDIN\s*(EN\s*)?(ISO\s*)?\d+(-\d+)?/giu,
  /\bFormblatt\s+\d+/giu,
  /\bCPV[- ]?\d{8}(-\d)?/giu,
  /\bDE[0-9A-Z]{0,3}\b/gu,                                  // NUTS
];
