import 'server-only';

/**
 * Die Gewichte der Radar-Bewertung, die **noch niemand entschieden hat**
 * (RAD-05, O-15).
 *
 * Eine eigene Datei — derselbe Grund wie bei `agent/limits.platzhalter.ts`:
 * so steht jeder unbestätigte Wert genau einmal, mit seiner Frage daneben,
 * und die Oberfläche kann ihn als **PLATZHALTER** ausweisen. Kommt die
 * Antwort des Mandanten, ändert sich diese Datei — und sonst nichts.
 *
 * **Warum das hier überhaupt Zahlen sind.** RAD-05 verlangt eine
 * deterministische Rangfolge mit einer lesbaren Begründung. Ohne Gewichte
 * gäbe es keine Rangfolge, also auch keine Liste, die jemand morgens
 * durchsieht. Die Zahlen unten sind deshalb ein *Gerüst*, kein Urteil: sie
 * sagen „CPV-Treffer wiegt mehr als ein Stichwort", weil das die Reihenfolge
 * der Kriterien in RAD-04 ist, und nicht, weil jemand 35 Punkte für richtig
 * hält.
 *
 * TODO(client, O-15): Welche Punkteskala und welche Gewichtung der Kriterien
 * (CPV, Region, Stichwörter, Auftragswert, Restfrist, Schwellenwert) gelten
 * für die Rangfolge im Vergaberadar — und ab welcher Punktzahl soll
 * benachrichtigt werden?
 */

/** Die Skala, auf der eine Bewertung entsteht. `radar_profil.skala_max` kopiert sie. */
export const SKALA_MAX_PLATZHALTER = 100;

/**
 * Was ein Kriterium höchstens beitragen kann. Die Summe der positiven
 * Beiträge ergibt genau `SKALA_MAX_PLATZHALTER`, damit „100" auch wirklich
 * „alles trifft zu" heisst und nicht ein zufälliger Zwischenstand ist.
 */
export const GEWICHTE_PLATZHALTER = {
  /** Der CPV-Code ist das schärfste Merkmal: er sagt, WAS beschafft wird. */
  cpv: 35,
  /** Die Region entscheidet, ob der Betrieb überhaupt hinfahren kann. */
  region: 25,
  /** Stichwörter fangen, was der CPV-Code nicht trennt („Unterhaltsreinigung" vs. „Baureinigung"). */
  stichwort: 20,
  /** Der Auftragswert: zu klein lohnt nicht, zu gross ist nicht zu stemmen. */
  wert: 15,
  /** Bleibt genug Zeit, ein vollständiges Angebot zu bauen? */
  frist: 5,
} as const;

/** Was ein Negativtreffer kostet, solange O-191 nicht beantwortet ist (Abzug, kein Ausschluss). */
export const ABZUG_PLATZHALTER = {
  /** Ein Negativ-Stichwort. */
  stichwort: 20,
  /** Ein CPV-Code, den das Profil als `abzug` führt. */
  cpv: 25,
  /** Die Bekanntmachung liegt auf der falschen Seite des Schwellenwerts. */
  schwellenwert: 10,
} as const;

/**
 * Ab wann eine Restfrist knapp ist. **Nicht** die Grenze, ab der eine
 * Bekanntmachung ausscheidet — die ist O-191 und steht als `frist_min_tage`
 * im Profil, wo ein Mensch sie setzt.
 *
 * Fünf Tage stehen so in RAD-06 („red under five days"), sind also nicht
 * erfunden, sondern die Zahl, die die Anforderung selbst nennt.
 */
export const FRIST_KNAPP_TAGE = 5;
