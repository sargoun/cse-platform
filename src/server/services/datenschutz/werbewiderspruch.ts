/**
 * **Der Werbewiderspruch und der Widerspruch gegen die Verarbeitung**
 * (CRM-08, LEG-08, § 7 UWG, Art. 21 DSGVO).
 *
 * **Zwei Widersprüche, zwei Spalten, zwei Wirkungen — und ein Blatt, das sie
 * nicht vermischt.** `04-SEITENKARTE.md` §2.4 trennt sie ausdrücklich:
 *
 *  - **Werbewiderspruch** (`werbewiderspruch_am`) sperrt `zweck = 'werbung'`.
 *    Rechnungen (FIN-11) und alles andere mit `zweck = 'vertraglich'` laufen
 *    weiter: Kommunikation zur Durchführung des Vertrags ruht auf Art. 6
 *    Abs. 1 lit. b und lässt sich nicht wegwidersprechen. Leistungsnachweis
 *    (CLN-04), Terminbestätigung und Mahnung (FIN-15) sind dagegen als
 *    `zweck = 'transaktional'` geführt, und `app.darf_kontaktiert_werden`
 *    weist die bis zur Entscheidung von O-65 ebenfalls ab — der restriktive
 *    Zweig, nachgemessen im Funktionsrumpf und nicht angenommen.
 *  - **Widerspruch nach Art. 21** (`widerspruch_am`) zwingt über
 *    `kern.erzwinge_widerspruch()` `rechtsgrundlage = 'keine'` — der seltenere,
 *    stärkere Fall.
 *
 * Ein Blatt, das beides in eine Spalte legt, lädt dazu ein, einem Kunden
 * versehentlich die Rechnungen abzustellen. Deshalb zwei Listen.
 *
 * **Beide Spalten sind schreibbar-einmal und nicht räumbar.** Der Auslöser aus
 * `0020` wirft, wenn jemand sie auf NULL setzt — sie zurückzunehmen ist keine
 * Datenpflege, sondern das Löschen eines Beweises. Die Oberfläche hat deshalb
 * keinen Zurücknehmen-Knopf und sagt, warum.
 *
 * **Der Leseweg ist ein Definer, und das ist kein Umweg.** `cse_app` hat auf
 * `ansprechpartner.werbewiderspruch_am`, `.widerspruch_am` und
 * `.rechtsgrundlage` nur INSERT und UPDATE, kein SELECT (K-05-Block in 0020,
 * nachgemessen in `information_schema.column_privileges`). Der Hauptfall — der
 * Widerspruch eines KONTAKTS — ist aus der Anwendung heraus gar nicht
 * listbar. `app.werbewiderspruch_liste()` (0222) ist die eine mengenwertige
 * Form: ein Abruf, EINE Protokollzeile.
 */
import { createHash, randomBytes } from 'node:crypto';
import { kanonischeBasis } from '../../../lib/domains.js';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export class WiderspruchFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'WiderspruchFehler';
  }
}

/**
 * Zu viele tokenlose Widersprüche von derselben Verbindung.
 *
 * **Eine eigene Klasse und kein `WiderspruchFehler` mit anderem Grund**: der
 * Pflichtweg des § 7 UWG darf darauf keine Fehlerseite zeigen, sondern muss
 * auf dasselbe Formular mit einer Erklärung zurückführen. Zwei verschiedene
 * Antworten brauchen zwei verschiedene Fehler, sonst entscheidet ein
 * Zeichenkettenvergleich über eine gesetzliche Zusage.
 */
export class WiderspruchDrossel extends Error {
  readonly grund = 'zu_viele' as const;
  readonly status = 429 as const;
  constructor() {
    super('Zu viele Widerspruchsversuche von dieser Verbindung.');
    this.name = 'WiderspruchDrossel';
  }
}

/** Die fünf Kanäle des Hauses — dieselben wie `einwilligung_kanaele` (0020). */
export const KANAELE = ['email', 'telefon', 'sms', 'post', 'whatsapp'] as const;
export type Kanal = (typeof KANAELE)[number];

export type WiderspruchArt = 'werbung' | 'verarbeitung';
export type WiderspruchQuelle = 'token' | 'formular' | 'manuell';

export const ART_TEXT: Readonly<Record<WiderspruchArt, string>> = {
  werbung: 'Werbewiderspruch (§ 7 UWG)',
  verarbeitung: 'Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)',
};

export const ART_WIRKUNG: Readonly<Record<WiderspruchArt, string>> = {
  /*
   * **Der Satz sagt jetzt, was die Datenbank tut — nicht, was naheliegt.**
   *
   * Hier stand, Leistungsnachweise, Terminbestätigungen und Mahnungen liefen
   * weiter. Das gilt für `zweck = 'vertraglich'`. Genau diese drei sind aber
   * als `zweck = 'transaktional'` geführt (0020), und
   * `app.darf_kontaktiert_werden` weist `transaktional` bei gesetztem
   * `werbewiderspruch_am` ab — bewusst, als restriktiver Zweig zu O-65. Drei
   * Abschnitte tiefer sagte derselbe Bildschirm im O-65-Punkt das Gegenteil.
   */
  werbung:
    'Sperrt jede Nachricht mit zweck = „werbung“. Rechnungen und andere '
    + 'vertraglich notwendige Post (zweck = „vertraglich“) laufen weiter — sie '
    + 'ruhen auf Art. 6 Abs. 1 lit. b und sind nicht widersprechlich. '
    + 'Terminbestätigung, Leistungsnachweis und Mahnung sind als '
    + '„transaktional“ geführt und werden bis zur Entscheidung von O-65 '
    + 'ebenfalls abgewiesen: im Zweifel der restriktive Zweig, sichtbar statt '
    + 'still.',
  verarbeitung:
    'Zwingt rechtsgrundlage = „keine“ und löscht Quelle, Erfassungszeitpunkt '
    + 'und Einwilligungskanäle. Damit endet jede werbliche Verarbeitung; '
    + 'Aufbewahrungspflichten bleiben.',
};

export const QUELLE_TEXT: Readonly<Record<WiderspruchQuelle, string>> = {
  token: 'Ein-Klick-Link aus einer Werbenachricht',
  formular: 'öffentliches Formular, ohne Token, auf E-Mail-Adresse',
  manuell: 'von einem Menschen erfasst (Telefon, Brief, im Vorgang)',
};

/* =========================================================================
 * Der Token (K-08, K-09)
 * ========================================================================= */

/**
 * Ein neuer Token: Klartext für den Link, Abdruck für die Datenbank.
 *
 * **Der Klartext verlässt diese Funktion und kommt nie zurück** (K-08). Was in
 * `werbewiderspruch_token` steht, ist der SHA-256; ein gespeicherter
 * Klartext-Token wäre ein Schlüssel, mit dem sich der Widerspruch eines
 * fremden Kontakts erklären liesse — und die Tabelle, in der er stünde, ist
 * genau die, die eine Aufsicht liest.
 *
 * 32 Byte, base64url: kurz genug für eine E-Mail-Zeile, lang genug, dass
 * Raten keine Strategie ist.
 */
export function neuerToken(): { readonly klartext: string; readonly hash: string } {
  const klartext = randomBytes(32).toString('base64url');
  return { klartext, hash: tokenHash(klartext) };
}

export function tokenHash(klartext: string): string {
  return createHash('sha256').update(klartext, 'utf8').digest('hex');
}

/**
 * Den Pflichtlink zu einer ausgehenden Werbenachricht ausgeben.
 *
 * `§ 7 Abs. 3 Nr. 4 UWG`: jede Werbemail muss den klaren Hinweis tragen, dass
 * der Empfänger der Verwendung jederzeit widersprechen kann. Dieser Link ist
 * dieser Hinweis in ausführbarer Form — und deshalb hängt das Recht am
 * Senderecht (`crm.kommunikation_versenden`) und nicht an einem eigenen: ein
 * eigenes Recht wäre eines, das man dem Sendeweg anschliessend zusätzlich
 * gibt, und ohne das er das Gesetz verletzt.
 */
export async function gibTokenAus(
  kontext: SchreibKontext,
  z: {
    readonly ansprechpartnerId: string;
    readonly kundeId?: string | null;
    readonly kanal: Kanal;
    readonly nachrichtId?: string | null;
  },
): Promise<{ readonly id: string; readonly klartext: string }> {
  const { klartext, hash } = neuerToken();
  const id = await vermerkeToken(kontext, z, hash);
  return { id, klartext };
}

/**
 * Den AUSGEGEBENEN Token vermerken — die zweite Hälfte von `gibTokenAus`.
 *
 * **Warum die beiden Hälften einzeln erreichbar sind** (V-092, V-115). Der
 * Token gehört in den TEXT der Nachricht, und die Nachricht muss es schon
 * geben, bevor der Vermerk sie nennen kann: `werbewiderspruch_token.nachricht_id`
 * trägt einen Fremdschlüssel auf `nachricht`. Die Reihenfolge ist also
 * zwingend Klartext → Text bauen → Nachricht schreiben → Vermerk. Ein
 * `gibTokenAus`, das beides in einem Zug tut, kann in dieser Reihenfolge nicht
 * benutzt werden, ohne die Nachricht nachträglich umzuschreiben — und eine
 * ausgehende Nachricht wird nicht umgeschrieben.
 *
 * Gespeichert wird der SHA-256, nie der Token (K-08): wer die Tabelle liest,
 * kann keinen fremden Widerspruch einlösen.
 */
export async function vermerkeToken(
  kontext: SchreibKontext,
  z: {
    readonly ansprechpartnerId: string;
    readonly kundeId?: string | null;
    readonly kanal: Kanal;
    readonly nachrichtId?: string | null;
  },
  hash: string,
): Promise<string> {
  if (!(KANAELE as readonly string[]).includes(z.kanal)) {
    throw new WiderspruchFehler(
      `Kein Kanal dieses Hauses: „${z.kanal}".`, 'kanal_unbekannt');
  }
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `select app.werbewiderspruch_token_ausgeben($1::uuid, $2::uuid, $3, $4::uuid, $5)
              as id`,
    [z.ansprechpartnerId, z.kundeId ?? null, z.kanal, z.nachrichtId ?? null, hash]);
  if (zeile === undefined) {
    throw new WiderspruchFehler(
      'Der Widerspruchslink konnte nicht ausgegeben werden. Eine Werbenachricht '
      + 'ohne ihn darf nicht hinausgehen (§ 7 Abs. 3 Nr. 4 UWG).',
      'kein_token', 500);
  }
  return zeile.id;
}

/** Der Pfad, der in die Nachricht geschrieben wird. */
export function tokenPfad(klartext: string): string {
  return `/werbewiderspruch/${encodeURIComponent(klartext)}`;
}

/**
 * **Der Pflichthinweis des § 7 Abs. 3 Nr. 4 UWG, an den Text gehängt**
 * (V-092, V-115).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `gibTokenAus` war gebaut, geprüft und hatte im ganzen Baum **keinen
 * Aufrufer**. Der Widerspruchsweg existierte vollständig — die öffentliche
 * Seite, die Einlösung, die Drossel, das Protokoll —, und der Schlüssel dazu
 * entstand nirgends. Solange kein Versender verbunden ist (O-36), fällt das
 * nicht auf; in der Sekunde, in der einer verbunden wird, ginge eine
 * Werbemail ohne den gesetzlich vorgeschriebenen Hinweis hinaus.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was das Gesetz verlangt — und was hier deshalb steht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * § 7 Abs. 3 Nr. 4 UWG erlaubt Direktwerbung an Bestandskunden nur, wenn
 * „der Kunde bei Erhebung der Adresse und bei jeder Verwendung klar und
 * deutlich darauf hingewiesen wird, dass er der Verwendung jederzeit
 * widersprechen kann, ohne dass hierfür andere als die Übermittlungskosten
 * nach den Basistarifen entstehen". **Bei JEDER Verwendung** — also in jeder
 * einzelnen Nachricht, nicht einmal im Impressum.
 *
 * Der Satz unten ist dieser Hinweis, und der Link ist er in ausführbarer
 * Form. Beides ist kein Textvorschlag, den jemand kürzen darf: die beiden
 * Bestandteile (jederzeitiger Widerspruch, keine Kosten über den Basistarif)
 * stehen wörtlich im Gesetz.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Ohne absolute Adresse geht gar nichts.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kanonischeBasis()` wirft ohne `CSE_KANONISCHE_BASIS`, und das ist hier die
 * richtige Antwort: `/werbewiderspruch/…` in einer E-Mail ist kein Link,
 * sondern eine Zeichenkette. Eine Werbemail mit einem unklickbaren Hinweis
 * erfüllt den Absatz nicht — sie darf dann nicht hinausgehen.
 */
export function mitPflichthinweis(koerper: string, klartext: string): string {
  const basis = kanonischeBasis();
  return `${koerper}\n\n—\n`
    + 'Sie können der Verwendung Ihrer Adresse für Werbung jederzeit '
    + 'widersprechen, ohne dass für Sie andere als die Übermittlungskosten nach '
    + 'den Basistarifen entstehen (§ 7 Abs. 3 Nr. 4 UWG):\n'
    + `${basis}${tokenPfad(klartext)}`;
}

/* =========================================================================
 * Einlösen — der öffentliche Weg
 * ========================================================================= */

export type Einloesung =
  /** Der Widerspruch ist neu erfasst. */
  | { readonly zustand: 'erfasst'; readonly kanal: string | null;
      readonly kontakt: string | null }
  /** Schon eingelöst — der zweite Klick. §2.4: das ist kein Fehler. */
  | { readonly zustand: 'verbraucht' }
  /**
   * Der Token existiert, ist aber widerrufen oder abgelaufen und wurde NIE
   * eingelöst. Der Widerspruch ist damit NICHT erfasst — und genau das muss
   * die Seite sagen, statt „ist bereits erfasst" zu behaupten.
   */
  | { readonly zustand: 'ungueltig' }
  /** Diesen Token gibt es nicht. */
  | { readonly zustand: 'unbekannt' };

/**
 * Welche Gesellschaft gehört zu diesem Token?
 *
 * Der öffentliche Weg hat keine Sitzung; der Eingangsprinzipal muss aber an
 * EINE Gesellschaft gebunden sein, bevor er schreiben kann (K-03). Welche es
 * ist, sagt der Token — nicht ein Parameter der Adresse.
 */
export async function mandantFuerToken(
  kontext: LeseKontext, klartext: string,
): Promise<string | null> {
  const [z] = await kontext.abfrage<{ id: string | null }>(
    `select app.werbewiderspruch_token_mandant($1) as id`, [tokenHash(klartext)]);
  return z?.id ?? null;
}

/**
 * Den Token einlösen — bedingter Schreibvorgang (K-09), idempotent.
 *
 * `04-SEITENKARTE.md` §2.4: „a second click on the same link says 'already
 * recorded', never an error". Null Zeilen sind hier deshalb NICHT der 409,
 * sondern die Antwort `verbraucht`. Eine Fehlerseite auf dem Pflichtweg des
 * § 7 UWG wäre ein Widerspruch, der nicht ankam — und der Empfänger hat den
 * Beweis in der Hand, dass er geklickt hat.
 *
 * **`ungueltig` ist der vierte Zustand und keine Feinheit.** Ein widerrufener
 * oder abgelaufener Token, der nie eingelöst wurde, gab vorher dieselbe
 * Antwort wie der zweite Klick — die Seite sagte „ist bereits erfasst" für
 * einen Widerspruch, der nicht erfasst war.
 */
export async function loeseEin(
  kontext: SchreibKontext, klartext: string,
): Promise<Einloesung> {
  const [z] = await kontext.schreibe<{
    zustand: string; kanal: string | null; kontakt: string | null;
  }>(`select zustand, kanal, kontakt from app.werbewiderspruch_einloesen($1)`,
    [tokenHash(klartext)]);
  if (z === undefined || z.zustand === 'unbekannt') return { zustand: 'unbekannt' };
  if (z.zustand === 'verbraucht') return { zustand: 'verbraucht' };
  if (z.zustand === 'ungueltig') return { zustand: 'ungueltig' };
  return { zustand: 'erfasst', kanal: z.kanal, kontakt: z.kontakt };
}

/**
 * Der tokenlose Weg: auf E-Mail-Adresse, in EINER Gesellschaft.
 *
 * §2.4: „The tokenless form exists because a forwarded message is not a reason
 * to make objection impossible; it matches on e-mail address."
 *
 * **Die Trefferzahl geht nicht an den Absender zurück.** „Zu dieser Adresse
 * haben wir 3 Kontakte" wäre eine Auskunft über einen fremden Datenbestand an
 * jeden, der eine Adresse errät. Die Zahl steht im Protokoll; die Antwort ist
 * immer dieselbe.
 */
export async function erfasseOhneToken(
  kontext: SchreibKontext, email: string, ipAbdruck: string | null,
): Promise<void> {
  const sauber = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/iu.test(sauber)) {
    throw new WiderspruchFehler(
      'Bitte prüfen Sie die E-Mail-Adresse.', 'email_ungueltig');
  }
  try {
    await kontext.schreibe(
      `select app.werbewiderspruch_formular($1, $2)`, [sauber, ipAbdruck]);
  } catch (fehler: unknown) {
    /*
     * `54000` ist das Ratenlimit aus `app.werbewiderspruch_drossel`. Es kommt
     * als Datenbankfehler und nicht als Rückgabewert, weil Zählung und
     * Schreiben in DERSELBEN Transaktion laufen müssen — getrennt liesse ein
     * Ansturm beliebig viele Widersprüche zwischen beiden durch.
     */
    if ((fehler as { code?: string } | null)?.code === '54000') {
      throw new WiderspruchDrossel();
    }
    throw fehler;
  }
}

/* =========================================================================
 * Art. 21 — im Vorgang entschieden
 * ========================================================================= */

/**
 * Den Widerspruch gegen die Verarbeitung setzen — einmalig und unwiderruflich.
 *
 * Entschieden wird er auf `/portal/[mandant]/datenschutz/[id]` (§2.4), und das
 * Tor dieser Route ist `datenschutz.auskunft_erstellen`. Genau dieses Recht
 * prüft die Datenbankfunktion — nicht `crm.schreiben`: verlangte sie das, wäre
 * die Zusage der Seitenkarte für eine Datenschutzbeauftragte ohne
 * CRM-Schreibrecht unerreichbar.
 *
 * **Unwiderruflich steht in der Datenbank, nicht in dieser Datei.**
 * `kern.erzwinge_widerspruch()` (0020) zwingt `rechtsgrundlage = 'keine'`,
 * nullt Quelle, Erfassungszeitpunkt und Einwilligungskanäle und wirft bei
 * jedem Versuch, den Widerspruch zurückzunehmen.
 */
export async function setzeVerarbeitungswiderspruch(
  kontext: SchreibKontext,
  z: {
    readonly ansprechpartnerId?: string | null;
    readonly kundeId?: string | null;
    readonly bemerkung: string;
  },
): Promise<void> {
  if ((z.ansprechpartnerId ?? null) === null && (z.kundeId ?? null) === null) {
    throw new WiderspruchFehler(
      'Ohne zugeordneten Kontakt oder Kunden gibt es keinen Widerspruch. '
      + 'Ordnen Sie den Vorgang zuerst zu.', 'ohne_betroffenen');
  }
  if (z.bemerkung.trim() === '') {
    throw new WiderspruchFehler(
      'Ein Widerspruch nach Art. 21 wird begründet festgehalten — er ist '
      + 'unwiderruflich, und der Grund ist das, was eine Aufsicht liest.',
      'ohne_begruendung');
  }
  await kontext.schreibe(
    `select app.widerspruch_verarbeitung_setzen($1::uuid, $2::uuid, $3)`,
    [z.ansprechpartnerId ?? null, z.kundeId ?? null, z.bemerkung.trim()]);
}

/* =========================================================================
 * Lesen — das Nachweisblatt
 * ========================================================================= */

export interface WiderspruchZeile {
  readonly ebene: 'ansprechpartner' | 'kunde';
  readonly betroffenerId: string;
  readonly name: string;
  readonly kundeName: string | null;
  readonly email: string | null;
  readonly werbewiderspruchAm: Date | null;
  readonly widerspruchAm: Date | null;
  readonly rechtsgrundlage: string;
}

/**
 * Wer hat widersprochen — Kontakte UND Firmen, in EINEM Abruf.
 *
 * Wer nicht widersprochen hat, steht nicht drin: das Blatt ist ein Nachweis,
 * kein Verzeichnis.
 */
export async function liste(
  kontext: LeseKontext,
): Promise<readonly WiderspruchZeile[]> {
  return kontext.abfrage<WiderspruchZeile>(
    `select ebene, betroffener_id as "betroffenerId", name,
            kunde_name as "kundeName", email,
            werbewiderspruch_am as "werbewiderspruchAm",
            widerspruch_am as "widerspruchAm", rechtsgrundlage
       from app.werbewiderspruch_liste()`);
}

export interface ProtokollZeile {
  readonly id: string;
  readonly art: WiderspruchArt;
  readonly ansprechpartnerId: string | null;
  readonly kundeId: string | null;
  readonly name: string | null;
  readonly email: string | null;
  readonly kanal: string | null;
  readonly quelle: WiderspruchQuelle;
  readonly nachrichtId: string | null;
  readonly bemerkung: string | null;
  readonly eingegangenAm: Date;
  readonly erfasstVon: string | null;
}

/**
 * Das Protokoll — mit Weg, Kanal und auslösender Nachricht.
 *
 * **Der NAME kommt aus `kunde`, nicht aus `ansprechpartner`.** Die Tabelle
 * `werbewiderspruch` trägt `ansprechpartner_id`, und `ansprechpartner.vorname`
 * ist für `cse_app` lesbar — aber nur mit `crm.lesen`, das diese Route nicht
 * verlangt. Ein `left join` liefert dann `null`, und `null` heisst hier
 * „Name nicht lesbar", nicht „kein Name". Die Oberfläche sagt das so.
 */
export async function protokoll(
  kontext: LeseKontext,
): Promise<readonly ProtokollZeile[]> {
  return kontext.abfrage<ProtokollZeile>(
    `select w.id, w.art::text as art,
            w.ansprechpartner_id as "ansprechpartnerId",
            w.kunde_id as "kundeId",
            coalesce(btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname),
                     k.name) as name,
            w.email, w.kanal, w.quelle::text as quelle,
            w.nachricht_id as "nachrichtId", w.bemerkung,
            w.eingegangen_am as "eingegangenAm", b.name as "erfasstVon"
       from werbewiderspruch w
       left join ansprechpartner ap
         on ap.mandant_id = w.mandant_id and ap.id = w.ansprechpartner_id
       left join kunde k on k.mandant_id = w.mandant_id and k.id = w.kunde_id
       left join benutzer b on b.id = w.erfasst_von
      where w.mandant_id = app.aktiver_mandant()
      order by w.eingegangen_am desc`);
}

/** Der Widerspruchsstand EINES Betroffenen — für die Vorgangsakte. */
export interface Stand {
  readonly ebene: 'ansprechpartner' | 'kunde';
  readonly betroffenerId: string;
  /**
   * Die Firma hinter dem Kontakt — aus DEMSELBEN Definer, nicht aus einem
   * zweiten `select` auf `ansprechpartner`.
   *
   * Der direkte Weg lief unter `t_mandant` und verlangte `crm.lesen`; für eine
   * Datenschutzbeauftragte ohne CRM-Recht kam dort keine Zeile, und der Haken
   * „auch auf Ebene der Firma" wirkte still nicht — bei einer unwiderruflichen
   * Handlung.
   */
  readonly kundeId: string | null;
  readonly name: string;
  readonly werbewiderspruchAm: Date | null;
  readonly widerspruchAm: Date | null;
  readonly rechtsgrundlage: string;
}

export async function stand(
  kontext: LeseKontext, ansprechpartnerId: string | null, kundeId: string | null,
): Promise<readonly Stand[]> {
  if (ansprechpartnerId === null && kundeId === null) return [];
  return kontext.abfrage<Stand>(
    `select ebene, betroffener_id as "betroffenerId", kunde_id as "kundeId",
            name, werbewiderspruch_am as "werbewiderspruchAm",
            widerspruch_am as "widerspruchAm", rechtsgrundlage
       from app.widerspruch_stand($1::uuid, $2::uuid)`,
    [ansprechpartnerId, kundeId]);
}
