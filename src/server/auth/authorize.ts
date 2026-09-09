/**
 * `authorize(akteur, aktion, ressource)` — das eine Tor vor jedem Route
 * Handler und jeder Server Action (AUT-04, SEC-A1).
 *
 * Zwei Verteidigungslinien, nie eine (AUT-05):
 *
 *  1. **Hier**, in der Anwendung: das Recht wird geprüft, bevor eine Abfrage
 *     überhaupt läuft. Das ist die Linie, die eine *benannte* Antwort erzeugt.
 *  2. **RLS**, in der Datenbank: dieselbe Frage noch einmal, unabhängig. Das
 *     ist die Linie, die hält, wenn Linie 1 vergessen wurde.
 *
 * Die zweite ersetzt die erste nicht: RLS liefert null Zeilen, und null Zeilen
 * sind von "gibt es nicht" ununterscheidbar — richtig für den Angreifer,
 * nutzlos für den Entwickler, der wissen will, warum sein Bildschirm leer ist.
 */
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler } from './fehler.js';

export type Scope = 'mandant' | 'gruppe' | 'person' | 'kunde';
export type Portal = 'intern' | 'mitarbeiter' | 'kunde';

/** Was `app.sitzung_aufloesen` zurückgibt, in TypeScript. */
export interface Akteur {
  readonly benutzerId: string;
  readonly personId: string | null;
  readonly aktiverMandantId: string | null;
  readonly ansicht: Scope;
  readonly aal: 'aal1' | 'aal2';
  readonly portal: Portal;
  readonly sitzungId: string;
}

/** Woran das Recht geprüft wird. */
export interface Ressource {
  /** Der Rechteschlüssel, `<modul>.<aktion>` (K-19). */
  readonly recht: string;
  /**
   * Der Bereich, dem die Ressource gehört. Fehlt er, gilt der aktive Mandant.
   * Ein Wert, der NICHT der aktive ist, ist ein Fremdzugriff — und dessen
   * Antwort ist 404.
   */
  readonly mandantId?: string | null;
  /** Erzwingt `aal2` unabhängig vom Katalog (AUT-02). */
  readonly erfordert2fa?: boolean;
  /** Schreibende Aktion: in Gruppen- und Nur-Lese-Ansicht verboten. */
  readonly schreibend?: boolean;
}

/** Die Rechteprüfung gegen die Datenbank — dieselbe Funktion, die RLS nutzt. */
export interface RechtePruefer {
  hatRecht(schluessel: string, mandantId: string | null): Promise<boolean>;
}

/**
 * Wirft, oder gibt den Akteur zurück.
 *
 * Die Reihenfolge ist Absicht: was **nichts** über die Ressource verrät, wird
 * zuerst geprüft. Ein nicht angemeldeter Aufrufer bekommt 401, bevor
 * irgendetwas anderes ausgewertet wird — sonst könnte er aus der Verzögerung
 * lesen, wie weit er gekommen ist.
 */
export async function authorize(
  akteur: Akteur | null,
  ressource: Ressource,
  pruefer: RechtePruefer,
): Promise<Akteur> {
  if (akteur === null) throw new NichtAngemeldetFehler();

  if (ressource.erfordert2fa === true && akteur.aal !== 'aal2') {
    // 403 und nicht 404: die Existenz des eigenen Kontos ist dem Aufrufer
    // ohnehin bekannt, und ein 404 hier hiesse "melde dich neu an" statt
    // "zeig den zweiten Faktor".
    throw new ZweiterFaktorFehler();
  }

  // Invariante 10: kein Schreibpfad ohne genau einen aktiven Mandanten.
  if (ressource.schreibend === true
      && (akteur.ansicht !== 'mandant' || akteur.aktiverMandantId === null)) {
    throw new NichtGefundenFehler('Schreibzugriff ohne genau einen aktiven Mandanten');
  }

  // Fremder Bereich. Der `[mandant]`-Pfadabschnitt ist Routing und wird gegen
  // die SITZUNG geprüft, nie umgekehrt (K-02, invariant 3) — und die Antwort
  // ist 404, weil ein 403 bestätigt, dass es den Bereich gibt (AUT-06).
  const ziel = ressource.mandantId ?? akteur.aktiverMandantId;
  if (ziel !== null && ziel !== undefined
      && akteur.ansicht === 'mandant' && ziel !== akteur.aktiverMandantId) {
    throw new NichtGefundenFehler(`Fremder Mandant ${ziel}`);
  }

  if (!(await pruefer.hatRecht(ressource.recht, ziel ?? null))) {
    // Auch hier 404. Ein fehlendes Recht ist von aussen nicht von einem
    // fehlenden Datensatz zu unterscheiden — und genau das soll es sein.
    throw new NichtGefundenFehler(`Recht ${ressource.recht} fehlt`);
  }

  return akteur;
}
