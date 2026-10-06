import 'server-only';

/**
 * Die Grenzwerte des Agentenlaufs — **Voreinstellungen**, vom Betreiber noch
 * nicht bestätigt (AGT-04, AGT-05, LEG-09, D-786).
 *
 * Eine eigene Datei, weil das der Unterschied zwischen einer Voreinstellung
 * und einer erfundenen Regel ist: hier steht jeder unbestätigte Wert genau
 * einmal, mit seiner Frage daneben, und das Agenten-Zentrum zeigt ihn als
 * **Voreinstellung** an. Bestätigt oder ändert der Betreiber ihn, ändert sich
 * diese Datei — und sonst nichts.
 */

/**
 * Wie viele Werkzeugschritte ein Agent je Aufgabe ausführen darf, bevor er
 * abbricht und den Vorgang einem Menschen vorlegt.
 *
 * Ohne Bremse dreht ein Agent im Kreis, bis das Budget leer ist. Mit einer
 * stillen Bremse bekommt sie die Schuld an jedem abgeschnittenen Ergebnis —
 * deshalb steht sie sichtbar hier und wird im Lauf protokolliert.
 *
 * TODO(client, O-196): Voreinstellung — 12 Werkzeugschritte je Aufgabe, dann
 * Abbruch und Vorlage an einen Menschen.
 */
export const MAX_SCHRITTE_PLATZHALTER = 12;

/**
 * Nach wie vielen Tagen Modell-Ein- und -Ausgaben eines Laufs geschwärzt
 * werden (LEG-09, DSGVO-Löschkonzept).
 *
 * Sie enthalten regelmäßig Kunden- und Beschäftigtendaten. Die Frist ist
 * **keine Rechtsauskunft**, sondern eine Voreinstellung, die die Spalte füllen
 * muss, weil eine Zeile ohne Frist nie geschwärzt würde.
 *
 * TODO(client, O-198): Voreinstellung — 90 Tage, dann Schwärzung der Modell-
 * Ein- und -Ausgaben (ausserhalb des GoBD-Bereichs).
 */
export const NUTZLAST_FRIST_TAGE_PLATZHALTER = 90;

/**
 * Wie lange eine Budgetreservierung gilt, bevor der Wächter sie freigibt.
 *
 * Sie ist die Obergrenze der Laufzeit einer Aufgabe: was länger braucht, ist
 * abgestürzt, und sein Budget gehört zurück.
 *
 * TODO(client, O-196): Voreinstellung — 30 Minuten Reservierung je Aufgabe.
 */
export const RESERVIERUNG_MINUTEN_PLATZHALTER = 30;

/** Jede Voreinstellung dieser Datei, für die Anzeige im Agenten-Zentrum. */
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
    frage: 'Voreinstellung: Werkzeugschritte je Aufgabe, dann Abbruch und Vorlage (O-196)',
  },
  {
    schluessel: 'nutzlast_frist',
    wert: NUTZLAST_FRIST_TAGE_PLATZHALTER,
    einheit: 'Tage bis zur Schwärzung',
    frage: 'Voreinstellung: Tage bis zur Schwärzung der Modell-Ein- und -Ausgaben (O-198)',
  },
  {
    schluessel: 'reservierung',
    wert: RESERVIERUNG_MINUTEN_PLATZHALTER,
    einheit: 'Minuten Reservierungsdauer',
    frage: 'Voreinstellung: längste Laufzeit einer Aufgabe, dann verfällt die Reservierung (O-196)',
  },
];
