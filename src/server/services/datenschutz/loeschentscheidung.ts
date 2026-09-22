/**
 * **Art. 17 DSGVO gegen die Aufbewahrungspflicht — eine Entscheidung, keine
 * Löschung** (LEG-09, LEG-01, LEG-02, Phase 7).
 *
 * `04-SEITENKARTE.md` §5.25 sagt es in einem Satz:
 * „`datenschutz.loeschung_pruefen` **does not delete**: it produces a decision
 * record naming, per field and per table, whether erasure is owed or
 * overridden by a retention obligation (§17 MiLoG two years, §147 AO ten
 * years, audit immutability, the invoice hash chain). Execution is
 * anonymisation plus tombstoning, and the hours themselves survive because the
 * law requires them to exist."
 *
 * **Und hier ist der Befund, der diesen Dienst ehrlich macht.** Den Vollzug,
 * auf den dieser Satz verweist, gibt es heute NICHT. Nachgemessen in der
 * lebenden Datenbank: es existiert genau EIN löschender Lauf
 * (`bewerber_loeschung`, und der betrifft nur abgelaufene Bewerbungen), keine
 * Funktion mit `anonymisier` im Namen, und kein Codepfad, der
 * `anonymisiert_am` schreibt. Für eine Beschäftigte, einen Kundenkontakt oder
 * eine Firma gibt es also weder Anonymisierung noch Tombstone.
 *
 * Eine Seite, die trotzdem „freigegeben" sagt, erzeugt eine unterschriebene
 * Freigabe für eine Ausführung, die niemand ausführt — genau das, wogegen
 * `loeschkonzept.ts` seine eigene Registerabfrage begründet („statt eine
 * Löschung zu behaupten, die niemand ausführt"). Deshalb heisst das Ergebnis
 * dieses Dienstes **Vormerkung** und nicht Vollzug, und `VOLLZUG` sagt in
 * Worten, was noch fehlt.
 *
 * // TODO(client, O-644): Wer führt die Löschvormerkung aus — Anonymisierungsprozedur, Nachtlauf, oder ein Mensch mit Protokollpflicht?
 *
 * **Die Fristen rechnet eine getestete Funktion, kein Modell** (Invariante 6).
 * `aoFrist` und `milogFrist` rechnen im Berliner KALENDER auf Datumszahlen und
 * berühren keinen Zeitpunkt — deshalb kann keine Sommerzeit sie um einen Tag
 * verschieben.
 */
import { KEIN_HARD_DELETE, type Loeschart } from '@/server/db/schema/rls';
import { LOESCHART_LABEL } from './loeschkonzept.js';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import type { Zuordnung, ZuordnungArt } from './anfrage.js';

export class LoeschFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'LoeschFehler';
  }
}

/* =========================================================================
 * Die Fristen — im Kalender, nicht auf der Uhr
 * ========================================================================= */

/** Ein Kalendertag in Berlin, als `YYYY-MM-DD`. */
export type Kalendertag = string;

const BERLIN_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * Der Berliner Kalendertag eines Zeitpunkts.
 *
 * **Der Umweg über `Intl` ist der Punkt, nicht der Umstand.**
 * `date.getFullYear()` gäbe das Jahr der Zone, in der der Server läuft — und
 * ein Zeiteintrag vom 1. Januar 00:30 Berliner Zeit liegt in UTC noch im
 * Dezember. Eine Zehnjahresfrist, die davon abhängt, wo der Server steht, ist
 * keine Frist (Invariante 2).
 */
export function berlinTag(zeitpunkt: Date): Kalendertag {
  return BERLIN_ISO.format(zeitpunkt);
}

function teile(tag: Kalendertag): { j: number; m: number; t: number } {
  const [j, m, t] = tag.split('-').map((x) => Number.parseInt(x, 10));
  if (j === undefined || m === undefined || t === undefined
      || Number.isNaN(j) || Number.isNaN(m) || Number.isNaN(t)) {
    throw new LoeschFehler(`Kein Kalendertag: „${tag}"`, 'kein_tag');
  }
  return { j, m, t };
}

const ZWEI = (n: number): string => String(n).padStart(2, '0');

/** Der letzte Tag eines Monats — im Kalender, ohne Zeitzone. */
function monatsletzter(j: number, m: number): number {
  return [31, (j % 4 === 0 && j % 100 !== 0) || j % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 31;
}

/**
 * § 147 Abs. 3 und 4 AO: **zehn Jahre, gerechnet ab Ende des Kalenderjahres**,
 * in dem die Unterlage entstanden ist. Die Sperre fällt am 1. Januar danach.
 *
 * Ein Beleg vom 3. März 2026 ist damit bis zum 31. Dezember 2036
 * aufzubewahren; am 1. Januar 2037 darf er gelöscht werden.
 *
 * **Nicht „Datum plus zehn Jahre".** Das wäre der 3. März 2036 — zehn Monate
 * zu früh, und zehn Monate sind der Unterschied zwischen einer Löschung und
 * einer Verletzung der Aufbewahrungspflicht.
 */
export function aoFrist(entstanden: Kalendertag): Kalendertag {
  const { j } = teile(entstanden);
  /*
   * Auch hier: der ERSTE Tag, an dem gelöscht werden darf. `milogFrist` sagt
   * dasselbe — eine Spalte, eine Bedeutung.
   */
  return `${String(j + 11)}-01-01`;
}

/**
 * § 17 Abs. 2 MiLoG: die Arbeitszeitaufzeichnung ist **zwei Jahre** ab dem für
 * die Aufzeichnung maßgeblichen Zeitpunkt aufzubewahren.
 *
 * **Die Rückgabe ist der ERSTE Tag, an dem gelöscht werden darf** — dieselbe
 * Bedeutung wie bei `aoFrist`, und das war der Befund: `aoFrist` gab mit dem
 * 1. Januar den Tag NACH dem Fristende, `milogFrist` gab denselben
 * Kalendertag zwei Jahre später, also den LETZTEN Tag der Aufbewahrung. Zwei
 * Bedeutungen in einer Spalte (`loeschentscheidung.sperre_faellt_am`), und der
 * Unterschied ist ein Tag, den niemand sieht.
 *
 * **Und deshalb rundet der 29. Februar AUF.** Die Vorfassung gab für den
 * 29.02.2024 den 28.02.2026 zurück — mit der Begründung, das sei die für den
 * Betroffenen günstigere Wahl. Die Grenze setzt hier aber nicht sein
 * Interesse, sondern die Aufbewahrungspflicht: einen Tag früher zu löschen
 * heisst, die gesetzlichen „mindestens zwei Jahre" zu unterschreiten. Also
 * 01.03.2026 — der erste Tag NACH zwei vollen Jahren.
 *
 * **Kalendarisch, nicht 730 Tage** (das bleibt): eine Frist, die auf Tage
 * rechnet, verschiebt sich um ein Schaltjahr.
 */
export function milogFrist(aufgezeichnet: Kalendertag): Kalendertag {
  const { j, m, t } = teile(aufgezeichnet);
  const zielJahr = j + 2;
  /*
   * Zwei Jahre auf denselben Kalendertag, dann EIN Tag weiter. Der 29.02.
   * hat in zwei Jahren keinen Nachfolger; `Math.min` gäbe den 28.02., und der
   * Tag danach ist der 01.03. — also genau die Aufrundung, die die Pflicht
   * verlangt, ohne einen Sonderfall dafür zu schreiben.
   */
  const tag = Math.min(t, monatsletzter(zielJahr, m));
  return naechsterTag(zielJahr, m, tag);
}

/** Der Kalendertag nach diesem — im Kalender, ohne Zeitzone. */
function naechsterTag(j: number, m: number, t: number): Kalendertag {
  if (t < monatsletzter(j, m)) return `${String(j)}-${ZWEI(m)}-${ZWEI(t + 1)}`;
  if (m < 12) return `${String(j)}-${ZWEI(m + 1)}-01`;
  return `${String(j + 1)}-01-01`;
}

/* =========================================================================
 * Die Orte, an denen etwas über diesen Menschen steht
 * ========================================================================= */

/** Woher die Sperre kommt — oder dass es keine gibt. */
export type Sperrgrund =
  | { readonly art: 'gesetz'; readonly fundstelle: string;
      readonly frist: 'ao' | 'milog' | null }
  | { readonly art: 'unveraenderlich'; readonly fundstelle: string }
  | { readonly art: 'offen'; readonly frage: string }
  | { readonly art: 'keine' };

interface OrtDefinition {
  readonly tabelle: string;
  readonly titel: string;
  readonly fuer: readonly Exclude<ZuordnungArt, 'keine'>[];
  /** Das Recht, ohne das die Zählung null ergibt — und das ist nicht null. */
  readonly recht: string | null;
  readonly sperre: Sperrgrund;
  /** Zählt die Zeilen und nennt den frühesten Anker für die Frist. */
  readonly sql: string;
}

/**
 * Die Orte, gezählt in der lebenden Datenbank und nicht geraten.
 *
 * **Jeder Ort nennt sein Recht.** Ein Ort, den die erteilten Rechte nicht
 * öffnen, zählt null Zeilen — und „null Zeilen" heisst dann NICHT „hier steht
 * nichts über diesen Menschen", sondern „ich durfte nicht nachsehen". Eine
 * Löschentscheidung auf dieser Grundlage wäre eine Entscheidung über
 * Ungelesenes. Der Ort erscheint deshalb als `ungelesen` in der Matrix, nicht
 * als leer — derselbe Fehler, der bei der Art.-15-Auskunft eine halbe Antwort
 * erzeugt.
 */
const ORTE: readonly OrtDefinition[] = [
  {
    tabelle: 'person',
    titel: 'Stammdaten der Person',
    fuer: ['person'],
    recht: null,
    sperre: { art: 'offen', frage: 'O-514' },
    sql: `select count(*)::int as zeilen, min(erstellt_am) as anker
            from person where id = $1::uuid and geloescht_am is null`,
  },
  {
    tabelle: 'anstellung',
    titel: 'Anstellungen',
    fuer: ['person'],
    recht: null,
    sperre: { art: 'offen', frage: 'O-514' },
    sql: `select count(*)::int as zeilen, min(erstellt_am) as anker
            from anstellung
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
             and geloescht_am is null`,
  },
  {
    tabelle: 'zeiteintrag',
    titel: 'Arbeitszeitaufzeichnungen',
    fuer: ['person'],
    recht: 'zeit.lesen',
    sperre: { art: 'gesetz', fundstelle: '§ 17 Abs. 2 MiLoG — zwei Jahre',
              frist: 'milog' },
    sql: `select count(*)::int as zeilen, max(beginn_zeitpunkt) as anker
            from zeiteintrag
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
             and ersetzt_am is null`,
  },
  {
    tabelle: 'abwesenheit',
    titel: 'Abwesenheiten',
    fuer: ['person'],
    recht: 'zeit.abwesenheit_lesen',
    sperre: { art: 'offen', frage: 'O-71' },
    sql: `select count(*)::int as zeilen, max(a.erstellt_am) as anker
            from abwesenheit a
            join anstellung an on an.id = a.anstellung_id
             and an.mandant_id = a.mandant_id
           where an.person_id = $1::uuid and a.mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'stundenkonto',
    titel: 'Stundenkonten',
    fuer: ['person'],
    recht: 'zeit.konto_lesen',
    sperre: { art: 'gesetz', fundstelle: '§ 147 Abs. 1 AO — Lohnunterlage, zehn Jahre',
              frist: 'ao' },
    sql: `select count(*)::int as zeilen, max(k.erstellt_am) as anker
            from stundenkonto k
            join anstellung an on an.id = k.anstellung_id
             and an.mandant_id = k.mandant_id
           where an.person_id = $1::uuid and k.mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'nachweis',
    titel: 'Qualifikationsnachweise',
    fuer: ['person'],
    recht: 'personal.nachweis_lesen',
    sperre: { art: 'offen', frage: 'O-46' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from nachweis where person_id = $1::uuid`,
  },
  {
    tabelle: 'da_kenntnisnahme',
    titel: 'Bestätigte Dienstanweisungen',
    fuer: ['person'],
    recht: 'dienstanweisung.lesen',
    sperre: { art: 'unveraenderlich',
              fundstelle: 'Nur Anfügen: die Bestätigung IST der Nachweis (GewO, § 6 ArbSchG)' },
    sql: `select count(*)::int as zeilen, max(bestaetigt_am) as anker
            from da_kenntnisnahme
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'wachbuch_eintrag',
    titel: 'Wachbucheinträge',
    fuer: ['person'],
    recht: 'wachbuch.lesen',
    sperre: { art: 'unveraenderlich',
              fundstelle: 'Hashkette des Wachbuchs — ein entfernter Eintrag bricht sie (§ 34a GewO)' },
    sql: `select count(*)::int as zeilen, max(erfasst_am) as anker
            from wachbuch_eintrag
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'schluessel_quittung',
    titel: 'Schlüsselquittungen',
    fuer: ['person'],
    recht: 'schluessel.lesen',
    sperre: { art: 'unveraenderlich',
              fundstelle: 'Nur Anfügen: die Quittung belegt die Übergabe (Haftung)' },
    sql: `select count(*)::int as zeilen, max(quittiert_am) as anker
            from schluessel_quittung
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'mitarbeiter_zugang',
    titel: 'Mitarbeiterzugang',
    fuer: ['person'],
    recht: null,
    /*
     * Bis `0384` stand hier `keine` — die Tabelle trug weder Loeschsperre noch
     * Protokoll, und eine Zeile liess sich still entfernen. Seit `0384` ist sie
     * `archiv`: beendet wird mit `gesperrt_am`, nie durch Loeschen. Eine
     * geloeschte Zeile naehme den Anker jeder Anmeldung dieses Menschen mit und
     * gaebe seine Nummer fuer einen zweiten Menschen frei, als waere sie nie
     * vergeben gewesen.
     */
    sperre: { art: 'unveraenderlich',
              fundstelle: 'Nur Sperren: der Zugang ist der Anker jeder Anmeldung (0113, 0384)' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from mitarbeiter_zugang where person_id = $1::uuid`,
  },
  {
    tabelle: 'benachrichtigung',
    titel: 'Benachrichtigungen im Portal',
    fuer: ['person'],
    recht: 'datenschutz.auskunft_erstellen',
    sperre: { art: 'keine' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from app.benachrichtigung_auskunft($1::uuid)`,
  },
  {
    tabelle: 'ansprechpartner',
    titel: 'Kontaktdaten und werberechtliche Einstufung',
    fuer: ['ansprechpartner'],
    recht: 'crm.lesen',
    sperre: { art: 'gesetz',
              fundstelle: '§ 7 UWG — der Widerspruch IST der Beweis; Löschung über anonymisiert_am',
              frist: null },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from ansprechpartner
           where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'werbewiderspruch',
    titel: 'Protokoll der Widersprüche',
    fuer: ['ansprechpartner'],
    recht: 'crm.rechtsgrundlage_lesen',
    sperre: { art: 'gesetz',
              fundstelle: '§ 7 UWG — ohne das Protokoll ist die Abmahnung nicht abwehrbar',
              frist: null },
    sql: `select count(*)::int as zeilen, max(eingegangen_am) as anker
            from werbewiderspruch
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'bewerbung',
    titel: 'Bewerbung',
    fuer: ['bewerbung'],
    recht: 'recruiting.bewerbung_lesen',
    sperre: { art: 'offen', frage: 'O-373' },
    sql: `select count(*)::int as zeilen, max(eingegangen_am) as anker
            from bewerbung
           where id = $1::uuid and mandant_id = app.aktiver_mandant()
             and geloescht_am is null`,
  },
  {
    tabelle: 'bewerbung_bewertung',
    titel: 'Bewertungen der Bewerbung',
    fuer: ['bewerbung'],
    recht: 'recruiting.bewerbung_lesen',
    sperre: { art: 'offen', frage: 'O-373' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from bewerbung_bewertung
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'gespraech',
    titel: 'Gespräche und Notizen',
    fuer: ['bewerbung'],
    recht: 'recruiting.bewerbung_lesen',
    sperre: { art: 'offen', frage: 'O-373' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from gespraech
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  /* -----------------------------------------------------------------------
   * **Der Kontaktzweig war vier Orte lang, das Schema hat sieben.**
   *
   * Die Seite zeigt darüber „N von N entschieden" und behauptet damit eine
   * tabellenweise Vollständigkeit, die 04-SEITENKARTE §5.25 zusagt („PER
   * FIELD and PER TABLE") und die nicht vorlag. Die Datei schützte sich gegen
   * „Recht fehlt" (`ungelesen` statt leer) und nicht gegen „Tabelle steht
   * nicht in der Liste" — und der zweite Fall ist der stillere: ein Ort, der
   * fehlt, erscheint nirgends.
   *
   * `tests/isolation/datenschutz-abdeckung.test.ts` hält die Liste jetzt gegen
   * `information_schema` und fällt bei der nächsten neuen Tabelle.
   * -------------------------------------------------------------------- */
  {
    tabelle: 'lead',
    titel: 'Anfragen und Vorgänge (Leads)',
    fuer: ['ansprechpartner'],
    recht: 'crm.lesen',
    /*
     * `{art:'offen', frage:'O-71'}`: hier fallen der § 7 UWG-Nachweis und der
     * Akquiseverlauf zusammen. Der Vorgang selbst ist eine
     * Geschäftsanbahnung (GoBD-nah, § 147 AO), die Kontaktspur daran ist
     * Werbung — welche der beiden Pflichten die Löschung überlagert, ist
     * nicht entschieden. Eine Frist zu behaupten wäre hier der Fehler.
     */
    sperre: { art: 'offen', frage: 'O-71' },
    sql: `select count(*)::int as zeilen, min(erstellt_am) as anker
            from lead
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'lead_aktivitaet',
    titel: 'Korrespondenz und Vermerke zum Vorgang',
    fuer: ['ansprechpartner'],
    recht: 'crm.lesen',
    sperre: { art: 'offen', frage: 'O-71' },
    sql: `select count(*)::int as zeilen, min(geschehen_am) as anker
            from lead_aktivitaet
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'angebot',
    titel: 'Angebote mit dieser Person als Ansprechpartner',
    fuer: ['ansprechpartner'],
    recht: 'angebot.lesen',
    sperre: { art: 'gesetz',
              fundstelle: '§ 147 Abs. 1 Nr. 5 AO — Handelsbrief, zehn Jahre ab '
                + 'Ende des Kalenderjahres',
              frist: 'ao' },
    sql: `select count(*)::int as zeilen, min(erstellt_am) as anker
            from angebot
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'objekt',
    titel: 'Objekte mit dieser Person als Ansprechpartner',
    fuer: ['ansprechpartner'],
    recht: 'objekt.lesen',
    /*
     * Keine Aufbewahrungspflicht auf der ZUORDNUNG: das Objekt bleibt, die
     * Ansprechpartnerspalte lässt sich räumen. Das ist der einzige Ort dieses
     * Zweigs, an dem eine Löschung ohne Gegenpflicht geschuldet sein kann —
     * und genau deshalb muss er in der Matrix stehen.
     */
    sperre: { art: 'keine' },
    sql: `select count(*)::int as zeilen, min(erstellt_am) as anker
            from objekt
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'werbewiderspruch_token',
    titel: 'Ausgegebene Widerspruchslinks (§ 7 Abs. 3 Nr. 4 UWG)',
    fuer: ['ansprechpartner'],
    recht: 'datenschutz.auskunft_erstellen',
    sperre: { art: 'gesetz',
              fundstelle: '§ 7 Abs. 3 Nr. 4 UWG — der Abdruck belegt, DASS die '
                + 'Werbenachricht einen wirksamen Widerspruchsweg trug',
              frist: null },
    /*
     * Über den Definer: `cse_app` hat auf dieser Tabelle GAR KEIN Recht
     * (0222). Ein direktes `count(*)` zählte nicht null, es SCHEITERTE — und
     * ein Ort, der beim Zählen scheitert, nimmt die ganze Matrix mit.
     */
    sql: `select count(*)::int as zeilen, min(ausgegeben_am) as anker
            from app.werbewiderspruch_token_auskunft($1::uuid)`,
  },
  /* -----------------------------------------------------------------------
   * Und derselbe Befund im Bewerbungszweig: fünf Orte, sechs Tabellen mit
   * `bewerbung_id`.
   * -------------------------------------------------------------------- */
  {
    tabelle: 'bewerbung_antwort',
    titel: 'Antworten an die Bewerberin',
    fuer: ['bewerbung'],
    recht: 'recruiting.bewerbung_lesen',
    sperre: { art: 'offen', frage: 'O-373' },
    sql: `select count(*)::int as zeilen, min(erstellt_am) as anker
            from bewerbung_antwort
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'einstellungsentscheidung',
    titel: 'Einstellungsentscheidung',
    fuer: ['bewerbung'],
    recht: 'recruiting.bewerbung_lesen',
    /*
     * `{art:'offen', frage:'O-46'}` und nicht „geschuldet": die Entscheidung
     * mit ihrer Begründung ist das, was im Streitfall nach § 15 Abs. 4 AGG
     * die Beweislage trägt — und ob diese Zweimonatsfrist die Löschung
     * überlagert, ist eine Rechtsfrage und keine Voreinstellung.
     */
    sperre: { art: 'offen', frage: 'O-46' },
    sql: `select count(*)::int as zeilen, min(entschieden_am) as anker
            from einstellungsentscheidung
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'kandidat',
    titel: 'Kandidatenprofil',
    fuer: ['bewerbung'],
    recht: 'recruiting.bewerbung_lesen',
    sperre: { art: 'offen', frage: 'O-373' },
    sql: `select count(*)::int as zeilen, min(erstellt_am) as anker
            from kandidat
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
  },
  {
    tabelle: 'betroffenenanfrage',
    titel: 'Diese und frühere Betroffenenanfragen',
    fuer: ['person', 'ansprechpartner', 'bewerbung'],
    recht: null,
    sperre: { art: 'unveraenderlich',
              fundstelle: 'Art. 12 Abs. 3: der Nachweis, DASS eine Anfrage einging, ist das, '
                + 'was eine Aufsicht sehen will' },
    sql: `select count(*)::int as zeilen, max(eingegangen_am) as anker
            from betroffenenanfrage
           where mandant_id = app.aktiver_mandant()
             and (person_id = $1::uuid or ansprechpartner_id = $1::uuid
                  or bewerbung_id = $1::uuid)`,
  },
  {
    tabelle: 'audit_log',
    titel: 'Prüfprotokoll (Einträge über diesen Datensatz)',
    fuer: ['person', 'ansprechpartner', 'bewerbung'],
    /*
     * **Kein Recht, und das ist nachgemessen.** `t_audit_lesen` verlangt nur
     * `mandant_id is null or mandant_id = any(app.sichtbare_mandanten())` —
     * `system.audit_lesen` bewacht die SEITE, nicht die Zeile. Hier ein Recht
     * zu behaupten, das die Policy nicht fragt, hiesse „ungelesen" zu
     * schreiben, wo gelesen wurde: eine Aussage ueber die Berechtigung statt
     * ueber die Daten, und damit derselbe Fehler in die andere Richtung.
     * Gezaehlt wird ohnehin nur; die Nutzlast liegt hinter
     * `app.audit_nutzlast_lesen`.
     */
    recht: null,
    sperre: { art: 'unveraenderlich',
              fundstelle: 'SEC-A9, GoBD: ein löschbares Protokoll ist keines' },
    sql: `select count(*)::int as zeilen, max(erstellt_am) as anker
            from audit_log
           where mandant_id = app.aktiver_mandant() and objekt_id = $1::text`,
  },
];

/**
 * **Was die Matrix NICHT entscheidet — benannt, nicht weggelassen.**
 *
 * Elf Tabellen tragen `person_id` und stehen nicht in `ORTE`. Der Grund ist
 * nicht, dass dort nichts steht: es sind abgeleitete Befunde
 * (`arbeitszeit_verstoss`, `planungs_konflikt`, `nachweis_warnung`,
 * `da_pflicht`), technische Datensätze des Zugangs (`benutzer`,
 * `checkin_token`, `offline_ereignis`) und Zuordnungen, die mit ihrem
 * Hauptsatz fallen (`einsatz_zuordnung`, `zeitnachweis`, `team_mitglied`,
 * `bewacher_eintrag`).
 *
 * Ob sie eine eigene Entscheidungszeile brauchen oder mit dem Datensatz
 * fallen, an dem sie hängen, ist eine Rechtsfrage — und solange sie offen ist,
 * gehört sie auf den Bildschirm und nicht in einen Kommentar. Genau derselbe
 * Grund, aus dem `VOLLZUG.fehlend` dort steht: eine Matrix, die schweigt,
 * behauptet Vollständigkeit.
 *
 * `tests/isolation/datenschutz-abdeckung.test.ts` hält diese Liste zusammen
 * mit `ORTE` gegen das Schema.
 *
 * **Die offene Frage ist O-71 und keine neue.** „Erasure concept (Art. 17):
 * which personal data is anonymised, on which trigger?" — genau das ist hier
 * zu entscheiden, und eine zweite Nummer daneben teilte eine Entscheidung in
 * zwei, die zusammen beantwortet wird.
 * // TODO(client, O-71): Brauchen abgeleitete Befunde, Zugangsdatensaetze und Zuordnungen eine eigene Loeschentscheidung, oder fallen sie mit ihrem Hauptsatz?
 */
export const NICHT_IN_DER_MATRIX: readonly {
  readonly tabelle: string; readonly grund: string;
}[] = [
  { tabelle: 'arbeitszeit_verstoss', grund: 'abgeleiteter Befund aus zeiteintrag' },
  { tabelle: 'planungs_konflikt', grund: 'abgeleiteter Befund aus dem Dienstplan' },
  { tabelle: 'nachweis_warnung', grund: 'abgeleiteter Befund aus nachweis' },
  { tabelle: 'da_pflicht', grund: 'abgeleitete Pflicht aus der Dienstanweisung' },
  { tabelle: 'benutzer', grund: 'Portalkonto — eigener Lebenszyklus (deaktiviert_am)' },
  { tabelle: 'checkin_token', grund: 'technische Marke, verfällt von selbst' },
  { tabelle: 'offline_ereignis', grund: 'Warteschlange, geht in zeiteintrag auf' },
  { tabelle: 'einsatz_zuordnung', grund: 'Zuordnung zum Einsatz' },
  { tabelle: 'zeitnachweis', grund: 'Monatsnachweis über zeiteintrag' },
  { tabelle: 'team_mitglied', grund: 'Zuordnung zum Team' },
  { tabelle: 'bewacher_eintrag', grund: '§ 34a GewO — Bewacherregister, eigene Frist' },
];

/**
 * Jeder Ort, über den diese Matrix etwas sagt — auch die, über die sie
 * ausdrücklich NICHTS sagt.
 *
 * Dieselbe Wache wie bei der Auskunft
 * (`tests/isolation/datenschutz-abdeckung.test.ts`). `audit_log` steht mit
 * drin, obwohl es keinen Personenbezug in einer Spalte trägt — es zählt über
 * `objekt_id`, und die Menge ist ein Obermengenvergleich.
 */
export const ABDECKUNG: ReadonlySet<string> = new Set([
  ...ORTE.map((o) => o.tabelle),
  ...NICHT_IN_DER_MATRIX.map((o) => o.tabelle),
]);

/** Eine Zeile der Entscheidungsmatrix. */
export interface Ort {
  readonly tabelle: string;
  readonly titel: string;
  /** Wie die Tabelle gegen harte Löschung gesichert ist — aus `rls.ts`. */
  readonly loeschart: Loeschart | null;
  readonly loeschartText: string;
  readonly sperre: Sperrgrund;
  readonly sperreText: string;
  /** Der Tag, an dem die Sperre fällt — `null`, wo keine Frist bekannt ist. */
  readonly sperreFaelltAm: Kalendertag | null;
  readonly zeilen: number;
  readonly recht: string | null;
  /** `true` heisst: das Recht fehlt, die Zahl ist KEINE Aussage. */
  readonly ungelesen: boolean;
  /** Die bereits getroffene Entscheidung, wenn es eine gibt. */
  readonly entscheidung: Entscheidungszeile | null;
}

export interface Entscheidungszeile {
  readonly id: string;
  readonly tabelle: string;
  readonly feld: string | null;
  readonly ergebnis: 'geschuldet' | 'ueberlagert' | 'offen' | 'anonymisierung';
  readonly rechtsgrundlage: string | null;
  readonly sperreFaelltAm: string | null;
  readonly offeneFrage: string | null;
  readonly bemerkung: string | null;
  readonly zeilen: number;
  readonly entschiedenAm: Date;
  readonly entschiedenVon: string | null;
}

export const ERGEBNIS_TEXT: Readonly<Record<Entscheidungszeile['ergebnis'], string>> = {
  geschuldet: 'Löschung geschuldet',
  ueberlagert: 'überlagert von einer Aufbewahrungspflicht',
  anonymisierung: 'Anonymisierung statt Löschung',
  offen: 'noch nicht entschieden',
};

/**
 * Was die Plattform heute wirklich ausführt — und was nicht.
 *
 * Gelesen aus `loeschkonzept.ts`: dort steht die EINE Wahrheit über die
 * löschenden Läufe, und sie wird aus dem Jobregister gefaltet. Hier steht der
 * Satz, den die Seite darüber sagt.
 */
export const VOLLZUG = {
  vorhanden: ['bewerber_loeschung — anonymisiert abgelaufene Bewerbungen (REC-07)'],
  fehlend: [
    'Keine Anonymisierungsprozedur für eine Person (`app.person_anonymisieren` '
    + 'ist in 02-CRM-OPERATIONS.md beschrieben und in der Datenbank nicht vorhanden)',
    'Kein Lauf, der `anonymisiert_am` auf `ansprechpartner` oder `kunde` setzt',
    'Kein Tombstone-Verfahren für eine Beschäftigte',
  ],
} as const;

function loeschartVon(tabelle: string): Loeschart | null {
  return KEIN_HARD_DELETE.find((l) => l.tabelle === tabelle)?.art ?? null;
}

function sperreText(s: Sperrgrund): string {
  switch (s.art) {
    case 'gesetz': return s.fundstelle;
    case 'unveraenderlich': return s.fundstelle;
    case 'offen': return `noch nicht entschieden (${s.frage})`;
    case 'keine': return 'keine Aufbewahrungspflicht bekannt';
  }
}

/**
 * Der Tag, an dem die Sperre fällt — der ERSTE, an dem gelöscht werden darf.
 *
 * Beide Rechenwege liefern diese eine Bedeutung; der Spaltenkommentar in
 * `0221` sagt sie ebenfalls. Vorher sagten `aoFrist` (Tag danach) und
 * `milogFrist` (letzter Tag der Aufbewahrung) zwei verschiedene Dinge in
 * dieselbe Spalte.
 */
function faelltAm(s: Sperrgrund, anker: Date | null): Kalendertag | null {
  if (s.art !== 'gesetz' || s.frist === null || anker === null) return null;
  const tag = berlinTag(anker);
  return s.frist === 'ao' ? aoFrist(tag) : milogFrist(tag);
}

/**
 * Die Matrix: je Ort, was dort steht und was der Löschung entgegensteht.
 *
 * Sie LÖSCHT nichts und schlägt nichts vor, was das Gesetz nicht nennt. Wo
 * keine Frist entschieden ist, steht die offene Frage — und die Zeile bleibt
 * ohne Ergebnis, bis ein Mensch sie setzt.
 */
export async function matrix(
  kontext: LeseKontext, anfrageId: string, zuordnung: Zuordnung,
): Promise<readonly Ort[]> {
  const art = zuordnung.art;
  if (art === 'keine' || zuordnung.id === null) return [];
  const anwendbar = ORTE.filter((o) => o.fuer.includes(art));

  const noetig = [...new Set(anwendbar
    .map((o) => o.recht).filter((r): r is string => r !== null))];
  const gehalten = new Map<string, boolean>();
  if (noetig.length > 0) {
    const zeilen = await kontext.abfrage<{ recht: string; ok: boolean }>(
      `select r as recht, app.hat_recht(r, app.aktiver_mandant()) as ok
         from unnest($1::text[]) as r`, [noetig]);
    for (const z of zeilen) gehalten.set(z.recht, z.ok);
  }

  const getroffen = new Map<string, Entscheidungszeile>();
  for (const e of await liste(kontext, anfrageId)) {
    if (e.feld === null) getroffen.set(e.tabelle, e);
  }

  const aus: Ort[] = [];
  for (const o of anwendbar) {
    const ungelesen = o.recht !== null && gehalten.get(o.recht) !== true;
    const [z] = ungelesen
      ? [{ zeilen: 0, anker: null }]
      : await kontext.abfrage<{ zeilen: number; anker: Date | null }>(
        o.sql, [zuordnung.id]);
    const art = loeschartVon(o.tabelle);
    aus.push({
      tabelle: o.tabelle,
      titel: o.titel,
      loeschart: art,
      loeschartText: art === null
        ? 'keine Löschsperre registriert' : LOESCHART_LABEL[art],
      sperre: o.sperre,
      sperreText: sperreText(o.sperre),
      sperreFaelltAm: faelltAm(o.sperre, z?.anker ?? null),
      zeilen: z?.zeilen ?? 0,
      recht: o.recht,
      ungelesen,
      entscheidung: getroffen.get(o.tabelle) ?? null,
    });
  }
  return aus;
}

/** Die getroffenen Entscheidungen eines Vorgangs. */
export async function liste(
  kontext: LeseKontext, anfrageId: string,
): Promise<readonly Entscheidungszeile[]> {
  return kontext.abfrage<Entscheidungszeile>(
    `select l.id, l.tabelle, l.feld, l.ergebnis::text as ergebnis,
            l.rechtsgrundlage,
            to_char(l.sperre_faellt_am, 'YYYY-MM-DD') as "sperreFaelltAm",
            l.offene_frage as "offeneFrage", l.bemerkung, l.zeilen,
            l.entschieden_am as "entschiedenAm", b.name as "entschiedenVon"
       from loeschentscheidung l
       left join benutzer b on b.id = l.entschieden_von
      where l.mandant_id = app.aktiver_mandant() and l.anfrage_id = $1::uuid
      order by l.tabelle, l.feld nulls first`, [anfrageId]);
}

export interface NeueEntscheidung {
  readonly tabelle: string;
  readonly feld?: string | null;
  readonly ergebnis: Entscheidungszeile['ergebnis'];
  readonly rechtsgrundlage?: string | null;
  readonly sperreFaelltAm?: string | null;
  readonly offeneFrage?: string | null;
  readonly bemerkung?: string | null;
  readonly zeilen?: number;
}

/**
 * Eine Entscheidung festhalten — je Tabelle und Feld genau eine.
 *
 * **Sie schreibt `on conflict … do update`, und das ist keine Bequemlichkeit.**
 * Eine Prüfung ist ein Vorgang über Tage: man entscheidet `zeiteintrag`, liest
 * nach, korrigiert. Zwei Zeilen zu derselben Tabelle wären zwei Entscheidungen,
 * und welche gilt, sagte die Sortierung. Die Spur der Änderung liegt im
 * `audit_log`; die Zeile hier ist der Stand.
 *
 * Die beiden Bedingungen der Tabelle (`ueberlagert` braucht eine Fundstelle,
 * `offen` eine benannte Frage) stehen hier noch einmal in Worten — damit die
 * Oberfläche einen Satz bekommt statt einer Constraint-Verletzung.
 */
export async function entscheide(
  kontext: SchreibKontext, anfrageId: string, e: NeueEntscheidung,
): Promise<void> {
  if (e.tabelle.trim() === '') {
    throw new LoeschFehler('Ohne Tabelle gibt es keine Entscheidung.', 'ohne_ort');
  }
  if (e.ergebnis === 'ueberlagert'
      && (e.rechtsgrundlage ?? '').trim() === '') {
    throw new LoeschFehler(
      'Eine überlagerte Löschung braucht die Fundstelle, die sie überlagert. '
      + '„Wir behalten das" ohne Grund ist vor einer Aufsicht dasselbe wie '
      + '„wir wissen es nicht".', 'ohne_fundstelle');
  }
  if (e.ergebnis === 'offen' && (e.offeneFrage ?? '').trim() === '') {
    throw new LoeschFehler(
      'Offen heisst: mit benannter offener Frage. Ohne sie ist es Schweigen.',
      'ohne_frage');
  }

  await kontext.schreibe(
    `insert into loeschentscheidung
       (mandant_id, anfrage_id, tabelle, feld, zeilen, ergebnis, rechtsgrundlage,
        sperre_faellt_am, offene_frage, bemerkung, entschieden_von)
     values (app.aktiver_mandant(), $1::uuid, $2, $3, $4,
             $5::loeschentscheidung_ergebnis, $6, $7::date, $8, $9,
             app.aktueller_benutzer())
     on conflict (mandant_id, anfrage_id, tabelle, coalesce(feld, ''))
     do update set zeilen = excluded.zeilen, ergebnis = excluded.ergebnis,
                   rechtsgrundlage = excluded.rechtsgrundlage,
                   sperre_faellt_am = excluded.sperre_faellt_am,
                   offene_frage = excluded.offene_frage,
                   bemerkung = excluded.bemerkung,
                   entschieden_am = now(),
                   entschieden_von = app.aktueller_benutzer()`,
    [anfrageId, e.tabelle.trim(),
      e.feld === undefined || e.feld === null || e.feld.trim() === ''
        ? null : e.feld.trim(),
      e.zeilen ?? 0, e.ergebnis,
      (e.rechtsgrundlage ?? '').trim() === '' ? null : (e.rechtsgrundlage ?? '').trim(),
      (e.sperreFaelltAm ?? '') === '' ? null : e.sperreFaelltAm,
      (e.offeneFrage ?? '').trim() === '' ? null : (e.offeneFrage ?? '').trim(),
      (e.bemerkung ?? '').trim() === '' ? null : (e.bemerkung ?? '').trim()]);
}
