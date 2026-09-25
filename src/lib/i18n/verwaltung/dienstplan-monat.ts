/**
 * Die Wörter der Monatsansicht des Dienstplans — in beiden Sprachen (TIM-01,
 * TIM-04, V-186, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text** — wie in
 * `dienstplan-schicht.ts`. Der Name eines Feiertags kommt fertig aus
 * `dienstplan/daten.ts` und wird nicht übersetzt: er ist der Name, den das
 * Land ihm gibt. Die Tagesbeschriftung („Mo 04.01." / „Sun 04 Jan") schreibt
 * die Monatsseite mit `tagKurz` (`@/lib/datum/kalendertag`, V-193).
 */
import { INTERN_BCP47, type InternSprache } from '../intern.js';

export interface MonatTexte {
  readonly titel: string;
  /** „12 Schichten" — die Zahl in der Schreibweise der Sprache. */
  readonly schichten: (anzahl: number) => string;
  readonly keineSchicht: string;
  readonly feiertag: (name: string) => string;
  /**
   * Der Verweis unter einer vollen Karte (V-186): wie viele fehlen und dass
   * die Tagesansicht ALLE zeigt — TIM-04 „none hidden".
   */
  readonly weitere: (verborgen: number, gesamt: number) => string;
  readonly ansichtWechseln: string;
  readonly wochenansicht: string;
  readonly nichtsGeplant: string;
  /** Vor und nach dem Namen des fehlenden Rechts (`<Recht>`, nie der Schlüssel). */
  readonly abwesenheitNichtGeprueftVor: string;
  readonly abwesenheitNichtGeprueftNach: string;
  readonly heisstNicht: string;
}

function zahl(sprache: InternSprache, n: number): string {
  return new Intl.NumberFormat(INTERN_BCP47[sprache]).format(n);
}

export const MONAT_TEXTE: Readonly<Record<InternSprache, MonatTexte>> = {
  de: {
    titel: 'Dienstplan — Monat',
    schichten: (n) => `${zahl('de', n)} ${n === 1 ? 'Schicht' : 'Schichten'}`,
    keineSchicht: 'keine Schicht',
    feiertag: (name) => `Feiertag: ${name}`,
    weitere: (verborgen, gesamt) =>
      `und ${zahl('de', verborgen)} weitere — alle ${zahl('de', gesamt)} in der Tagesansicht`,
    ansichtWechseln: 'Ansicht wechseln',
    wochenansicht: 'Wochenansicht',
    nichtsGeplant: 'In diesem Monat ist nichts geplant.',
    abwesenheitNichtGeprueftVor: 'Abwesenheiten werden hier nicht geprüft — dafür fehlt das Recht',
    abwesenheitNichtGeprueftNach: '.',
    heisstNicht: 'Das heißt nicht, dass niemand abgemeldet ist.',
  },
  en: {
    titel: 'Dienstplan (roster) — month',
    schichten: (n) => `${zahl('en', n)} ${n === 1 ? 'shift' : 'shifts'}`,
    keineSchicht: 'no shift',
    feiertag: (name) => `Public holiday: ${name}`,
    weitere: (verborgen, gesamt) =>
      `and ${zahl('en', verborgen)} more — all ${zahl('en', gesamt)} in the day view`,
    ansichtWechseln: 'Change view',
    wochenansicht: 'Week view',
    nichtsGeplant: 'Nothing is planned this month.',
    abwesenheitNichtGeprueftVor: 'Absences are not checked here — this needs the permission',
    abwesenheitNichtGeprueftNach: '.',
    heisstNicht: 'This does not mean that nobody is absent.',
  },
};
