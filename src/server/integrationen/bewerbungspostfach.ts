/**
 * Das Bewerbungspostfach als Anschluss — der Vertrag und sein einziger
 * Adapter heute (REC-03, V-224, D-718).
 *
 * **Der Anschluss als Vertrag, nicht als Zusage** (CLAUDE.md, „No fake
 * integrations"). Welches Postfach, welcher Anbieter, in welcher Region und
 * unter welchem Vertrag, ist nicht entschieden (O-938); wer triagiert und ob
 * die Plattform nach der Übernahme im Postfach löschen darf, ist O-117. Der
 * Adapter liefert keine Nachricht und behauptet keine.
 *
 * Hier und nicht im Recruiting-Dienst, damit das Register der Anbindungen
 * (`registry/integrationen.ts`) den Zustand aus demselben Adapter liest, der
 * die Verbindung auch benutzen würde — wie beim Speicher und beim Wetter.
 */

/** Eine Nachricht aus dem Postfach — so, wie ein Anschluss sie liefern würde. */
export interface PostfachNachricht {
  readonly absenderName: string;
  readonly absenderEmail: string;
  readonly betreff: string;
  readonly text: string;
}

export interface BewerbungsPostfach {
  readonly verbunden: boolean;
  /** Warum nicht verbunden — dieser Satz steht so auf dem Bildschirm. */
  readonly hinweis: string;
  /** Die offene Frage, die den Anschluss klärt. */
  readonly offen: string;
  holeNeue(): Promise<readonly PostfachNachricht[]>;
}

export class PostfachNichtVerbundenFehler extends Error {
  constructor() {
    super('Das Bewerbungspostfach ist nicht verbunden — es wird nichts abgeholt (O-938).');
    this.name = 'PostfachNichtVerbundenFehler';
  }
}

/**
 * Der einzige Adapter heute. Er liefert nichts und wirft beim Abholen — ein
 * Adapter, der eine leere Liste zurückgäbe, sähe aus wie ein Postfach ohne
 * Post, und das ist eine andere Aussage als „nicht angeschlossen".
 */
export class NichtVerbundenesPostfach implements BewerbungsPostfach {
  readonly verbunden = false;
  readonly hinweis = 'Kein Postfach angeschlossen: welches Postfach, welcher Anbieter, in welcher '
    + 'Region und unter welchem Vertrag, ist nicht entschieden. Bewerbungen, die per E-Mail '
    + 'kommen, überträgt ein Mensch unter Recruiting › Bewerbungen › Aus dem Postfach erfassen.';
  readonly offen = 'O-938';
  holeNeue(): Promise<readonly PostfachNachricht[]> {
    return Promise.reject(new PostfachNichtVerbundenFehler());
  }
}

/** Welcher Anschluss gilt — an EINER Stelle entschieden, wie beim Speicher. */
// TODO(client, O-938): Welches Postfach (Adresse, Anbieter, Region, Auftragsverarbeitungsvertrag)
// nimmt Bewerbungen an, und darf die Plattform eine übernommene Nachricht dort löschen?
export function bewerbungsPostfach(): BewerbungsPostfach {
  return new NichtVerbundenesPostfach();
}
