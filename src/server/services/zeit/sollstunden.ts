/**
 * Die Sollzeit eines Monats — als SCHNITTSTELLE, nicht als Formel (O-18, K-17).
 *
 * **Warum hier nichts gerechnet wird.** Die naheliegende Zeile ist
 * `wochenstunden / 5 * arbeitstage`, und sie sieht so harmlos aus, dass sie
 * in jedem zweiten Entwurf steht. Sie entscheidet aber vier Fragen, die
 * niemand gestellt hat: ob die Woche fuenf oder sechs Arbeitstage hat (§ 3
 * BUrlG rechnet mit sechs), ob ein gesetzlicher Feiertag Sollzeit senkt oder
 * als bezahlte Ausfallzeit gutgeschrieben wird (§ 2 Abs. 1 EntgFG), wie
 * Teilzeit auf Tage faellt, und ob ein Arbeitszeitkonto ueberhaupt gegen eine
 * Monatssollzeit rechnet oder gegen einen Durchschnitt ueber einen
 * Ausgleichszeitraum.
 *
 * Jede dieser Antworten aendert den SALDO, und der Saldo ist die Zahl, aus der
 * Ueberstundenzuschlaege, Freizeitausgleich und am Ende eine Lohnzeile werden.
 * Eine geratene Sollzeit faellt nicht auf: das Konto zeigt eine plausible
 * Zahl, jeden Monat, jahrelang.
 *
 * Deshalb liefert die ausgelieferte Regel `null` — „nicht hinterlegt" — und
 * `sollMinutenOderFehler` wirft, statt etwas zurueckzugeben. Ein Aufrufer, der
 * die Sollzeit BRAUCHT, bekommt eine Meldung; ein Aufrufer, der das Konto nur
 * fuehrt, kommt ohne sie aus (`stundenkonto.soll_minuten` bleibt 0, und 0
 * heisst dort ausdruecklich „nicht hinterlegt", nicht „nichts geschuldet").
 *
 * Sobald die Antwort da ist, wird eine zweite Umsetzung dieser Schnittstelle
 * eingesetzt — an EINER Stelle, nicht an dreissig.
 */
import type { MilliMenge } from '../finanz/menge.js';

/** Woraus eine Sollzeitregel ihre Antwort zieht. */
export interface SollstundenEingabe {
  readonly anstellungId: string;
  readonly jahr: number;
  /** 1–12, der BERLINER Kalendermonat (K-11). */
  readonly monat: number;
  /** Vertragliche Wochenstunden in Tausendsteln, oder `null`. */
  readonly wochenstunden: MilliMenge | null;
  /** Das Arbeitszeitmodell der Beschaeftigung (PLATZHALTER-Vokabular, O-18). */
  readonly arbeitszeitmodell: string;
}

export interface SollstundenRegel {
  /** Nur zum Wiedererkennen in einer Meldung — nie eine Verzweigung darauf. */
  readonly schluessel: string;
  /** Die Sollzeit in ganzen Minuten, oder `null`, wenn die Regel offen ist. */
  sollMinuten(eingabe: SollstundenEingabe): number | null;
}

export class SollstundenOffenFehler extends Error {
  readonly code = 'nicht_konfiguriert';
  readonly status = 409;
  constructor(eingabe: SollstundenEingabe) {
    super(
      `Die Sollzeit fuer ${String(eingabe.jahr)}-${String(eingabe.monat).padStart(2, '0')} `
      + 'ist nicht hinterlegt (O-18).',
    );
    this.name = 'SollstundenOffenFehler';
  }
}

/**
 * Die ausgelieferte Regel: sie antwortet nicht.
 *
 * // TODO(client, O-18): Arbeitszeitmodelle, Sollstundenherleitung,
 * Urlaubsanspruch, Uebertragung und Ueberstundenverfall je Entitaet/Tarif?
 * Konkret: Wie viele Arbeitstage hat die Woche, senkt ein Feiertag die
 * Sollzeit oder wird er gutgeschrieben, und rechnet das Konto gegen den
 * Monat oder gegen einen Ausgleichszeitraum?
 */
export const SOLLSTUNDEN_OFFEN: SollstundenRegel = {
  schluessel: 'offen',
  sollMinuten(): number | null {
    return null;
  },
};

/**
 * Die Sollzeit — oder eine Meldung.
 *
 * Bewusst kein `?? 0`: eine Null waere eine Antwort, und zwar die
 * gefaehrlichste von allen. `saldo = vortrag + ist - soll` machte damit jede
 * geleistete Minute zur Ueberstunde.
 */
export function sollMinutenOderFehler(
  regel: SollstundenRegel,
  eingabe: SollstundenEingabe,
): number {
  const minuten = regel.sollMinuten(eingabe);
  if (minuten === null) throw new SollstundenOffenFehler(eingabe);
  if (!Number.isInteger(minuten) || minuten < 0) {
    throw new SollstundenOffenFehler(eingabe);
  }
  return minuten;
}
