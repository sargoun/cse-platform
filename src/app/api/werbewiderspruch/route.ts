import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { withEingang } from '@/server/kontext/eingang';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { herkunft } from '@/app/auth/mitarbeiter/anmeldung';
import { ipHash, istBot } from '@/server/services/lead/annahme';
import {
  WiderspruchDrossel, WiderspruchFehler, erfasseOhneToken, loeseEin,
  mandantFuerToken,
} from '@/server/services/datenschutz/werbewiderspruch';

/**
 * `POST /api/werbewiderspruch` — der öffentliche Widerspruch gegen Werbung
 * (CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG).
 *
 * **Kein Konto, keine Anmeldung, kein Ursprungstest** — genau wie
 * `/api/datenschutz/anfrage`. Wer der Werbung widerspricht, ist per Definition
 * jemand, der mit dieser Plattform nichts zu tun haben will; ein
 * `istGleicherUrsprung`-Riegel sperrte den Weg für jeden, der den Link aus
 * einem E-Mail-Programm heraus öffnet — und das ist der Regelfall.
 *
 * **Zwei Wege, ein Ziel.** Mit Token: der Ein-Klick-Weg aus der Nachricht, und
 * der Token sagt selbst, welche Gesellschaft gemeint ist. Ohne Token: auf
 * E-Mail-Adresse, und die Gesellschaft steht im Formular — die vier sind
 * verschiedene juristische Personen, jede für ihre Werbung selbst
 * verantwortlich (dieselbe Begründung wie bei `/datenschutz/anfrage`).
 *
 * **Und der tokenlose Weg ist gebremst — das fehlte und war der Befund.**
 * 04-SEITENKARTE:653 verlangt für genau diese Adresse ein Ratenlimit. Er ist
 * öffentlich, unangemeldet und schreibt UNWIDERRUFLICH in fremde
 * CRM-Datensätze: `app.werbewiderspruch_formular` stempelt jeden
 * `ansprechpartner` und `kunde` der gewählten Gesellschaft, dessen Adresse
 * passt, und `kern.erzwinge_widerspruch()` wirft bei jedem Versuch, den
 * Stempel zu räumen. Wer Adressen kennt oder rät, stellte damit die
 * Werbeansprache fremder Kontakte dauerhaft und lautlos ab — und weil die
 * Antwort immer dieselbe ist, erfuhr niemand davon.
 *
 * Drei Riegel, dieselben wie bei `/api/karriere/bewerbung`:
 *
 *  1. **Honigtopf** (`webseite`): ein Feld, das ein Mensch nicht sieht und ein
 *     Formularausfüller-Bot ausfüllt. Er bekommt dieselbe Antwort wie alle,
 *     nur wird nichts geschrieben — ein sichtbares „abgelehnt" wäre der
 *     Hinweis, es nochmal ohne das Feld zu versuchen.
 *  2. **Ratenlimit je IP-Abdruck**, gezählt und geschrieben in DERSELBEN
 *     Transaktion (`app.werbewiderspruch_drossel`). Die rohe IP wird nie
 *     gespeichert, nur `SHA256(ip + CSE_IP_PFEFFER)`.
 *  3. Die Antwort auf das Limit ist **kein Fehler, sondern das Formular**
 *     (`?stand=zu_viele`). Eine Fehlerseite auf einem gesetzlichen Pflichtweg
 *     wäre ein Widerspruch, der nicht ankam.
 *
 * **Geschrieben wird über den EINGANGSPRINZIPAL**, der `formular.schreiben`
 * hält und kein Leserecht — und seit diesem Schritt prüft
 * `app.werbewiderspruch_formular` das auch selbst, statt es dem Aufrufer zu
 * glauben. Der Renderer daneben läuft mit `app.readonly = 'on'` und könnte
 * nichts speichern: eine Übernahme der Leseoberfläche liefert damit keinen
 * Schreibpfad (03-AUTH §14.3).
 *
 * **Die Antwort verrät nichts.** `erfasst`, `verbraucht`, `ungueltig`,
 * `unbekannt` und „Formular entgegengenommen" — nie, wie viele Kontakte zu
 * einer Adresse gefunden wurden. „Zu dieser Adresse haben wir 3 Kontakte" wäre
 * eine Auskunft über einen fremden Datenbestand an jeden, der eine Adresse
 * errät.
 *
 * **Was noch fehlt, und zwar sichtbar:** die Bestätigungsmail, die §2.4 für
 * den tokenlosen Weg nennt. Es ist kein Postausgang verbunden, und ein
 * simulierter Versand wäre schlimmer als keiner.
 * // TODO(client, O-649): Wer versendet die Bestätigung des tokenlosen Werbewiderspruchs, und was steht drin, wenn die Adresse im Bestand gar nicht vorkommt?
 */
export const dynamic = 'force-dynamic';

function ziel(anfrage: NextRequest, stand: string, token: string): NextResponse {
  const weg = token === ''
    ? `/werbewiderspruch?stand=${stand}`
    : `/werbewiderspruch/${encodeURIComponent(token)}?stand=${stand}`;
  return NextResponse.redirect(new URL(weg, anfrage.url), 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  let daten: FormData;
  try {
    daten = await anfrage.formData();
  } catch {
    return NextResponse.json({ ok: false, stand: 'unlesbar' }, { status: 400 });
  }

  const token = String(daten.get('token') ?? '');
  const email = String(daten.get('email') ?? '');
  const bereich = String(daten.get('bereich') ?? '');

  /*
   * Der Weg mit Token: die Gesellschaft kommt aus dem Token, nicht aus einem
   * Parameter der Adresse. Der Leseschritt laeuft ueber den Renderer
   * (`withOeffentlich`), weil er ohne Sitzung funktioniert — und er erfaehrt
   * nur, was der Inhaber des Tokens ohnehin weiss.
   *
   * **Kein Ratenlimit auf diesem Zweig, und das ist kein Vergessen.** Der
   * Token ist 32 Byte aus `randomBytes`; der bedingte Verbrauch in
   * `app.werbewiderspruch_einloesen` (K-09) ist die Grenze, und jeder
   * Fehlversuch zaehlt in `werbewiderspruch_token.versuche`. Eine Drossel
   * daneben traefe den Empfaenger, der zweimal klickt.
   */
  if (token !== '') {
    const mandantId = await (db().begin((tx: postgres.TransactionSql) =>
      withOeffentlich(tx, (kontext) => mandantFuerToken(kontext, token)),
    ) as Promise<string | null>);
    if (mandantId === null) return ziel(anfrage, 'unbekannt', token);

    const ergebnis = await (db().begin((tx: postgres.TransactionSql) =>
      withEingang(tx, mandantId, (kontext) => loeseEin(kontext, token)),
    ) as Promise<{ zustand: string }>);
    return ziel(anfrage, ergebnis.zustand, token);
  }

  /*
   * Der Honigtopf — VOR der Gesellschaftsaufloesung: ein Bot soll nicht einmal
   * erfahren, welche Slugs es gibt.
   */
  if (istBot(String(daten.get('webseite') ?? ''))) {
    return ziel(anfrage, 'entgegengenommen', '');
  }

  /* Der tokenlose Weg: Gesellschaft aus dem Formular, Adresse aus dem Feld. */
  const [gesellschaft] = await (db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, (kontext) => kontext.abfrage<{ id: string }>(
      `select id from mandant where slug = $1 and archiviert_am is null`, [bereich],
    ))) as Promise<readonly { id: string }[]>);
  if (gesellschaft === undefined) return ziel(anfrage, 'ohne_gesellschaft', '');

  /*
   * Der Abdruck der Herkunft, nie die Adresse selbst. Ohne `CSE_IP_PFEFFER`
   * gibt es keinen Hash — und dann laeuft der Pflichtweg OHNE Drossel weiter,
   * statt zu scheitern: § 7 Abs. 3 Nr. 4 UWG sagt „jederzeit", und eine
   * fehlende Umgebungsvariable ist kein Grund, einen Widerspruch abzuweisen.
   * Die Datenbank schreibt in diesem Fall eine Zeile mit dem Grund
   * `ohne_ip_abdruck`, damit es im Protokoll steht.
   */
  const { ip } = await herkunft(anfrage.headers);
  const pfeffer = process.env['CSE_IP_PFEFFER'] ?? '';
  const abdruck = ip !== null && pfeffer !== '' ? ipHash(ip, pfeffer) : null;

  try {
    await db().begin((tx: postgres.TransactionSql) =>
      withEingang(tx, gesellschaft.id, (kontext) =>
        erfasseOhneToken(kontext, email, abdruck)));
  } catch (fehler) {
    if (fehler instanceof WiderspruchDrossel) {
      return ziel(anfrage, 'zu_viele', '');
    }
    if (fehler instanceof WiderspruchFehler) {
      return ziel(anfrage, 'email_ungueltig', '');
    }
    throw fehler;
  }
  return ziel(anfrage, 'entgegengenommen', '');
}
