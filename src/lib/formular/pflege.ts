/**
 * Die Regeln der Formularpflege — **als reine Funktionen, ohne Datenbank.**
 *
 * Kein `server-only`: hier steht kein Zugriff, nur eine Regel. Der Dienst
 * (`services/inhalt/formular.ts`) fragt sie, die Pflegeseite fragt sie fuer
 * ihre Knoepfe, und beide bekommen dieselbe Antwort. Dieselbe Trennung wie in
 * `services/social/weg.ts`: eine Oberflaeche, die einen Knopf zeigt, den der
 * Dienst abweist, ist ein Fehlerbericht mit Verzoegerung.
 *
 * **Warum die drei Zustaende nicht in der Tabelle stehen.**
 * `formular_definition` fuehrt zwei Zeitpunkte — `veroeffentlicht_am` und
 * `zurueckgezogen_am` — und kein Statusfeld. Das ist richtig: ein drittes
 * Feld koennte den beiden widersprechen, und dann waere eine Definition
 * „live" ohne Veroeffentlichungszeitpunkt. Der Zustand ist deshalb eine
 * ABLEITUNG, und sie steht genau einmal hier.
 */

export type FormularZustand = 'entwurf' | 'live' | 'zurueckgezogen';

export const ZUSTAND_TEXT: Readonly<Record<FormularZustand, string>> = {
  entwurf: 'Entwurf',
  live: 'Live',
  zurueckgezogen: 'Zurückgezogen',
};

/**
 * Entwurf, live oder zurueckgezogen — aus den zwei Zeitpunkten.
 *
 * **Die Reihenfolge der Fragen ist die Regel.** `zurueckgezogen_am` schlaegt
 * `veroeffentlicht_am`, denn `erzwinge_serverzeit_veroeffentlichung` friert
 * den Veroeffentlichungszeitpunkt ein: eine zurueckgezogene Definition
 * BEHAELT ihn. Wer zuerst nach `veroeffentlicht_am` fragte, bekaeme fuer jede
 * zurueckgezogene Version „live" — und die Liste zeigte vier lebende
 * Formulare, wo eines lebt.
 *
 * Ein Rueckzug ohne Veroeffentlichung ist kein Zustand, den die Tabelle
 * kennt (ein Entwurf wird geloescht oder ueberschrieben, nicht
 * zurueckgezogen). Er wird hier trotzdem als `zurueckgezogen` gelesen und
 * nicht als Entwurf: was ein Zeitpunkt behauptet, wird nicht wegargumentiert.
 */
export function formularZustand(
  veroeffentlichtAm: string | null, zurueckgezogenAm: string | null,
): FormularZustand {
  if (zurueckgezogenAm !== null) return 'zurueckgezogen';
  return veroeffentlichtAm !== null ? 'live' : 'entwurf';
}

/**
 * Darf diese Version noch in ihren Feldern geaendert werden?
 *
 * `kern.formular_definition_unveraenderlich` weist `felder`,
 * `datenschutz_hinweis_version`, `schluessel` und `version` ab, sobald
 * `veroeffentlicht_am` steht. Titel und Beschreibung bleiben aenderbar — ein
 * Schreibfehler in der Ueberschrift ist kein Grund fuer eine neue Version,
 * denn `formular_eingang` zeigt per FK auf die VERSION und nicht auf ihren
 * Titel.
 */
export function felderEingefroren(zustand: FormularZustand): boolean {
  return zustand !== 'entwurf';
}

/** Die naechste Versionsnummer eines Schluessels. */
export function naechsteVersion(vorhandene: readonly number[]): number {
  return vorhandene.reduce((hoechste, v) => (v > hoechste ? v : hoechste), 0) + 1;
}

/**
 * Die Reaktionszeit, wie sie auf dem Bildschirm steht.
 *
 * **Warum nicht „noch nicht festgelegt".** `formular_zustaendigkeit.sla_stunden`
 * ist nullable (D-75), aber gepflegt: der Erstbestand traegt je Formular 24
 * Stunden, absichtlich als ZEILE und nicht als Spalten-DEFAULT. Wer darueber
 * „noch nicht festgelegt" schreibt, verschweigt einen gepflegten Wert — und
 * wer die 24 ohne Zusatz hinschreibt, behauptet eine Frist, die niemand
 * vereinbart hat. Offen ist nach O-14 nicht die ZAHL, sondern ob sie in
 * Kalender- oder Werktagsstunden zaehlt und wann sie an einem Freitagabend
 * anlaeuft.
 *
 * Der Nullfall bleibt: ein Formular ohne Zustaendigkeitszeile hat keine
 * Frist, und dann steht das da.
 */
export function reaktionszeitText(slaStunden: number | null): string {
  if (slaStunden === null) return 'offen (O-14)';
  return `${String(slaStunden)} Stunden — vorläufig (O-14)`;
}
