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
 * **Welche Ausführungen sich zurücknehmen lassen — steht in der DATENBANK.**
 *
 * Diese Liste stand hier, also in TypeScript, also nicht zwischen einem
 * direkten Aufruf und der Tabelle: `select app.freigabe_ruecknahme_fenster(…)`
 * armierte ein Fenster für einen versendeten E-Mail, und die Prüfung hier
 * merkte nichts davon. Seit `0153` entscheidet `app.freigabe_umkehrbar` —
 * eine Liste, zwei Eingänge wären zwei Listen.
 *
 * Und sie gibt heute für jede Vorgangsart `false` zurück: für die einzige
 * Handlung, die ausgeführt wird, ist kein Rückweg gebaut (O-368). Der Weg
 * steht, er ist für nichts armiert, und das sagt die Prüfseite auch.
 */
export const RUECKNAHME_OFFENE_FRAGE = 'O-368';
