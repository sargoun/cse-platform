import 'server-only';
import {
  GESELLSCHAFT_SPALTEN, GRENZE, gesellschaftAus,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';

/**
 * Die Nachrichten eines Kunden — Lesen, und nur Lesen
 * (NOT-03, CRM-06, SPEC §22 `nachricht`, 0255).
 *
 * **Auf `nachricht` griff bis 0255 kein einziger Dienst unter
 * `services/` zu.** `/portal/mein/nachrichten` liest `benachrichtigung` ueber
 * `ladePosteingang` — eine andere Tabelle mit einem anderen Zweck (Wächter-
 * und Fristmeldungen an einen Menschen). Diese Datei ist deshalb der erste
 * Lesepfad auf den Faden selbst, und sie ist absichtlich der schmalste
 * moegliche.
 *
 * **Der Absender wird NICHT aufgeloest.** `nachricht.absender_benutzer_id`
 * zeigt auf `benutzer`; ein Join darauf gaebe dem Kunden den Namen der
 * Sachbearbeiterin, und 04-SEITENKARTE §8 schliesst dem Kunden das ganze
 * `personal`-Modul aus („no names"). Absender ist deshalb die GESELLSCHAFT —
 * das ist auch die Wahrheit des Vorgangs: geschrieben hat die CSE
 * Dienstleistungen GmbH, nicht ein Mensch, den der Kunde nicht kennt. Ein
 * Ansprechpartner steht in der Nachricht, wenn er darin steht.
 *
 * **`absender_extern` bleibt ebenfalls weg.** Bei einer eingehenden Nachricht
 * ist das die Adresse, von der aus geschrieben wurde — beim Kundenfaden also
 * die des Kunden selbst, aber eben nicht zwingend: eine Weiterleitung traegt
 * dort die Adresse eines Dritten.
 *
 * **Kein Schreibweg.** Nicht „ein deaktivierter Knopf", sondern: dieser
 * Dienst hat keine schreibende Funktion, `nachricht.versenden` ist der Rolle
 * `kunde` nicht erteilt, und `withKundeScope` gibt einen `LeseKontext` ohne
 * `schreibe` — ein Schreibversuch ist ein Compilerfehler.
 * // TODO(client, O-74): Darf ein Kunde im Portal antworten, und was gilt
 * dann fuer die Freigabe (Invariante 7) und fuer § 7 UWG, wenn die Antwort
 * eine ausgehende Nachricht der Gesellschaft ausloest?
 */

export interface Kundennachricht extends Gesellschaft {
  readonly id: string;
  readonly threadId: string;
  readonly betreff: string | null;
  /** `eingehend` = vom Kunden, `ausgehend` = an den Kunden. `intern` gibt es hier nie. */
  readonly richtung: string;
  readonly kanal: string;
  /** Berliner Ortszeit, in der Datenbank formatiert (Invariante 2). */
  readonly zeitpunktLokal: string;
  /** Wurde die Nachricht auf Kundenseite als gelesen gestempelt? */
  readonly gelesen: boolean;
  /** Wie viele Anhänge die Nachricht trägt — siehe `anhaengeSichtbar`. */
  readonly anhaenge: number;
}

export interface KundennachrichtVoll extends Kundennachricht {
  readonly koerper: string;
  /** Die Nachricht, auf die geantwortet wurde — oder `null`. */
  readonly antwortetAufId: string | null;
}

interface ListenZeile extends GesellschaftRoh {
  readonly id: string;
  readonly thread_id: string;
  readonly betreff: string | null;
  readonly richtung: string;
  readonly kanal: string;
  readonly zeitpunkt_lokal: string;
  readonly gelesen: boolean;
  readonly anhaenge: number;
}

interface VollZeile extends ListenZeile {
  readonly koerper: string;
  readonly antwortet_auf_id: string | null;
}

/**
 * **`coalesce(gesendet_am, erstellt_am)` und nicht `gesendet_am`.**
 *
 * `0231` nimmt `gesendet_am` den Vorgabewert, weil der Zeitpunkt nur gesetzt
 * werden soll, wenn etwas wirklich hinausgeht — fuer `kanal = 'portal'` geht
 * nichts hinaus, der Empfaenger liest angemeldet. Nach `gesendet_am` allein
 * sortiert stuende der ganze Portalfaden mit `null` am Rand und ohne Datum
 * auf dem Bildschirm. Der Rueckfall ist `erstellt_am`, und beide sind
 * `timestamptz` in UTC.
 */
const ZEITPUNKT = `coalesce(n.gesendet_am, n.erstellt_am)`;

const LISTEN_SPALTEN = `
  n.id, n.thread_id, n.betreff, n.richtung::text as richtung, n.kanal::text as kanal,
  to_char(${ZEITPUNKT} at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as zeitpunkt_lokal,
  ${GESELLSCHAFT_SPALTEN},
  /*
   * Gelesen heisst: EINE Empfaengerzeile des Kunden ist gestempelt. Mehrere
   * Ansprechpartner koennen adressiert sein; „einer hat es gesehen" ist die
   * Aussage, die der Kunde selbst treffen wuerde. t_kunde auf
   * nachricht_empfaenger (0255) zeigt nur die eigenen Zeilen — ein interner
   * Mitempfaenger zaehlt hier also nicht mit, und das ist richtig.
   *
   * (Keine Schraegstriche-Anfuehrungszeichen in diesem Kommentar: er steht in
   * einem Template-Literal, und ein Backtick darin beendet die Zeichenkette.)
   */
  case when n.richtung = 'ausgehend'
       then exists (select 1 from nachricht_empfaenger e
                     where e.mandant_id = n.mandant_id and e.nachricht_id = n.id
                       and e.gelesen_am is not null)
       /*
        * Nur fuer die Richtung, in der der Zustand etwas bedeutet.
        * "eingehend" heisst aus Sicht des Hauses: der KUNDE hat sie
        * geschrieben. Die Liste zeigte dafuer „Von Ihnen" und daneben eine
        * Pille, die zum Lesen auffordert — der Kunde sollte seine eigene
        * Nachricht lesen —, und die Zeile zaehlte in „N ungelesen" mit.
        */
       else true end as gelesen,
  (select count(*) from nachricht_anhang a
    where a.mandant_id = n.mandant_id and a.nachricht_id = n.id)::int as anhaenge`;

/** Der Volltext kommt NUR auf der Detailseite dazu — eine Liste braucht ihn nicht. */
const VOLL_SPALTEN = `${LISTEN_SPALTEN}, n.koerper, n.antwortet_auf_id`;

const QUELLE = `
  from nachricht n
  join mandant m on m.id = n.mandant_id`;

/**
 * **`kunde_id is not null` steht hier, obwohl die Policy es erzwingt.**
 *
 * `p_kunde_decke` (0255) laesst im Kundenportal keine Zeile ohne
 * Kundenbezug durch — die Bedingung ist also fachlich redundant. Sie steht
 * trotzdem: dieselbe Abfrage laeuft in einem Test auch als Eigentuemer (dort
 * gilt FORCE, aber ein Ausblick auf eine kuenftige Definer-Fassung ist
 * denkbar), und eine Abfrage, die ihre eigene Voraussetzung nennt, ist die,
 * die man ohne den Policy-Katalog daneben noch lesen kann.
 */
export async function listeKundennachrichten(
  kontext: KundenAbfrage,
): Promise<readonly Kundennachricht[]> {
  const zeilen = await kontext.abfrage<ListenZeile>(
    `select ${LISTEN_SPALTEN} ${QUELLE}
      where n.kunde_id is not null
      order by ${ZEITPUNKT} desc, n.erstellt_am desc
      limit ${GRENZE}`,
  );
  return zeilen.map(alsZeile);
}

/**
 * Eine Nachricht im Einzelnen.
 *
 * Eine fremde Zeile liefert `null` — daraus macht die Seite `notFound()`, nie
 * 403 (AUT-06, SEC-A3): „nicht da" ist byte-gleich mit „nicht erlaubt", und
 * ein 403 bestaetigte die Existenz eines Vorgangs bei einem anderen Kunden.
 */
export async function findeKundennachricht(
  kontext: KundenAbfrage, id: string,
): Promise<KundennachrichtVoll | null> {
  const [z] = await kontext.abfrage<VollZeile>(
    `select ${VOLL_SPALTEN} ${QUELLE}
      where n.id = $1::uuid and n.kunde_id is not null`,
    [id],
  );
  return z === undefined ? null : { ...alsZeile(z), koerper: z.koerper,
    antwortetAufId: z.antwortet_auf_id };
}

/**
 * Der Faden zu einer Nachricht — ohne sie selbst.
 *
 * Ein Vorgang ist die Frage UND die Antwort; sie getrennt zu zeigen heisst,
 * dem Kunden das Sortieren im Kopf zu ueberlassen (`0231` macht genau dieses
 * Argument fuer den internen Posteingang). Was der Kunde von dem Faden nicht
 * sehen darf, haelt die Decke fern: ein interner Vermerk im selben Faden
 * traegt `richtung = 'intern'` und kommt hier nicht vor.
 */
export async function ladeFaden(
  kontext: KundenAbfrage, threadId: string, ausserId: string,
): Promise<readonly Kundennachricht[]> {
  const zeilen = await kontext.abfrage<ListenZeile>(
    `select ${LISTEN_SPALTEN} ${QUELLE}
      where n.thread_id = $1::uuid and n.id <> $2::uuid and n.kunde_id is not null
      order by ${ZEITPUNKT}, n.erstellt_am
      limit ${GRENZE}`,
    [threadId, ausserId],
  );
  return zeilen.map(alsZeile);
}

/**
 * Sind Anhänge im Kundenportal ueberhaupt erreichbar?
 *
 * Heute nicht, und das ist kein Versehen: `dokument` traegt seit `0141` die
 * RESTRIKTIVE Kundendecke `p_kunde_ceiling` auf `sichtbar_fuer_kunde` — es
 * fehlt allein die PERMISSIVE `t_kunde`, und die zu setzen ist eine
 * Entscheidung ueber Anlagen, nicht ueber Policies. Die Seite zeigt deshalb
 * die ANZAHL (die steht in `nachricht_anhang` und ist im Kunden-Scope
 * lesbar) mit dem Satz, dass die Dateien auf dem bisherigen Weg kommen —
 * statt eines Verweises, hinter dem 404 steht.
 *
 * // TODO(client, O-671): Duerfen Anhaenge einer Kundennachricht im Portal
 * heruntergeladen werden — also bekommt `dokument` eine permissive `t_kunde`
 * auf `sichtbar_fuer_kunde` —, oder bleiben Anlagen dem Mailweg vorbehalten?
 */
export const ANHAENGE_SICHTBAR: boolean = false;

function alsZeile(z: ListenZeile): Kundennachricht {
  return {
    id: z.id,
    threadId: z.thread_id,
    betreff: z.betreff,
    richtung: z.richtung,
    kanal: z.kanal,
    zeitpunktLokal: z.zeitpunkt_lokal,
    gelesen: z.gelesen,
    anhaenge: z.anhaenge,
    ...gesellschaftAus(z),
  };
}
