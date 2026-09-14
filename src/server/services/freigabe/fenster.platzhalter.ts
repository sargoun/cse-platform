import 'server-only';

/**
 * Die beiden Fenster aus APR-05 und APR-06 — **als Platzhalter**.
 *
 * // TODO(client) [O-108]: Wie lange soll das Einspruchsfenster (APR-05) und
 * // wie lange das Rücknahmefenster (APR-06) laufen, je Vorgangsart?
 *
 * **Warum eine eigene Datei mit `platzhalter` im Namen.** Diese beiden Zahlen
 * sind Betriebsentscheidungen, keine technischen Konstanten: fünfzehn Minuten
 * Einspruch heisst „wer gerade in einer Besprechung sitzt, hat keine Chance",
 * zwei Stunden heissen „nichts geht vor dem Mittag hinaus". Wer sie ändern
 * will, ändert eine Zeile hier und findet sie über den Dateinamen — statt sie
 * in einem Dienst zu suchen, in dem sie nebenbei steht.
 *
 * **Die Vorgabe ist bewusst kurz.** Ein langes Fenster ist keine zusätzliche
 * Sicherheit: es verschiebt nur, wann etwas passiert, und in der Zwischenzeit
 * steht der Vorgang halb entschieden da. Wer mehr Zeit braucht, genehmigt
 * später.
 */

/** Einspruchsfenster nach einer Genehmigung (APR-05), in Minuten. */
export const EINSPRUCH_MINUTEN = 30;

/** Rücknahmefenster nach der Ausführung (APR-06), in Minuten. */
export const RUECKNAHME_MINUTEN = 60;

/** Die offene Frage, die beide Zahlen trägt — sie steht in der Oberfläche. */
export const FENSTER_OFFENE_FRAGE = 'O-108';

/**
 * **Welche Ausführungen sich zurücknehmen lassen.**
 *
 * APR-06 sagt „wherever the action is reversible", und das ist keine
 * Einstellung, sondern eine Eigenschaft der Handlung. Ein versendetes E-Mail
 * ist weg; eine angelegte Eingangsrechnung lässt sich stornieren. Die Liste
 * ist deshalb kurz und ausdrücklich — sie zu verlängern heisst zu behaupten,
 * etwas sei umkehrbar, und das ist eine Behauptung mit Folgen.
 */
export const UMKEHRBAR: readonly string[] = ['buchung_uebernehmen', 'monatsrechnung_entwurf'];

export function istUmkehrbar(vorgangTyp: string): boolean {
  return UMKEHRBAR.includes(vorgangTyp);
}
