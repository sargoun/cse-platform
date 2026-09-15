import 'server-only';

/**
 * Der Postausgang — als Anschluss, nicht als Behauptung.
 *
 * Genau der Aufbau von `server/auth/sms.ts`, und aus demselben Grund: ein
 * Dienst, der `true` zurueckgibt, ohne zu senden, laesst jeden Bildschirm
 * funktionsfaehig aussehen und faellt erst dem ersten Menschen auf, der auf
 * eine Mail wartet, die nie kam.
 *
 * `verbunden` und `zeigtInhalt` sind ZWEI Zusagen, nicht eine. Der
 * Entwicklungsdienst zeigt den Link auf dem Bildschirm dessen, der ihn
 * angefordert hat — das ist auf einer Entwicklungsflaeche richtig und in einer
 * Auslieferung ohne Anbieter eine offene Tuer: wer eine fremde Adresse
 * eintippt, laese sonst deren Zuruecksetzungslink.
 */

export interface EmailAuftrag {
  readonly an: string;
  readonly betreff: string;
  readonly text: string;
}

export class EmailNichtVerbundenFehler extends Error {
  constructor() {
    super(
      'Es ist kein Postausgang verbunden (O-501). Die Nachricht wurde NICHT versendet. '
      + 'Offen: welcher in der EU gehostete Anbieter mit AV-Vertrag, welche Absenderadresse '
      + 'je Gesellschaft, und ob DKIM/DMARC ueber die bestehenden Domains laufen.',
    );
    this.name = 'EmailNichtVerbundenFehler';
  }
}

export interface EmailDienst {
  readonly verbunden: boolean;
  /** Ob der Inhalt dem Anfordernden auf dem Bildschirm gezeigt werden darf. */
  readonly zeigtInhalt: boolean;
  readonly name: string;
  sende(auftrag: EmailAuftrag): Promise<void>;
}

export class NichtVerbundenerEmailDienst implements EmailDienst {
  readonly verbunden = false;
  readonly zeigtInhalt = false;
  readonly name = 'nicht verbunden';

  sende(auftrag: EmailAuftrag): Promise<void> {
    void auftrag;
    return Promise.reject(new EmailNichtVerbundenFehler());
  }
}

export class EntwicklungsEmailDienst implements EmailDienst {
  readonly verbunden = false;
  readonly zeigtInhalt = true;
  readonly name = 'Entwicklungsfläche (kein Versand)';

  sende(auftrag: EmailAuftrag): Promise<void> {
    void auftrag;
    return Promise.resolve();
  }
}

export function emailDienst(devFlaechen: boolean): EmailDienst {
  return devFlaechen ? new EntwicklungsEmailDienst() : new NichtVerbundenerEmailDienst();
}
