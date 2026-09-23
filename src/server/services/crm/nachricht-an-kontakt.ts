import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import {
  gate, nutzlastHash, type Nutzlast, type Rechtsgrundlage,
} from '../../agent/policy.js';
import { erteileFreigabe } from '../freigabe/erteilen.js';
import {
  sendeNachAussen, versandwege, VersandNichtVerbundenFehler,
} from '../kern/nachricht.js';

/**
 * **Eine Nachricht an einen Kontakt — durch das UWG-Tor und die
 * Freigabekette** (V-101, CRM-08, Invariante 7, D-621).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `sendeNachAussen` war gebaut und geprüft — Kanal, Zweck, Kontakt, das
 * UWG-Tor in der Datenbank, der Pflichthinweis nach § 7 Abs. 3 Nr. 4 UWG —,
 * und keine Route rief es. Das Kontaktblatt sagte es selbst: „Es gibt hier
 * keinen Sendeknopf. Der Endpunkt `POST /api/crm/nachrichten` ist nicht
 * gebaut." Das Recht dazu, `crm.kommunikation_versenden`, stand seit `0008`
 * im Katalog und wurde von keiner einzigen Route benutzt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Reihenfolge ist die ganze Sicherheit, und jeder Schritt hat einen
 * Grund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. **Das UWG-Tor ZUERST** (`app.darf_kontaktiert_werden`). Ein Kontakt
 *      ohne Rechtsgrundlage für Werbung ist ein „nein", das kein Anbieter und
 *      keine Freigabe aufhebt (LEG-08). Wer es erst nach „nicht verbunden"
 *      erführe, hielte die Werbemail für einen Konfigurationsfehler — und
 *      schickte sie ab, sobald der Anbieter da ist.
 *   2. **Dann der Versender.** Ist keiner verbunden (O-36), geht nichts
 *      hinaus, und es wird NICHTS geschrieben — weder eine Freigabe noch eine
 *      Nachricht. Eine Zeile „gesendet" ohne Versand wäre eine falsche
 *      Behauptung in einem Nachweis, den eine Abmahnung liest.
 *   3. **Dann die Freigabe des Verfassers** (Invariante 7). Der Mensch, der
 *      schreibt und auf „Senden" drückt, gibt die Nachricht BENANNT frei; die
 *      Freigabe trägt den Abdruck genau dieses Textes (`policy.nutzlastHash`)
 *      und steht in der Kette. Wer danach ein Wort ändert, hat keine
 *      Freigabe mehr für das, was hinausginge.
 *   4. **Dann `gate()`** — dieselbe eine Entscheidung wie überall, mit der
 *      eben erteilten Freigabe.
 *   5. **Dann `sendeNachAussen`**, das Werbung selbst mit dem Pflichthinweis
 *      versieht und den Widerspruchsschlüssel vermerkt (V-092).
 *
 * Schritte 3–5 laufen in EINER Transaktion: scheitert der Versand, nimmt er
 * die Freigabe mit. Eine Freigabe für eine Nachricht, die es nicht gibt, wäre
 * ein Glied in der Kette, das nichts bezeugt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Kein Vier-Augen-Zwang — und das ist entschieden, nicht vergessen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Plattform hat diese Frage in `0123` beantwortet: Vier Augen sind eine
 * EINSTELLUNG, kein CHECK — in einem Büro aus zwei Menschen sperrte eine
 * Regel `freigegeben_von <> erstellt_von` jede Aussendung ohne Ausweg.
 * `crm.kommunikation_versenden` und `freigabe.entscheiden` sind im Katalog an
 * DIESELBEN drei Rollen gebunden (super_admin, admin, leitung) und nicht
 * weiter bindbar: wer schreiben darf, darf auch benannt freigeben.
 */

export class NachrichtFehler extends Error {
  constructor(
    readonly nachricht: string,
    readonly grund: 'kein_kontakt' | 'keine_grundlage' | 'nicht_verbunden'
      | 'kein_text' | 'ungueltig',
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'NachrichtFehler';
  }
}

export type Kanal = 'email' | 'sms';
export type Zweck = 'vertraglich' | 'transaktional' | 'werbung';

export const KANAELE: readonly Kanal[] = ['email', 'sms'];
export const ZWECKE: readonly Zweck[] = ['vertraglich', 'transaktional', 'werbung'];

export interface NachrichtAnKontakt {
  readonly ansprechpartnerId: string;
  readonly kanal: Kanal;
  readonly zweck: Zweck;
  readonly betreff: string | null;
  readonly text: string;
}

/**
 * Die Nutzlast des Tores — genau die Felder, die der Hash der Freigabe bindet.
 *
 * Getrennt und exportiert, damit sich prüfen lässt, dass ein geändertes Wort
 * einen anderen Abdruck ergibt — ohne Datenbank.
 */
export function nachrichtNutzlast(
  mandantId: string, grundlage: Rechtsgrundlage, e: NachrichtAnKontakt,
): Nutzlast {
  return {
    aktion: 'email_senden',
    mandantId,
    empfaengerRechtsgrundlage: grundlage,
    inhalt: {
      ansprechpartnerId: e.ansprechpartnerId,
      kanal: e.kanal,
      zweck: e.zweck,
      betreff: e.betreff ?? '',
      text: e.text,
    },
  };
}

/**
 * Ist der Kanal verbunden? — ohne Datenbank, aus der Anbindungsliste.
 *
 * Die Seite fragt dasselbe, um den Knopf gar nicht erst scharf zu stellen;
 * der Dienst fragt es noch einmal, weil ein Formular das ist, was ankommt,
 * nicht das, was ausgeliefert wurde.
 */
export function kanalVerbunden(kanal: Kanal): boolean {
  return versandwege().find((w) => w.kanal === kanal)?.verbunden === true;
}

export async function schreibeAnKontakt(
  kontext: SchreibKontext, e: NachrichtAnKontakt,
): Promise<string> {
  if (!KANAELE.includes(e.kanal) || !ZWECKE.includes(e.zweck)) {
    throw new NachrichtFehler('Kanal oder Zweck ist unbekannt.', 'ungueltig');
  }
  if (e.text.trim() === '') {
    throw new NachrichtFehler('Eine Nachricht ohne Text ist keine.', 'kein_text');
  }

  /* 1 — das Tor. Und dabei die Frage, ob es den Kontakt HIER gibt (AUT-06). */
  const [tor] = await kontext.abfrage<{ darf: boolean | null; grundlage: string | null }>(
    `select app.darf_kontaktiert_werden(ap.id, $2, $3) as darf,
            app.rechtsgrundlage_von(ap.id, app.aktiver_mandant())::text as grundlage
       from ansprechpartner ap
      where ap.id = $1::uuid and ap.archiviert_am is null`,
    [e.ansprechpartnerId, e.kanal, e.zweck]);
  if (tor === undefined) {
    throw new NachrichtFehler('Diesen Kontakt gibt es hier nicht.', 'kein_kontakt', 404);
  }
  if (tor.darf !== true) {
    throw new NachrichtFehler(
      'Für diesen Kontakt, diesen Kanal und diesen Zweck ist keine Rechtsgrundlage '
      + 'aufgezeichnet (§ 7 UWG, LEG-08). Das ist ein hartes Tor — auch eine Freigabe '
      + 'hebt es nicht auf.', 'keine_grundlage', 409);
  }

  /* 2 — der Versender. Nicht verbunden: NICHTS wird geschrieben. */
  if (!kanalVerbunden(e.kanal)) {
    throw new NachrichtFehler(
      'Für diesen Kanal ist kein Versender verbunden (O-36). Es wurde nichts '
      + 'geschrieben und nichts gesendet.', 'nicht_verbunden', 503);
  }

  /* istanbul ignore next — erreichbar, sobald ein Versender verbunden ist. */
  const grundlage = (tor.grundlage ?? 'keine') as Rechtsgrundlage;
  /* istanbul ignore next */
  const nutzlast = nachrichtNutzlast(kontext.aktiverMandantId, grundlage, e);

  /* 3 — die benannte Freigabe des Verfassers, mit dem Abdruck DIESES Textes. */
  /* istanbul ignore next */
  const freigabeId = await erteileFreigabe(kontext, {
    aktion: 'email_senden',
    inhalt: nutzlast.inhalt,
    begruendung: 'Vom Verfasser geschrieben und zum Versand freigegeben.',
    abdruck: nutzlastHash(nutzlast),
  });

  /* 4 — die eine Entscheidung. */
  /* istanbul ignore next */
  const ergebnis = gate(nutzlast, {
    id: freigabeId, aktion: 'email_senden', mandantId: kontext.aktiverMandantId,
    status: 'genehmigt', freigegebenVon: kontext.benutzerId,
    nutzlastHash: nutzlastHash(nutzlast),
  }, null);
  /* istanbul ignore next */
  if (!ergebnis.erlaubt) throw ergebnis.fehler;

  /* 5 — der eine Weg nach draussen. */
  /* istanbul ignore next */
  try {
    return await sendeNachAussen(kontext, {
      betreff: e.betreff, koerper: e.text, kanal: e.kanal, zweck: e.zweck,
      ansprechpartnerId: e.ansprechpartnerId, freigabeId,
    });
  } catch (fehler: unknown) {
    if (fehler instanceof VersandNichtVerbundenFehler) {
      throw new NachrichtFehler(fehler.message, 'nicht_verbunden', 503);
    }
    throw fehler;
  }
}
