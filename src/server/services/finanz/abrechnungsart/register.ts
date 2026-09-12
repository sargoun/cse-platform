/**
 * Das Register der Abrechnungsarten — die eine Stelle, an der eine sechste
 * hinzukommt (FIN-01, O-04).
 *
 * **Warum ein Register und nicht fuenf Verzweigungen.** Die naheliegende
 * Fassung ist ein `switch` im Rechnungsdienst. Sie funktioniert genau so lange,
 * bis die Antwort auf O-04 lautet „es sind sechs" oder „die dritte heisst
 * anders" — dann sind es nicht eine, sondern mehrere Stellen, und die eine,
 * die jemand uebersieht, ist die, die still den falschen Betrag rechnet.
 *
 * Hier kostet eine sechste Art: EINEN Aufzaehlungswert (`alter type … add
 * value`), EINE Klasse und EINE Zeile `registriere(...)`. `rechnung.ts` wird
 * nicht angefasst — Abnahme (5), und der Beweis dafuer ist ein Testdoppel, das
 * sich registriert und durch dieselbe Erzeugung laeuft.
 *
 * Das Register ist BEWUSST veraenderbar und bewusst NICHT auf die fuenf
 * Schluessel getippt. Ein `Record<AbrechnungsartSchluessel, …>` verlangte fuer
 * eine sechste Art eine Typaenderung — also genau die Aenderung, die dieser
 * Aufbau vermeiden soll.
 */
import { type Abrechnungsart, AbrechnungFehler } from './typen.js';

const REGISTER = new Map<string, Abrechnungsart>();

/**
 * Eine Abrechnungsart eintragen.
 *
 * Ein zweiter Eintrag unter demselben Schluessel wirft, statt zu ueberschreiben:
 * zwei Umsetzungen fuer eine Art sind zwei Betraege fuer eine Leistung, und
 * welcher gewinnt, entschiede die Ladereihenfolge der Module.
 */
export function registriere(art: Abrechnungsart): void {
  const vorhanden = REGISTER.get(art.schluessel);
  if (vorhanden !== undefined && vorhanden !== art) {
    throw new AbrechnungFehler(
      `Die Abrechnungsart „${art.schluessel}" ist bereits registriert `
      + `(${vorhanden.bezeichnung}).`,
      'unbekannte_abrechnungsart',
    );
  }
  REGISTER.set(art.schluessel, art);
}

/** Einen Eintrag wieder entfernen — fuer Testdoppel. */
export function entferne(schluessel: string): void {
  REGISTER.delete(schluessel);
}

/**
 * Die Umsetzung zu einem Schluessel — oder ein getippter Fehler.
 *
 * Kein Rueckfall auf eine „Standardart". Ein Vorgabewert an dieser Stelle
 * rechnete eine Rechnung nach einer Regel, die im Vertrag nicht steht, und die
 * Rechnung ist einen Augenblick spaeter festgeschrieben und unveraenderlich.
 */
export function hole(schluessel: string): Abrechnungsart {
  const art = REGISTER.get(schluessel);
  if (art === undefined) {
    throw new AbrechnungFehler(
      `Fuer die Abrechnungsart „${schluessel}" ist keine Umsetzung registriert.`,
      'unbekannte_abrechnungsart',
    );
  }
  return art;
}

/** Alle registrierten Arten, nach Schluessel geordnet — die Oberflaeche liest sie. */
export function alleAbrechnungsarten(): readonly Abrechnungsart[] {
  return [...REGISTER.values()].sort((a, b) => (a.schluessel < b.schluessel ? -1 : 1));
}

export function istRegistriert(schluessel: string): boolean {
  return REGISTER.has(schluessel);
}
