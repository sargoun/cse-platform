import 'server-only';

/**
 * Der Weg, auf dem ein Einmalcode das Haus verlaesst — und er ist NICHT
 * verbunden (O-82, CLAUDE.md „no fake integrations").
 *
 * **Was hier steht und was ausdruecklich nicht.** Die Schnittstelle ist
 * vollstaendig: ein Anbieter bekommt eine Nummer in E.164 und einen fertigen
 * Text, und er sagt, ob er ihn angenommen hat. Was fehlt, ist der Anbieter —
 * und das ist keine Luecke, sondern eine offene Frage mit Folgen:
 *
 *   **O-82** — welches in der EU gehostete SMS-Gateway stellt den Code und den
 *   Check-in-Link zu (AV-Vertrag, D-04), und ab welchem Monatsbetrag gilt ein
 *   harter Stopp?
 *
 * Beide Haelften sind bindend. Ein Gateway ausserhalb der EU traegt
 * Telefonnummern von Beschaeftigten dreier deutscher Gesellschaften in ein
 * Drittland, und ein Dienst ohne Ausgabendeckel ist bei einem Code, den jeder
 * Unbekannte anfordern kann, ein offenes Portemonnaie.
 *
 * **Warum kein „Demo-Versand".** Ein Anbieter, der `true` zurueckgibt, ohne
 * etwas zu senden, ist die teuerste Sorte Platzhalter: die Anmeldung sieht
 * funktionsfaehig aus, niemand bekommt eine SMS, und der Fehler faellt erst
 * dem ersten echten Mitarbeiter auf — der dann annimmt, ER habe etwas falsch
 * gemacht. `NichtVerbundenerSmsDienst` sagt stattdessen laut, was ist.
 */

export interface SmsAuftrag {
  /** E.164, vom Aufrufer normalisiert — `+491701234567`. */
  readonly an: string;
  readonly text: string;
}

export class SmsNichtVerbundenFehler extends Error {
  constructor() {
    super(
      'Es ist kein SMS-Dienst verbunden (O-82). Der Code wurde NICHT versendet. '
      + 'Offen: welches EU-gehostete Gateway mit AV-Vertrag, und welcher '
      + 'monatliche Ausgabendeckel loest einen harten Stopp aus?',
    );
    this.name = 'SmsNichtVerbundenFehler';
  }
}

export interface SmsDienst {
  /** Ob ueberhaupt versendet werden kann — die Oberflaeche fragt das. */
  readonly verbunden: boolean;
  /** Der Name fuer die Anzeige — nie erfunden. */
  readonly name: string;
  sende(auftrag: SmsAuftrag): Promise<void>;
}

/**
 * Der Dienst, den es gibt, solange O-82 offen ist.
 *
 * Er wirft. Er gibt nicht `false` zurueck und schreibt keine Warnung ins Log:
 * ein Aufrufer, der ein `false` uebersieht, meldet dem Menschen vor dem
 * Telefon „Code gesendet". Eine Ausnahme laesst sich nicht uebersehen.
 */
export class NichtVerbundenerSmsDienst implements SmsDienst {
  readonly verbunden = false;
  readonly name = 'nicht verbunden';

  /*
   * `Promise.reject` und kein `async throw`: die Ausnahme ist der ganze
   * Zweck dieser Klasse, und ein `async`, das nie wartet, laedt nur zu der
   * Frage ein, worauf es denn wartet.
   */
  sende(auftrag: SmsAuftrag): Promise<void> {
    void auftrag;
    return Promise.reject(new SmsNichtVerbundenFehler());
  }
}

/**
 * Der Dienst der Entwicklungsflaechen — er SENDET NICHTS und sagt das.
 *
 * **Und er ist nicht der Platzhalter fuer Produktion.** Er existiert, damit
 * die Anmeldung ohne Gateway geprueft werden kann: der Code landet im
 * Rueckgabewert des Anforderns und damit auf dem Bildschirm dessen, der ihn
 * angefordert hat — sichtbar als das, was er ist. `verbunden` bleibt `false`,
 * weil nichts verbunden IST; die Oberflaeche zeigt deshalb auch hier „nicht
 * verbunden" und nicht etwa „gesendet".
 *
 * Er greift nur, wenn `CSE_DEV_FLAECHEN` gesetzt ist — dieselbe Schranke wie
 * bei `devSitzungAusstellen`. In einem Produktionsbau gibt es ihn nicht.
 */
export class EntwicklungsSmsDienst implements SmsDienst {
  readonly verbunden = false;
  readonly name = 'Entwicklungsfläche (kein Versand)';

  sende(auftrag: SmsAuftrag): Promise<void> {
    // Kein `console.log` des Codes: ein Log ist eine Datei, die jemand liest.
    // Der Code erreicht den Anfordernden ueber den Rueckgabewert, nicht hier.
    void auftrag;
    return Promise.resolve();
  }
}

/**
 * Welcher Dienst gilt — eine Stelle, nicht je Aufrufer entschieden.
 *
 * Die Umgebungsvariable, die ein echtes Gateway benennen wuerde, gibt es
 * noch nicht: sie kommt mit der Antwort auf O-82. Bis dahin sind es zwei
 * Faelle, und beide sind ehrlich.
 */
export function smsDienst(devFlaechen: boolean): SmsDienst {
  return devFlaechen ? new EntwicklungsSmsDienst() : new NichtVerbundenerSmsDienst();
}
