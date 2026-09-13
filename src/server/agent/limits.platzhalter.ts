import 'server-only';

/**
 * Die Grenzwerte des Agentenlaufs, die **noch niemand entschieden hat**
 * (AGT-04, AGT-05, LEG-09).
 *
 * Eine eigene Datei, weil das der Unterschied zwischen einem Platzhalter und
 * einer erfundenen Regel ist: hier steht jeder unbestätigte Wert genau einmal,
 * mit seiner Frage daneben, und das Agenten-Zentrum zeigt ihn als
 * **PLATZHALTER** an. Kommt die Antwort, ändert sich diese Datei — und sonst
 * nichts.
 */

/**
 * Wie viele Werkzeugschritte ein Agent je Aufgabe ausführen darf, bevor er
 * abbricht und den Vorgang einem Menschen vorlegt.
 *
 * Ohne Bremse dreht ein Agent im Kreis, bis das Budget leer ist. Mit einer
 * stillen Bremse bekommt sie die Schuld an jedem abgeschnittenen Ergebnis —
 * deshalb steht sie sichtbar hier und wird im Lauf protokolliert.
 *
 * TODO(client, O-196): Wie viele Werkzeugschritte darf ein Agent je Aufgabe
 * ausführen, bevor er abbricht und den Vorgang einem Menschen vorlegt?
 */
export const MAX_SCHRITTE_PLATZHALTER = 12;

/**
 * Nach wie vielen Tagen Modell-Ein- und -Ausgaben eines Laufs geschwärzt
 * werden (LEG-09, DSGVO-Löschkonzept).
 *
 * Sie enthalten regelmäßig Kunden- und Beschäftigtendaten. Die Frist ist
 * **keine Rechtsauskunft**, sondern ein Platzhalter, der die Spalte füllen
 * muss, weil eine Zeile ohne Frist nie geschwärzt würde.
 *
 * TODO(client, O-198): Wie lange dürfen Modell-Ein- und -Ausgaben eines
 * Agentenlaufs gespeichert bleiben, bevor sie geschwärzt werden?
 */
export const NUTZLAST_FRIST_TAGE_PLATZHALTER = 90;

/**
 * Wie lange eine Budgetreservierung gilt, bevor der Wächter sie freigibt.
 *
 * Sie ist die Obergrenze der Laufzeit einer Aufgabe: was länger braucht, ist
 * abgestürzt, und sein Budget gehört zurück.
 *
 * TODO(client, O-196): Wie lange darf eine Agentenaufgabe höchstens laufen?
 */
export const RESERVIERUNG_MINUTEN_PLATZHALTER = 30;

/** Jeder Platzhalter dieser Datei, für die Anzeige im Agenten-Zentrum. */
export const AGENT_PLATZHALTER: readonly {
  readonly schluessel: string;
  readonly wert: number;
  readonly einheit: string;
  readonly frage: string;
}[] = [
  {
    schluessel: 'max_schritte',
    wert: MAX_SCHRITTE_PLATZHALTER,
    einheit: 'Schritte je Aufgabe',
    frage: 'Wie viele Werkzeugschritte darf ein Agent je Aufgabe ausführen (O-196)?',
  },
  {
    schluessel: 'nutzlast_frist',
    wert: NUTZLAST_FRIST_TAGE_PLATZHALTER,
    einheit: 'Tage bis zur Schwärzung',
    frage: 'Wie lange dürfen Modell-Ein- und -Ausgaben gespeichert bleiben (O-198)?',
  },
  {
    schluessel: 'reservierung',
    wert: RESERVIERUNG_MINUTEN_PLATZHALTER,
    einheit: 'Minuten Reservierungsdauer',
    frage: 'Wie lange darf eine Agentenaufgabe höchstens laufen (O-196)?',
  },
];
