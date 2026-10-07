/**
 * Das Bewerbungspostfach als Anschluss — der Vertrag und sein einziger
 * Adapter heute (REC-03, V-224, D-718).
 *
 * **Der Anschluss als Vertrag, nicht als Zusage** (CLAUDE.md, „No fake
 * integrations"). Postfach, Anbieter, Region und Vertrag trägt der Betreiber
 * ein (O-938, O-28). Voreinstellung (O-938, O-117, D-797): wer überträgt,
 * wählt die Gesellschaft, und nach der Übernahme wird die Nachricht im
 * Postfach gelöscht — heute von Hand, weil kein Postfach verbunden ist. Der
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
  readonly hinweis = 'Nicht verbunden — Postfach, Anbieter, Region und Vertrag trägt der '
    + 'Betreiber ein. Bewerbungen, die per E-Mail kommen, überträgt ein Mensch unter Recruiting › '
    + 'Bewerbungen › Aus dem Postfach erfassen und löscht die Nachricht danach im Postfach.';
  readonly offen = 'O-938';
  holeNeue(): Promise<readonly PostfachNachricht[]> {
    return Promise.reject(new PostfachNichtVerbundenFehler());
  }
}

/** Welcher Anschluss gilt — an EINER Stelle entschieden, wie beim Speicher. */
// TODO(client, O-938): Postfach, Anbieter, Region und Auftragsverarbeitungsvertrag trägt der
// Betreiber ein; Voreinstellung (D-797): nach der Übernahme wird die Nachricht dort gelöscht.
export function bewerbungsPostfach(): BewerbungsPostfach {
  return new NichtVerbundenesPostfach();
}
