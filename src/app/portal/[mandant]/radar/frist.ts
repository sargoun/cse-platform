/**
 * Die Abgabefrist in Worten und in Farbe — **eine Stelle, nicht zwei**
 * (RAD-06, DESIGN §9).
 *
 * **Warum die Grenze hier steht.** Fünf Tage nennt RAD-06 selbst, und SPEC
 * §14 wiederholt sie: unter fünf Tagen ist eine Bekanntmachung praktisch
 * nicht mehr zu bieten, weil Unterlagen, Rückfragen und — bei fehlender
 * Freischaltung — die Registrierung länger brauchen. Die Zahl stand in
 * `radar/page.tsx`; mit der Statusseite hätte sie ein zweites Mal
 * dortgestanden, und zwei Abschriften einer Schwelle laufen auseinander.
 * Geprüft wird sie in `tests/kern/radar-frist.test.ts`.
 *
 * **Die Farbe trägt die Bedeutung nicht allein** (DESIGN §9): die Zahl steht
 * immer daneben, und `fristText` sagt sie in Worten.
 */

/** RAD-06: ab hier ist die Abgabe knapp. Nicht erfunden — die Spec nennt sie. */
export const KNAPP_TAGE = 5;

/** Die zweite, weichere Stufe: noch Zeit, aber schon in Sicht. */
export const BALD_TAGE = 14;

export function fristKlasse(rest: number | null): string {
  if (rest === null) return 'text-text-subtle';
  if (rest < 0) return 'text-text-subtle';
  if (rest < KNAPP_TAGE) return 'text-danger font-semibold';
  if (rest < BALD_TAGE) return 'text-warning';
  return 'text-text-muted';
}

export function fristText(rest: number | null): string {
  if (rest === null) return 'keine Frist genannt';
  if (rest < 0) return 'Frist abgelaufen';
  if (rest === 0) return 'heute';
  if (rest === 1) return 'noch 1 Tag';
  return `noch ${String(rest)} Tage`;
}

/** Ist die Abgabe nach RAD-06 knapp? `null` und Vergangenheit sind es nicht. */
export function istKnapp(rest: number | null): boolean {
  return rest !== null && rest >= 0 && rest < KNAPP_TAGE;
}
