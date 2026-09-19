/**
 * Die Felder, die zur ÜBERMITTLUNG gehören und nicht zum Formular.
 *
 * **Warum diese Liste eine eigene Datei ist.** Die Annahme validiert jede
 * Einsendung gegen die veröffentlichte `formular_definition` und weist alles
 * ab, was dort nicht steht — richtig so, denn genau das hält erfundene Felder
 * draussen (SEC-A4). Die versteckten Felder des Formulars stehen aber
 * naturgemäss nicht in der Definition: `bereich` sagt, welches Formular
 * gemeint ist, `sprache`, in welcher Sprache geantwortet wird, `website` ist
 * der Honigtopf, und `antwort` ist die Weiche „Browser bekommt eine Seite"
 * (D-599).
 *
 * **Der Fall, der diese Datei erzwungen hat.** `antwort` kam mit D-599 hinzu
 * und wurde in der Ausnahmeliste der Route vergessen. Die Folge war kein
 * Randfall: **jede** Absendung des Angebotsformulars wurde abgewiesen, mit
 * „Bitte prüfen Sie die markierten Felder" und einem Feldnamen, den es nicht
 * gibt. Der Kommentar über der Liste warnte wörtlich davor — und die Zeile
 * wurde trotzdem vergessen. Ein Kommentar ist keine Vorrichtung.
 *
 * Jetzt steht die Liste an EINER Stelle, und
 * `tests/kern/formular-uebermittlung.test.ts` liest die Formularkomponente und
 * prüft, dass jedes versteckte Feld darin vorkommt. Ein neues verstecktes Feld
 * ohne Eintrag hier macht den Test rot — nicht das Formular im Betrieb.
 */

export const UEBERMITTLUNGSFELDER: ReadonlySet<string> = new Set([
  /** Welches Formular gemeint ist — die Route liest daraus den Mandanten. */
  'bereich',
  /** In welcher Sprache geantwortet wird (D-82). */
  'sprache',
  /** Der Honigtopf: ausgefüllt heisst Bot, nicht Mensch (SEC-A5). */
  'website',
  /** „Ich bin ein Browser, schick mich auf eine Seite" (D-599). */
  'antwort',
  /** Die Herkunft des Besuchs (REQ-07). */
  'landing_page',
]);

/**
 * Gehört dieser Feldname zur Übermittlung?
 *
 * `utm_*` steht nicht einzeln in der Menge: die Namen kommen aus der Adresse
 * des Besuchs, und welche eine Kampagne benutzt, weiss niemand im Voraus.
 */
export function istUebermittlung(name: string): boolean {
  return UEBERMITTLUNGSFELDER.has(name) || name.startsWith('utm_');
}
