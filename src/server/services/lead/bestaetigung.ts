/**
 * Die Eingangsbestaetigung an den Anfragenden (REQ-01, Invariante 7).
 *
 * **Sie geht durch dasselbe Tor wie alles andere.** Eine
 * Eingangsbestaetigung fuehlt sich harmlos an — sie ist eine Antwort auf eine
 * Anfrage, kein Werbebrief. Genau deshalb waere sie die naheliegende Stelle
 * fuer eine Ausnahme, und eine Ausnahme im Tor ist kein Tor mehr. Sie wird
 * hier also als Nutzlast gebaut, durch `gate()` geschickt und als `versand`
 * protokolliert; ein Repo-Waechter bricht den Build, wenn irgendein Modul
 * ausserhalb von `server/versand` einen Mailtransport importiert.
 *
 * **Automatisch erlaubt ist sie nur, wenn eine Richtlinie es sagt.** Das Tor
 * ist fail-closed: ohne `agent_richtlinie`-Zeile fuer `email_senden` verlangt
 * es eine menschliche Freigabe, und die Bestaetigung bleibt liegen. Das ist
 * die richtige Vorgabe — lieber keine Bestaetigung als eine automatische Mail,
 * die niemand vorgesehen hat.
 *
 * **Der Zweck ist `transaktional`.** § 7 UWG trennt Antwort und Werbung: eine
 * Bestaetigung auf eine eigene Anfrage ist keine elektronische Werbung, ein
 * angehaengtes "unsere weiteren Leistungen" waere es. Deshalb steht in dieser
 * Nutzlast nichts als die Bestaetigung.
 */
import { randomUUID } from 'node:crypto';
import { gate, nutzlastHash, type Freigabe, type Nutzlast, type Richtlinie }
  from '../../agent/policy.js';

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface BestaetigungEingabe {
  readonly mandantId: string;
  readonly empfaenger: string;
  readonly firma: string;
  readonly leadnummer: string;
  readonly slaFristAm: Date | null;
}

export interface BestaetigungErgebnis {
  readonly gesendet: boolean;
  readonly versandId: string | null;
  readonly grund: string;
}

/**
 * Das Datum, wie der Empfänger es liest — in Europe/Berlin.
 *
 * `toISOString().slice(0, 10)` hätte den UTC-Tag genommen. Eine Frist, die um
 * 00:30 Berliner Zeit abläuft, stünde damit als der VORTAG in der Mail: der
 * Kunde liest eine Zusage, die einen Tag zu früh klingt, und im Sommer geht es
 * um zwei Stunden Abstand statt einer. Invariante 2: gespeichert UTC,
 * angezeigt Europe/Berlin.
 */
function berlinDatum(zeitpunkt: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(zeitpunkt);
}

/** Die Nutzlast — genau die Felder, die der Hash der Freigabe bindet. */
export function bestaetigungNutzlast(e: BestaetigungEingabe): Nutzlast {
  return {
    aktion: 'email_senden',
    mandantId: e.mandantId,
    // CRM-08: eine Anfrage IST die Rechtsgrundlage für die Antwort darauf.
    empfaengerRechtsgrundlage: 'vertrag',
    inhalt: {
      zweck: 'eingangsbestaetigung',
      empfaenger: e.empfaenger,
      leadnummer: e.leadnummer,
      betreff: `Ihre Anfrage ${e.leadnummer}`,
      text: `Guten Tag,\n\nwir haben Ihre Anfrage erhalten und melden uns`
        + (e.slaFristAm === null
          ? ' so bald wie möglich bei Ihnen.'
          : ` bis zum ${berlinDatum(e.slaFristAm)} bei Ihnen.`)
        + `\n\nIhre Vorgangsnummer lautet ${e.leadnummer}.\n\n`
        + `Mit freundlichen Grüßen\n${e.firma}`,
    },
  };
}

/**
 * Legt die Bestaetigung an — nach dem Tor, nie daran vorbei.
 *
 * Es wird IMMER eine `versand`-Zeile geschrieben, auch wenn nichts rausgeht:
 * `gesendet_am` bleibt NULL und `ergebnis` sagt warum. Ein verweigerter
 * Versand, der keine Spur hinterlaesst, ist ein verweigerter Versand, den
 * niemand findet.
 */
export async function bestaetige(
  db: Abfrage,
  eingabe: BestaetigungEingabe,
  freigabe: Freigabe | null,
  richtlinie: Richtlinie | null,
): Promise<BestaetigungErgebnis> {
  const nutzlast = bestaetigungNutzlast(eingabe);
  const hash = nutzlastHash(nutzlast);
  const ergebnis = gate(nutzlast, freigabe, richtlinie);

  // Kein `RETURNING`: es verlangte `versand.lesen`, und der Eingangsprinzipal
  // haelt es nicht — er soll keine fremden Versandbelege lesen koennen.
  const versandId = randomUUID();
  await db.unsafe(
    // `gesendet_am` kommt aus `now()` und nicht aus der Uhr dieses Prozesses
    // (Invariante 5): der Zeitpunkt eines Versands gehört dem Server.
    `insert into versand (id, mandant_id, freigabe_id, aktion, kanal, empfaenger,
                          nutzlast_hash, gesendet_am, ergebnis)
     values ($1, $2, $3, 'email_senden', 'email', $4, $5,
             case when $6 then now() else null end, $7)`,
    [
      versandId,
      eingabe.mandantId, freigabe?.id ?? null, eingabe.empfaenger, hash,
      ergebnis.erlaubt,
      ergebnis.erlaubt ? `gesendet (${ergebnis.grund})` : ergebnis.fehler.message,
    ],
  );

  return {
    gesendet: ergebnis.erlaubt,
    versandId,
    grund: ergebnis.erlaubt ? ergebnis.grund : ergebnis.fehler.message,
  };
}
