import 'server-only';

/**
 * Ein Prozentsatz als BASISPUNKTE — die eine Umrechnung, einmal geschrieben.
 *
 * Es gab sie zweimal: in `kalkulation/bestaetigung.ts` fuer die Zuschlaege
 * und in `auftrag/abschluss.ts` fuer den Sicherheitseinbehalt. Derselbe
 * Algorithmus, aber zwei Regeln (`^\d+…` gegen `^\d{1,3}…`), zwei Grenzen
 * (100000 gegen 10000), zwei Fehlerklassen und ein `%`, das die eine Fassung
 * abschnitt und die andere abwies. Zwei Wahrheiten ueber dieselbe Rechnung
 * sind eine zu viel — und geprueft wurde jeweils nur eine davon.
 *
 * **Warum ueber Zeichenketten und nicht `Number(text) * 100`.** `4.35 * 100`
 * ist in IEEE-754 `434.99999999999994`, `1.15 * 100` ist `114.99999999999999`.
 * Mit `Math.round` ginge das gut aus, solange der Bereich klein bleibt und
 * niemand die Rundung wegnimmt. Die Zerlegung ist exakt, und das ist dieselbe
 * Absicht wie Invariante 1: eine Zahl, die einen Betrag bestimmt, entsteht
 * nicht aus einem Fliesskommawert.
 *
 * **Warum ein Ergebnis und keine Ausnahme.** Die beiden Aufrufer tragen eigene
 * Fehlerklassen (`KalkulationFehler`, `AbschlussFehler`), und die Routen
 * darueber uebersetzen genau diese in einen Grund und einen Satz. Ein hier
 * geworfener dritter Typ liefe durch `grundAus` hindurch und wuerde zu einer
 * 500 ohne Text. Die Entscheidung, WIE es heisst, bleibt deshalb beim
 * Aufrufer; hier steht nur, WAS der Fall ist.
 */
export type ProzentErgebnis =
  /** Eine lesbare Angabe im erlaubten Bereich. */
  | { readonly art: 'ok'; readonly bp: number }
  /** Keine Prozentangabe: leer, Buchstaben, Vorzeichen, drei Nachkommastellen. */
  | { readonly art: 'unlesbar' }
  /** Lesbar, aber ueber der Grenze des Aufrufers. */
  | { readonly art: 'ausserhalb'; readonly bp: number };

/**
 * @param hoechstens Obergrenze in BASISPUNKTEN — `10_000` sind 100 %.
 */
export function prozentInBasispunkteOderGrund(
  eingabe: string, hoechstens: number,
): ProzentErgebnis {
  /**
   * Leerzeichen und ein angehaengtes Prozentzeichen fallen weg.
   *
   * Wer in ein Feld mit der Aufschrift „%" `5 %` tippt, hat sich nicht
   * vertan. Die strengere der beiden alten Fassungen wies das ab — eine
   * Haerte ohne Gewinn, und ausgerechnet an der Stelle, an der ein Mensch den
   * Satz sowieso mit Einheit liest.
   */
  const text = eingabe.trim().replace(/\s|%/gu, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/u.test(text)) return { art: 'unlesbar' };
  const [ganz = '0', bruch = ''] = text.split('.');
  const bp = Number(ganz) * 100 + Number(bruch.padEnd(2, '0'));
  if (!Number.isSafeInteger(bp)) return { art: 'unlesbar' };
  if (bp > hoechstens) return { art: 'ausserhalb', bp };
  return { art: 'ok', bp };
}
