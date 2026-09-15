import 'server-only';

/**
 * **Invariante 6 zur Laufzeit, nicht nur im Test.**
 *
 * Die Regel lautet: das Modell rechnet nichts und erfindet keine Zahl — jede
 * Zahl im Entwurf stand schon in den Tatsachen, gerechnet von einer geprüften
 * Funktion in `server/services/`. Bisher bewies das ein Test gegen den
 * Demobetrieb. Ein Test gegen den Demobetrieb beweist über einen echten
 * Anbieter aber nichts: er hätte eine Frist, eine Menge oder einen Betrag
 * erfinden können, und daraus wäre ein freigabefähiger Entwurf geworden.
 *
 * Deshalb steht die Prüfung hier, vor dem Einfügen der Freigabe, und sie ist
 * absichtlich stumpf: **jede Ziffernfolge im Entwurf muss in den Tatsachen
 * vorkommen.** Keine Toleranz, keine Normalisierung von Tausenderpunkten,
 * keine Ausnahme für „kleine" Zahlen. Eine Wache, die entscheidet, welche
 * erfundene Zahl harmlos ist, ist keine Wache.
 *
 * **Warum Ziffernfolgen und nicht Zahlen.** „1.234,56" ist eine Zahl und drei
 * Ziffernfolgen; sie einzeln zu verlangen ist strenger als die Zahl zu
 * vergleichen, und strenger ist hier richtig. Der Preis dafür ist, dass eine
 * Vorlage, die selbst Ziffern trägt („§ 14 UStG"), ihre Ziffern in den
 * Tatsachen wiederfinden muss — und das ist kein Preis, sondern eine
 * Aufforderung, auch Gesetzesverweise als Tatsache mitzugeben.
 */

/** Jede maximale Ziffernfolge — „1.234,56" ergibt `1`, `234`, `56`. */
function ziffernfolgen(text: string): readonly string[] {
  return text.match(/\d+/gu) ?? [];
}

export interface Herkunftsbefund {
  readonly sauber: boolean;
  /** Die Ziffernfolgen, die im Entwurf stehen und in keiner Tatsache. */
  readonly erfunden: readonly string[];
}

/**
 * Prüft einen Entwurf gegen die Tatsachen, aus denen er entstehen durfte.
 *
 * Die Vorlage gehört mit in die erlaubte Menge: sie ist Text, den DIESE
 * Anwendung geschrieben hat, und keine Erfindung des Modells.
 */
export function pruefeZahlenherkunft(
  entwurf: string, tatsachen: Readonly<Record<string, string>>, vorlage = '',
): Herkunftsbefund {
  const erlaubt = new Set(ziffernfolgen([vorlage, ...Object.values(tatsachen)].join(' ')));
  const erfunden = [...new Set(ziffernfolgen(entwurf))].filter((z) => !erlaubt.has(z));
  return { sauber: erfunden.length === 0, erfunden };
}
