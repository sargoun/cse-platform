import { eigenerEintrag } from '../nachschlagen.js';

/**
 * Welcher Bereich welches Formular hat — an EINER Stelle.
 *
 * Die Zuordnung stand in drei Dateien: in der Seite, in der Annahmeroute und
 * im Seed. Drei Kopien heissen, dass ein vierter Bereich in zweien landet und
 * in der dritten fehlt — und der Fehler zeigt sich als 404 auf einem Formular,
 * das es laut Datenbank gibt.
 */
export const FORMULAR_SCHLUESSEL: Readonly<Record<string, string>> = {
  reinigung: 'angebot_reinigung',
  security: 'angebot_security',
  bau: 'angebot_bau',
  operations: 'angebot_operations',
};

/**
 * Der Formularschlüssel eines Bereichs — nur ein EIGENER Eintrag (D-728;
 * Nachrunde zu V-272).
 *
 * **Der Befund.** Hier stand `FORMULAR_SCHLUESSEL[bereich]`, und `bereich`
 * kommt aus der Adresse (`/angebot/[bereich]`, `…/danke`) oder aus dem
 * Formular (`POST /api/anfrage`). `toString`, `constructor` und `__proto__`
 * fanden damit eine Funktion bzw. `Object.prototype` statt `undefined` und
 * galten als bekannter Bereich: Seite und Route fragten die Datenbank nach
 * einem Formular mit dem Schlüssel „function Object() { [native code] }"
 * (so macht der Treiber einen solchen Wert zum Text), und
 * `/angebot/__proto__/danke?nr=…` bestätigte eine Anfrage, die es nie geben
 * konnte.
 */
export function formularSchluessel(bereich: string): string | undefined {
  return eigenerEintrag(FORMULAR_SCHLUESSEL, bereich);
}

/**
 * Der Pfad des Angebotsformulars — als Muster, an EINER Stelle.
 *
 * Er stand als Zeichenkette in der Route, in der Hülle und im Test. Drei
 * Kopien einer Adresse sind drei Gelegenheiten, sie an zwei Stellen zu ändern:
 * `04-SEITENKARTE.md` schrieb `/angebot/[bereich]`, die Anwendung lieferte
 * `/anfrage/[bereich]`, und niemandem fiel es auf, weil beide für sich
 * funktionierten.
 */
export const ANGEBOT_PFAD = '/angebot/[bereich]';

export function angebotPfad(bereich: string): string {
  return `/angebot/${bereich}`;
}
