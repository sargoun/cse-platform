/**
 * Beschriftungskarten — ein Datenbankwert als Wort, in beiden internen
 * Sprachen (V-228, V-231, V-232, D-722, D-725, D-726).
 *
 * **Der Befund** (Audit Befunde 57, 61, 68): an vielen Stellen stand ein
 * Enum-Schlüssel mit Unterstrich im sichtbaren Text — `email_senden`,
 * `interner_hinweis`, `in_arbeit`, `nicht_erschienen` —, obwohl dieselbe
 * Anwendung ein paar Dateien weiter eine Karte dafür hatte. Die Karte stand
 * in der Seite, auf der sie zuerst gebraucht wurde, und die zweite Seite
 * kannte sie nicht.
 *
 * **Deshalb stehen die Karten hier, je Fachbereich eine Datei**, und jede
 * Seite, die denselben Wert zeigt, holt dasselbe Wort. Eine Karte ist
 * `Record<InternSprache, Record<Schlüssel, Wort>>`: deutsch und englisch
 * vollständig, geprüft in `tests/kern/beschriftung.test.ts`.
 *
 * **Ein unbekannter Wert wird lesbar, nicht roh.** Kommt ein Wert, den die
 * Karte (noch) nicht kennt — ein neuer Enum-Wert aus einer Migration —, zeigt
 * `beschriftung` ihn mit Leerzeichen statt Unterstrichen, damit er gelesen und
 * nachgetragen wird, statt als Quelltext dazustehen. Nachgeschlagen wird nur
 * ein EIGENER Eintrag (`eigenerEintrag`, D-728): `toString` ist kein Stand.
 */
import { eigenerEintrag } from '../../nachschlagen.js';
import type { InternSprache } from '../intern.js';

export type Karte<K extends string = string> =
  Readonly<Record<InternSprache, Readonly<Record<K, string>>>>;

/** `nicht_erschienen` → „nicht erschienen" — der Rückfall für einen unbekannten Wert. */
export function lesbar(wert: string): string {
  return wert.replace(/[_]+/gu, ' ').trim();
}

/**
 * Das Wort für einen Wert, in der Sprache der Seite. Eine Seite, die nur
 * deutsch spricht (Ausnahmeliste der Übersetzungswache), ruft ohne Sprache.
 */
export function beschriftung<K extends string>(
  karte: Karte<K>, wert: string | null | undefined, sprache?: string | null,
): string {
  if (wert === null || wert === undefined || wert === '') return '—';
  const s: InternSprache = sprache === 'en' ? 'en' : 'de';
  return eigenerEintrag<string>(karte[s], wert) ?? lesbar(wert);
}
