import 'server-only';

/**
 * Die beiden Fenster aus APR-05 und APR-06 — **als Voreinstellung** (O-108,
 * D-780).
 *
 * // TODO(client, O-108): Voreinstellung — Einspruchsfenster 30 Minuten,
 * // Rücknahmefenster 60 Minuten, für alle Vorgangsarten gleich (D-780).
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

/** Die Frage hinter der Voreinstellung beider Zahlen — sie steht in der Oberfläche. */
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
 * Und sie gibt für jede Vorgangsart `false` zurück — Voreinstellung (O-368,
 * D-799): keine Handlung ist umkehrbar, eine Korrektur ist eine neue Freigabe
 * oder ein Storno. Der Weg steht, er ist für nichts armiert, und das sagt die
 * Prüfseite auch. Wer eine Rückholung baut, trägt ihre Vorgangsart in
 * `app.freigabe_umkehrbar` ein.
 */
export const RUECKNAHME_OFFENE_FRAGE = 'O-368';
