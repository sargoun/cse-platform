/**
 * **Die Beschäftigungsart einer Stelle** (V-362, O-200, D-816).
 *
 * Das Vokabular ist die Voreinstellung zu O-200 (D-797): Vollzeit, Teilzeit,
 * Minijob, Aushilfe — die Begriffe, nach denen Bewerbende und Stellenbörsen
 * fragen. `stelle.beschaeftigungsart` (0512) speichert die Wahl eines
 * Menschen; `NULL` heisst „nicht festgelegt".
 *
 * **Ein Vorschlag, keine Ableitung.** Aus den Wochenstunden lässt sich nur
 * Vollzeit oder Teilzeit vorschlagen: ein Minijob bestimmt sich nach dem
 * Verdienst (§ 8 SGB IV), eine Aushilfe nach der Dauer — beides steht nicht
 * in den Stunden. Das Formular wählt den Vorschlag vor, der Mensch entscheidet.
 */

export const BESCHAEFTIGUNGSARTEN = ['vollzeit', 'teilzeit', 'minijob', 'aushilfe'] as const;
export type Beschaeftigungsart = (typeof BESCHAEFTIGUNGSARTEN)[number];

/**
 * TODO(client, O-200): Voreinstellung — als Vollzeit vorgeschlagen wird ab 35
 * Wochenstunden, darunter Teilzeit (übliche tarifliche Vollzeit 35 bis 40
 * Stunden; § 2 TzBfG misst Teilzeit an der vergleichbaren Vollzeit). Es ist
 * ein Vorschlag im Formular, keine Prüfung. D-797, D-816.
 */
export const VOLLZEIT_AB_STUNDEN = 35;

export function istBeschaeftigungsart(wert: unknown): wert is Beschaeftigungsart {
  return typeof wert === 'string' && (BESCHAEFTIGUNGSARTEN as readonly string[]).includes(wert);
}

/**
 * Der Vorschlag aus den Wochenstunden — `null`, wenn keine angegeben sind.
 *
 * Nur Vollzeit oder Teilzeit: Minijob und Aushilfe stehen nicht in den
 * Stunden (siehe oben).
 */
export function vorschlagAusWochenstunden(stunden: number | null): Beschaeftigungsart | null {
  if (stunden === null || !Number.isFinite(stunden) || stunden <= 0) return null;
  return stunden >= VOLLZEIT_AB_STUNDEN ? 'vollzeit' : 'teilzeit';
}
