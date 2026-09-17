/**
 * **Die Auskunft nach Art. 15 DSGVO — zusammengestellt, nie erfunden**
 * (LEG-09, Phase 7).
 *
 * Art. 15 Abs. 1 verlangt eine Bestätigung, ob Daten verarbeitet werden, und
 * wenn ja: die Daten selbst, die Zwecke, die Kategorien, die Empfänger, die
 * Speicherdauer und die Herkunft. Das ist keine Datei, die jemand schreibt,
 * sondern eine Abfrage über zwei Dutzend Tabellen — und genau deshalb steht sie
 * hier und nicht in einer Seite.
 *
 * **Der Fehler, gegen den diese Datei gebaut ist.** Der naheliegende Weg ist:
 * alle Abschnitte abfragen, zusammenfalten, ausliefern. Er ist falsch, und der
 * Grund ist unsichtbar. `datenschutz.auskunft_erstellen` ist im Katalog
 * einzeln bindbar; ein Träger dieses einen Rechts sieht `zeiteintrag` nicht
 * (`zeit.lesen`), `abwesenheit` nicht (`zeit.abwesenheit_lesen`), `nachweis`
 * nicht (`personal.nachweis_lesen`), `bewerbung` nicht
 * (`recruiting.bewerbung_lesen`) und `ansprechpartner` nicht (`crm.lesen`).
 * Die Datenbank antwortet auf all das korrekt mit null Zeilen. Eine Auskunft,
 * die daraus „keine Zeiteinträge vorhanden" macht, ist eine FALSCHE
 * AUSKUNFT — und sie sieht aus wie eine Antwort.
 *
 * Also: jeder Abschnitt nennt sein Recht, das Recht wird VORHER geprüft, und
 * ein Abschnitt ohne Recht ist `gesperrt` — nicht leer. Solange ein Abschnitt
 * gesperrt ist, ist die Auskunft `vollstaendig = false`, und der Abruf
 * verweigert sich (`/api/datenschutz/auskunft`). Lieber keine Datei als eine,
 * die halb ist und ganz aussieht.
 *
 * **Sie rechnet nichts und fragt kein Modell** (Invariante 6). Sie liest und
 * faltet. Die Fristen kommen aus `verzeichnis.ts`, die Zwecke aus
 * `registry/verarbeitungen.ts` — beides Register, die ein Mensch gelesen hat.
 *
 * **Der Hash über den Inhalt, die Uhr daneben** — dieselbe Bauart wie ACC-10
 * und das Verarbeitungsverzeichnis (D-485, D-589): zwei Abrufe desselben
 * Standes tragen denselben Abdruck.
 */
import { createHash } from 'node:crypto';
import type { LeseKontext } from '../../kontext/index.js';
import { VERARBEITUNGEN, type Verarbeitung } from '@/server/registry/verarbeitungen';
import { liesAufbewahrung } from '@/server/services/dokument/aufbewahrung';
import { fristText } from '@/server/services/datenschutz/verzeichnis';
import { markdownZelle } from '@/lib/markdown';
import { ART_TEXT, type AnfrageArt, type Zuordnung } from './anfrage.js';

/** Wie ein Abschnitt an seine Zeilen kommt. */
export type Leseweg =
  /** Direkt über die Policy des Mandanten — das Recht muss gehalten werden. */
  | 'policy'
  /** Über eine `SECURITY DEFINER`-Funktion, die ihr Recht selbst prüft. */
  | 'definer';

export interface Spalte {
  readonly kopf: string;
  readonly feld: string;
}

interface AbschnittDefinition {
  readonly schluessel: string;
  readonly titel: string;
  /** Die Verarbeitungstätigkeit aus dem Register — `null` bei keiner. */
  readonly verarbeitung: string | null;
  /** Die Tabelle(n), aus der die Zeilen kommen — so, wie sie heissen. */
  readonly quelle: string;
  readonly leseweg: Leseweg;
  /** Das Recht, ohne das die Datenbank null Zeilen liefert. */
  readonly recht: string | null;
  /** Für welche Art von Betroffenem der Abschnitt überhaupt gilt. */
  readonly fuer: readonly ('person' | 'ansprechpartner' | 'bewerbung')[];
  readonly spalten: readonly Spalte[];
  /** `$1` ist die Kennung des Betroffenen. */
  readonly sql: string;
}

/**
 * Die Abschnitte — abgeleitet aus dem, was WIRKLICH einen Personenbezug
 * trägt.
 *
 * Gezählt in der lebenden Datenbank: 24 Tabellen mit `person_id`, 23 mit
 * `anstellung_id`. Hier stehen die, in denen etwas über einen Menschen steht,
 * das er nicht selbst kennt — nicht die Verknüpfungstabellen und nicht die
 * Sichten, die dieselben Zeilen anders schneiden.
 *
 * **`nachweis` trägt kein `mandant_id`** (D-09: eine Qualifikation gehört dem
 * Menschen, nicht der Anstellung). Seine Policy bindet über
 * `app.person_sichtbar(person_id)`.
 */
const ABSCHNITTE: readonly AbschnittDefinition[] = [
  {
    schluessel: 'stammdaten',
    titel: 'Stammdaten der Person',
    verarbeitung: 'V-01',
    quelle: 'person',
    leseweg: 'policy',
    recht: null,
    fuer: ['person'],
    spalten: [
      { kopf: 'Vorname', feld: 'vorname' },
      { kopf: 'Nachname', feld: 'nachname' },
      { kopf: 'Telefon', feld: 'telefon' },
      { kopf: 'Sprache', feld: 'sprache' },
      { kopf: 'Angelegt', feld: 'erstellt_am' },
    ],
    /*
     * **Ohne Geburtsdatum — und das ist kein Weglassen, sondern ein
     * Spaltenrecht.** Seit `0190` sind `geburtsdatum`, `geburtsort` und
     * `staatsangehoerigkeit` `cse_app` als SELECT entzogen (01-KERN §11,
     * SEC-03): dieses `select` scheiterte sonst mit „permission denied for
     * table person" — mitten in einer Art.-15-Auskunft. Die drei Felder
     * stehen im eigenen Abschnitt darunter, ueber ihren Definer.
     */
    sql: `select vorname, nachname, telefon, sprache, erstellt_am
            from person where id = $1::uuid and geloescht_am is null`,
  },
  {
    schluessel: 'stammdaten_geschuetzt',
    titel: 'Geschützte Stammdaten (Bewacherregister)',
    verarbeitung: 'V-01',
    quelle: 'person (über app.person_stammdaten_lesen)',
    leseweg: 'definer',
    recht: 'personal.stammdaten_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Geburtsdatum', feld: 'geburtsdatum' },
      { kopf: 'Geburtsort', feld: 'geburtsort' },
      { kopf: 'Staatsangehörigkeit', feld: 'staatsangehoerigkeit' },
    ],
    /*
     * **Der einzige Weg zu diesen drei Feldern** (01-KERN §11, LEG-09).
     * `app.person_stammdaten_lesen` prueft `personal.stammdaten_lesen` im
     * aktiven Mandanten und schreibt eine Auditzeile mit Rechtsgrundlage — die
     * Auskunft nach Art. 15 ist selbst eine Verarbeitung und gehoert ins
     * Protokoll. Ohne das Recht bleibt der Abschnitt GESPERRT und sagt das:
     * eine Auskunft, die ein Feld stillschweigend weglaesst, ist unvollstaendig,
     * ohne es zu wissen.
     */
    sql: `select to_char(geburtsdatum, 'YYYY-MM-DD') as geburtsdatum,
                 geburtsort, staatsangehoerigkeit
            from app.person_stammdaten_lesen($1::uuid)`,
  },
  {
    schluessel: 'anstellung',
    titel: 'Anstellungen in dieser Gesellschaft',
    verarbeitung: 'V-01',
    quelle: 'anstellung',
    leseweg: 'policy',
    recht: null,
    fuer: ['person'],
    spalten: [
      { kopf: 'Personalnummer', feld: 'personalnummer' },
      { kopf: 'Eintritt', feld: 'eintritt' },
      { kopf: 'Austritt', feld: 'austritt' },
      { kopf: 'Arbeitszeitmodell', feld: 'arbeitszeitmodell' },
      { kopf: 'Wochenstunden', feld: 'wochenstunden' },
      { kopf: 'Status', feld: 'status' },
    ],
    /*
     * Der Stundensatz steht NICHT dabei: `anstellung.stundensatz_intern` ist
     * `cse_app` entzogen (K-05). Er gehoert trotzdem in eine Art.-15-Auskunft
     * — ueber `app.anstellung_entgelt_lesen`, mit eigenem Recht. Bis der
     * Abschnitt dafuer gebaut ist, sagt das Ergebnis das offen.
     * // TODO(client, O-642): Gehoert der interne Stundensatz in die Art.-15-Auskunft, oder ist er Kalkulationsdatum der Gesellschaft?
     */
    sql: `select personalnummer, eintritt, austritt,
                 arbeitszeitmodell::text as arbeitszeitmodell, wochenstunden,
                 status::text as status
            from anstellung
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
             and geloescht_am is null
           order by eintritt`,
  },
  {
    schluessel: 'zeiteintrag',
    titel: 'Arbeitszeitaufzeichnungen',
    verarbeitung: 'V-02',
    quelle: 'zeiteintrag',
    leseweg: 'policy',
    recht: 'zeit.lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Beginn', feld: 'beginn_zeitpunkt' },
      { kopf: 'Ende', feld: 'ende_zeitpunkt' },
      { kopf: 'Pause (Min.)', feld: 'pause_minuten' },
      { kopf: 'Netto (Min.)', feld: 'dauer_netto_minuten' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Storniert', feld: 'storniert_am' },
    ],
    /*
     * Nur die LEBENDE Fassung je Kette: `zeiteintrag` ist versioniert
     * (`kette_id`, `ersetzt_am`), und eine Auskunft, die jede Fassung
     * auflistet, gibt dieselbe Stunde fuenfmal heraus.
     */
    sql: `select beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
                 dauer_netto_minuten, status::text as status, storniert_am
            from zeiteintrag
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
             and ersetzt_am is null
           order by beginn_zeitpunkt desc`,
  },
  {
    schluessel: 'abwesenheit',
    titel: 'Abwesenheiten',
    verarbeitung: 'V-04',
    quelle: 'abwesenheit',
    leseweg: 'policy',
    recht: 'zeit.abwesenheit_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Von', feld: 'von' },
      { kopf: 'Bis', feld: 'bis' },
      { kopf: 'Angerechnete Tage', feld: 'tage_angerechnet' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Gemeldet', feld: 'gemeldet_am' },
    ],
    /*
     * Die ART der Abwesenheit steht NICHT dabei, und das ist nicht Nachlaessig-
     * keit: `abwesenheit.abwesenheitsart_id` sagt „Krankheit" oder „Kur", und
     * das ist eine gesundheitsnahe Angabe (Art. 9). Sie ist ueber
     * `app.abwesenheit_grund_lesen` mit eigenem Recht lesbar — ein eigener
     * Abschnitt, kein stiller Beitrag zu diesem.
     * // TODO(client, O-643): Gehoert die Abwesenheitsart (Art. 9) in die Art.-15-Auskunft, und mit welcher zusaetzlichen Pruefung?
     */
    sql: `select a.von, a.bis, a.tage_angerechnet, a.status::text as status,
                 a.gemeldet_am
            from abwesenheit a
            join anstellung an
              on an.id = a.anstellung_id and an.mandant_id = a.mandant_id
           where an.person_id = $1::uuid and a.mandant_id = app.aktiver_mandant()
           order by a.von desc`,
  },
  {
    schluessel: 'antrag',
    titel: 'Anträge (Urlaub, Tausch, Änderung)',
    verarbeitung: 'V-04',
    quelle: 'antrag',
    leseweg: 'policy',
    recht: 'zeit.abwesenheit_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Von', feld: 'von_datum' },
      { kopf: 'Bis', feld: 'bis_datum' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Nachricht', feld: 'nachricht' },
      { kopf: 'Eingereicht', feld: 'eingereicht_am' },
      { kopf: 'Entschieden', feld: 'entschieden_am' },
    ],
    sql: `select t.von_datum, t.bis_datum, t.status::text as status, t.nachricht,
                 t.eingereicht_am, t.entschieden_am
            from antrag t
            join anstellung an
              on an.id = t.anstellung_id and an.mandant_id = t.mandant_id
           where an.person_id = $1::uuid and t.mandant_id = app.aktiver_mandant()
           order by t.eingereicht_am desc nulls last`,
  },
  {
    schluessel: 'stundenkonto',
    titel: 'Stundenkonten je Monat',
    verarbeitung: 'V-02',
    quelle: 'stundenkonto',
    leseweg: 'policy',
    recht: 'zeit.konto_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Jahr', feld: 'jahr' },
      { kopf: 'Monat', feld: 'monat' },
      { kopf: 'Soll (Min.)', feld: 'soll_minuten' },
      { kopf: 'Ist (Min.)', feld: 'ist_minuten' },
      { kopf: 'Saldo (Min.)', feld: 'saldo_minuten' },
      { kopf: 'Status', feld: 'status' },
    ],
    sql: `select k.jahr, k.monat, k.soll_minuten, k.ist_minuten, k.saldo_minuten,
                 k.status::text as status
            from stundenkonto k
            join anstellung an
              on an.id = k.anstellung_id and an.mandant_id = k.mandant_id
           where an.person_id = $1::uuid and k.mandant_id = app.aktiver_mandant()
           order by k.jahr desc, k.monat desc`,
  },
  {
    schluessel: 'urlaubskonto',
    titel: 'Urlaubskonten je Jahr',
    verarbeitung: 'V-04',
    quelle: 'urlaubskonto',
    leseweg: 'policy',
    recht: 'zeit.konto_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Jahr', feld: 'jahr' },
      { kopf: 'Anspruch (Tage)', feld: 'anspruch_tage' },
      { kopf: 'Übertrag (Tage)', feld: 'uebertrag_tage' },
      { kopf: 'Genommen (Tage)', feld: 'genommen_tage' },
      { kopf: 'Rest (Tage)', feld: 'rest_tage' },
    ],
    sql: `select u.jahr, u.anspruch_tage, u.uebertrag_tage, u.genommen_tage,
                 u.rest_tage
            from urlaubskonto u
            join anstellung an
              on an.id = u.anstellung_id and an.mandant_id = u.mandant_id
           where an.person_id = $1::uuid and u.mandant_id = app.aktiver_mandant()
           order by u.jahr desc`,
  },
  {
    schluessel: 'nachweis',
    titel: 'Qualifikationsnachweise',
    verarbeitung: 'V-01',
    quelle: 'nachweis',
    leseweg: 'policy',
    recht: 'personal.nachweis_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Nummer', feld: 'nummer' },
      { kopf: 'Ausstellende Stelle', feld: 'ausstellende_stelle' },
      { kopf: 'Ausgestellt', feld: 'ausgestellt_am' },
      { kopf: 'Gültig bis', feld: 'gueltig_bis' },
      { kopf: 'Status', feld: 'status' },
    ],
    sql: `select nummer, ausstellende_stelle, ausgestellt_am, gueltig_bis,
                 status::text as status
            from nachweis where person_id = $1::uuid
           order by ausgestellt_am desc nulls last`,
  },
  {
    schluessel: 'kenntnisnahme',
    titel: 'Bestätigte Dienstanweisungen',
    verarbeitung: 'V-09',
    quelle: 'da_kenntnisnahme',
    leseweg: 'policy',
    recht: 'dienstanweisung.lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Bestätigt', feld: 'bestaetigt_am' },
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Sprache', feld: 'sprache' },
      { kopf: 'Nachgetragen', feld: 'nachgetragen' },
      { kopf: 'IP', feld: 'ip' },
    ],
    sql: `select bestaetigt_am, art::text as art, sprache, nachgetragen, ip::text as ip
            from da_kenntnisnahme
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by bestaetigt_am desc`,
  },
  {
    schluessel: 'wachbuch',
    titel: 'Wachbucheinträge, die diese Person erfasst hat',
    verarbeitung: 'V-09',
    quelle: 'wachbuch_eintrag',
    leseweg: 'policy',
    recht: 'wachbuch.lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Erfasst', feld: 'erfasst_am' },
      { kopf: 'Laufnummer', feld: 'laufnummer' },
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Betreff', feld: 'betreff' },
      { kopf: 'Storniert', feld: 'storniert_am' },
    ],
    sql: `select erfasst_am, laufnummer, art::text as art, betreff, storniert_am
            from wachbuch_eintrag
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by erfasst_am desc`,
  },
  {
    schluessel: 'schluessel',
    titel: 'Schlüsselquittungen',
    verarbeitung: 'V-09',
    quelle: 'schluessel_quittung',
    leseweg: 'policy',
    recht: 'schluessel.lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Quittiert', feld: 'quittiert_am' },
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Empfängername', feld: 'empfaenger_name' },
      { kopf: 'Geplante Rückgabe', feld: 'geplante_rueckgabe' },
    ],
    sql: `select quittiert_am, art::text as art, empfaenger_name, geplante_rueckgabe
            from schluessel_quittung
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by quittiert_am desc`,
  },
  {
    schluessel: 'zugang',
    titel: 'Mitarbeiterzugang (Telefonnummer, letzte Anmeldung)',
    verarbeitung: 'V-10',
    quelle: 'mitarbeiter_zugang',
    leseweg: 'policy',
    recht: null,
    fuer: ['person'],
    spalten: [
      { kopf: 'Telefonnummer', feld: 'telefon_e164' },
      { kopf: 'Gesperrt', feld: 'gesperrt_am' },
      { kopf: 'Letzte Anmeldung', feld: 'letzter_login_am' },
      { kopf: 'Angelegt', feld: 'erstellt_am' },
    ],
    sql: `select telefon_e164, gesperrt_am, letzter_login_am, erstellt_am
            from mitarbeiter_zugang where person_id = $1::uuid`,
  },
  {
    schluessel: 'benachrichtigung',
    titel: 'Benachrichtigungen im Portal',
    verarbeitung: 'V-10',
    quelle: 'benachrichtigung (über app.benachrichtigung_auskunft)',
    leseweg: 'definer',
    recht: 'datenschutz.auskunft_erstellen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Erstellt', feld: 'erstellt_am' },
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Titel', feld: 'titel' },
      { kopf: 'Text', feld: 'text' },
      { kopf: 'Gelesen', feld: 'gelesen_am' },
    ],
    /*
     * **Der einzige Weg.** `benachrichtigung` hat fuer `cse_app` genau eine
     * Lesepolicy: `empfaenger_id = app.aktueller_benutzer()`. Ein direktes
     * `select` ueber eine FREMDE Person liefert null Zeilen — nicht „keine
     * Benachrichtigungen", sondern „diese Sitzung ist nicht diese Person".
     * `app.benachrichtigung_auskunft` (0221) prueft das Recht und
     * protokolliert den Abruf.
     */
    sql: `select erstellt_am, art, titel, text, gelesen_am
            from app.benachrichtigung_auskunft($1::uuid)`,
  },
  {
    schluessel: 'kontakt',
    titel: 'Kontaktdaten als Ansprechpartner',
    verarbeitung: 'V-06',
    quelle: 'ansprechpartner',
    leseweg: 'policy',
    recht: 'crm.lesen',
    fuer: ['ansprechpartner'],
    spalten: [
      { kopf: 'Anrede', feld: 'anrede' },
      { kopf: 'Vorname', feld: 'vorname' },
      { kopf: 'Nachname', feld: 'nachname' },
      { kopf: 'Position', feld: 'position' },
      { kopf: 'E-Mail', feld: 'email' },
      { kopf: 'Telefon', feld: 'telefon' },
      { kopf: 'Kunde', feld: 'kunde' },
    ],
    sql: `select ap.anrede, ap.vorname, ap.nachname, ap.position, ap.email,
                 ap.telefon, k.name as kunde
            from ansprechpartner ap
            left join kunde k on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
           where ap.id = $1::uuid and ap.mandant_id = app.aktiver_mandant()`,
  },
  {
    schluessel: 'rechtsgrundlage',
    titel: 'Werberechtliche Einstufung und Widersprüche',
    verarbeitung: 'V-06',
    quelle: 'ansprechpartner (über app.widerspruch_stand)',
    leseweg: 'definer',
    recht: 'datenschutz.auskunft_erstellen',
    fuer: ['ansprechpartner'],
    spalten: [
      { kopf: 'Rechtsgrundlage', feld: 'rechtsgrundlage' },
      { kopf: 'Werbewiderspruch', feld: 'werbewiderspruch_am' },
      { kopf: 'Widerspruch (Art. 21)', feld: 'widerspruch_am' },
    ],
    /*
     * K-05: `cse_app` hat auf diesen drei Spalten nur INSERT und UPDATE, kein
     * SELECT. Ein direktes `select ap.rechtsgrundlage` scheitert nicht still,
     * es scheitert LAUT — „permission denied for column". Genau deshalb der
     * Definer-Weg (0222).
     */
    sql: `select rechtsgrundlage, werbewiderspruch_am, widerspruch_am
            from app.widerspruch_stand($1::uuid, null)`,
  },
  {
    schluessel: 'widerspruchsprotokoll',
    titel: 'Protokoll der erklärten Widersprüche',
    verarbeitung: 'V-06',
    quelle: 'werbewiderspruch',
    leseweg: 'policy',
    recht: 'crm.rechtsgrundlage_lesen',
    fuer: ['ansprechpartner'],
    spalten: [
      { kopf: 'Eingegangen', feld: 'eingegangen_am' },
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Kanal', feld: 'kanal' },
      { kopf: 'Weg', feld: 'quelle' },
      { kopf: 'Bemerkung', feld: 'bemerkung' },
    ],
    sql: `select eingegangen_am, art::text as art, kanal, quelle::text as quelle,
                 bemerkung
            from werbewiderspruch
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()
           order by eingegangen_am desc`,
  },
  {
    schluessel: 'bewerbung',
    titel: 'Bewerbung',
    verarbeitung: 'V-05',
    quelle: 'bewerbung',
    leseweg: 'policy',
    recht: 'recruiting.bewerbung_lesen',
    fuer: ['bewerbung'],
    spalten: [
      { kopf: 'Name', feld: 'name' },
      { kopf: 'E-Mail', feld: 'email' },
      { kopf: 'Telefon', feld: 'telefon' },
      { kopf: 'Nachricht', feld: 'nachricht' },
      { kopf: 'Stelle', feld: 'stelle' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Eingegangen', feld: 'eingegangen_am' },
      { kopf: 'Aufbewahrung bis', feld: 'aufbewahrung_bis' },
    ],
    sql: `select b.name, b.email, b.telefon, b.nachricht, s.titel as stelle,
                 b.status::text as status, b.eingegangen_am, b.aufbewahrung_bis
            from bewerbung b
            left join stelle s on s.mandant_id = b.mandant_id and s.id = b.stelle_id
           where b.id = $1::uuid and b.mandant_id = app.aktiver_mandant()
             and b.geloescht_am is null`,
  },
  {
    schluessel: 'bewerbung_bewertung',
    titel: 'Bewertungen der Bewerbung',
    verarbeitung: 'V-05',
    quelle: 'bewerbung_bewertung',
    leseweg: 'policy',
    recht: 'recruiting.bewerbung_lesen',
    fuer: ['bewerbung'],
    spalten: [
      { kopf: 'Kriterium', feld: 'kriterium' },
      { kopf: 'Gewicht', feld: 'gewicht' },
      { kopf: 'Punkte', feld: 'punkte' },
      { kopf: 'Begründung', feld: 'begruendung' },
      { kopf: 'Erstellt', feld: 'erstellt_am' },
    ],
    sql: `select kriterium, gewicht, punkte, begruendung, erstellt_am
            from bewerbung_bewertung
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by erstellt_am`,
  },
  {
    schluessel: 'gespraech',
    titel: 'Gespräche und Notizen',
    verarbeitung: 'V-05',
    quelle: 'gespraech',
    leseweg: 'policy',
    recht: 'recruiting.bewerbung_lesen',
    fuer: ['bewerbung'],
    spalten: [
      { kopf: 'Termin', feld: 'termin' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Ort', feld: 'ort' },
      { kopf: 'Notiz', feld: 'notiz' },
    ],
    sql: `select termin, status::text as status, ort, notiz
            from gespraech
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by termin desc nulls last`,
  },
  {
    schluessel: 'bewerbung_antwort',
    titel: 'Antworten an die Bewerberin',
    verarbeitung: 'V-05',
    quelle: 'bewerbung_antwort',
    leseweg: 'policy',
    recht: 'recruiting.bewerbung_lesen',
    fuer: ['bewerbung'],
    spalten: [
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Stand', feld: 'stand' },
      { kopf: 'Betreff', feld: 'betreff' },
      { kopf: 'Gesendet', feld: 'gesendet_am' },
      { kopf: 'An', feld: 'gesendet_an' },
    ],
    sql: `select art::text as art, stand::text as stand, betreff, gesendet_am,
                 gesendet_an
            from bewerbung_antwort
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by erstellt_am desc`,
  },
];

/**
 * Was diese Auskunft NICHT beantwortet — als eigener Abschnitt, nicht als
 * Lücke.
 *
 * O-113 ist offen: wie ein Art.-15-Begehren auf Agentenprotokolle,
 * Wissens-Chunks und Freigabe-Snapshots wirkt, wenn GoBD und § 147 AO
 * gleichzeitig Aufbewahrung verlangen. Eine Auskunft, die diese Tabellen
 * stillschweigend auslässt, behauptet, es gäbe dort nichts. Sie steht deshalb
 * hier, mit dem Satz, dass der Umfang offen ist.
 *
 * // TODO(client, O-113): Wie wirkt ein Art.-15-Begehren auf Agentenprotokolle, Wissens-Chunks und Freigabe-Snapshots?
 */
const OFFENE_ABSCHNITTE: readonly {
  readonly schluessel: string; readonly titel: string;
  readonly quelle: string; readonly frage: string;
}[] = [
  {
    schluessel: 'agentenlauf',
    titel: 'Agentenläufe, Wissens-Chunks, Freigabe-Snapshots',
    quelle: 'agent_lauf · wissens_chunk · freigabe',
    frage: 'O-113',
  },
];

export interface AuskunftAbschnitt {
  readonly schluessel: string;
  readonly titel: string;
  /** Wozu — aus dem Register der Verarbeitungstätigkeiten, nicht erfunden. */
  readonly zweck: string;
  readonly quelle: string;
  readonly frist: string;
  readonly recht: string | null;
  readonly leseweg: Leseweg | 'offen';
  /** `true` heisst: das Recht fehlt, der Abschnitt ist NICHT leer. */
  readonly gesperrt: boolean;
  /** Die offene Frage, wo es eine gibt — `null` sonst. */
  readonly offen: string | null;
  readonly kopf: readonly string[];
  readonly zeilen: readonly (readonly string[])[];
}

export interface Auskunft {
  readonly mandantId: string;
  readonly firma: string;
  readonly anfrageId: string;
  readonly art: AnfrageArt;
  readonly betroffener: Zuordnung;
  readonly abschnitte: readonly AuskunftAbschnitt[];
  /** Die Rechte, die für einen Abschnitt fehlen — leer heisst vollständig. */
  readonly fehlendeRechte: readonly string[];
  readonly vollstaendig: boolean;
  readonly zeilen: number;
  readonly sha256: string;
  readonly erstelltAm: string;
}

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});
const BERLIN_TAG = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

/**
 * Ein Datenbankwert als Text für die Auskunft.
 *
 * **Zeitpunkte in `Europe/Berlin`** (Invariante 2): ein Zeitstempel in UTC ist
 * für die betroffene Person eine falsche Uhrzeit, und bei einer Nachtschicht
 * ein falscher Tag.
 *
 * **Ein reines Datum bleibt ein Datum.** `date` kommt als Zeichenkette
 * `YYYY-MM-DD` aus dem Treiber und wird NICHT durch eine Zeitzone gedreht —
 * genau daran verschiebt sich ein Eintrittsdatum um einen Tag.
 */
export function alsText(wert: unknown): string {
  if (wert === null || wert === undefined) return '—';
  if (wert instanceof Date) return BERLIN.format(wert);
  if (typeof wert === 'boolean') return wert ? 'ja' : 'nein';
  if (typeof wert === 'number') return String(wert);
  const text = String(wert);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    const [j, m, t] = text.split('-');
    return BERLIN_TAG.format(new Date(Date.UTC(Number(j), Number(m) - 1, Number(t), 12)));
  }
  return text === '' ? '—' : text;
}

/** Kanonische Form: stabile Reihenfolge, keine Uhr, kein Vermerk über den Leser. */
function kanonisch(a: readonly AuskunftAbschnitt[]): string {
  return JSON.stringify(a.map((x) => ({
    schluessel: x.schluessel, gesperrt: x.gesperrt, offen: x.offen,
    kopf: x.kopf, zeilen: x.zeilen,
  })));
}

function verarbeitungOder(nummer: string | null): Verarbeitung | undefined {
  return nummer === null
    ? undefined : VERARBEITUNGEN.find((v) => v.nummer === nummer);
}

/**
 * Die Auskunft zusammenstellen.
 *
 * Sie braucht eine ZUGEORDNETE Anfrage: ohne Zuordnung weiss niemand, wessen
 * Daten gemeint sind, und die naheliegende Abkürzung — nach der E-Mail-Adresse
 * suchen — ist der Fehler, den Art. 12 Abs. 6 gerade verhindern will. Die
 * Zuordnung trifft ein Mensch (`anfrage.ordneZu`).
 */
export async function erstelleAuskunft(
  kontext: LeseKontext, anfrageId: string, zuordnung: Zuordnung, jetzt: Date,
): Promise<Auskunft> {
  const [kopf] = await kontext.abfrage<{
    art: AnfrageArt; mandant_id: string; firma: string;
  }>(
    `select b.art::text as art, b.mandant_id, m.firma
       from betroffenenanfrage b
       join mandant m on m.id = b.mandant_id
      where b.mandant_id = app.aktiver_mandant() and b.id = $1::uuid`, [anfrageId]);
  if (kopf === undefined) {
    throw new Error('Diese Betroffenenanfrage ist nicht lesbar.');
  }

  /*
   * Die Art in eine eigene Konstante: `zuordnung.art` ist `ZuordnungArt` und
   * schliesst `'keine'` ein — die Verengung im Ternaeroperator wirkt nicht in
   * den Rueckruf des `filter` hinein.
   */
  const art = zuordnung.art;
  const anwendbar = art === 'keine'
    ? [] : ABSCHNITTE.filter((d) => d.fuer.includes(art));

  /**
   * **Die Rechte in EINER Abfrage, vor der ersten Datenabfrage.**
   *
   * Ein Abschnitt je Rundreise wäre nicht nur langsamer — er würde die
   * Prüfung zwischen die Lesungen legen, und dann entscheidet die
   * Reihenfolge, was gesperrt aussieht. `app.hat_recht` NIMMT den Mandanten
   * (K-03).
   */
  const noetig = [...new Set(anwendbar
    .map((d) => d.recht)
    .filter((r): r is string => r !== null))];
  const gehalten = new Map<string, boolean>();
  if (noetig.length > 0) {
    const zeilen = await kontext.abfrage<{ recht: string; ok: boolean }>(
      `select r as recht, app.hat_recht(r, app.aktiver_mandant()) as ok
         from unnest($1::text[]) as r`, [noetig]);
    for (const z of zeilen) gehalten.set(z.recht, z.ok);
  }

  const regeln = await liesAufbewahrung({
    abfrage: kontext.abfrage.bind(kontext),
  });
  const [einstellung] = await kontext.abfrage<{ tage: number | null }>(
    `select (app.plattform_einstellung('recruiting.aufbewahrung_tage') #>> '{}')::int as tage`);
  const tageBewerbung = einstellung?.tage ?? null;

  const abschnitte: AuskunftAbschnitt[] = [];
  const fehlend = new Set<string>();

  for (const d of anwendbar) {
    const v = verarbeitungOder(d.verarbeitung);
    const frist = v === undefined
      ? 'noch nicht entschieden (O-514)'
      : fristText(v, regeln, tageBewerbung);
    const zweck = v === undefined ? 'nicht im Register geführt' : v.zweck;
    const gesperrt = d.recht !== null && gehalten.get(d.recht) !== true;
    if (gesperrt && d.recht !== null) fehlend.add(d.recht);

    const zeilen = gesperrt || zuordnung.id === null
      ? []
      : (await kontext.abfrage<Record<string, unknown>>(d.sql, [zuordnung.id]))
        .map((r) => d.spalten.map((s) => alsText(r[s.feld])));

    abschnitte.push({
      schluessel: d.schluessel, titel: d.titel, zweck, quelle: d.quelle,
      frist, recht: d.recht, leseweg: d.leseweg, gesperrt, offen: null,
      kopf: d.spalten.map((s) => s.kopf), zeilen,
    });
  }

  for (const o of OFFENE_ABSCHNITTE) {
    abschnitte.push({
      schluessel: o.schluessel, titel: o.titel,
      zweck: 'noch nicht entschieden — der Umfang ist offen',
      quelle: o.quelle, frist: 'noch nicht entschieden',
      recht: null, leseweg: 'offen', gesperrt: false, offen: o.frage,
      kopf: [], zeilen: [],
    });
  }

  const zeilenZahl = abschnitte.reduce((n, a) => n + a.zeilen.length, 0);
  const sha256 = createHash('sha256').update(kanonisch(abschnitte), 'utf8').digest('hex');

  return {
    mandantId: kopf.mandant_id,
    firma: kopf.firma,
    anfrageId,
    art: kopf.art,
    betroffener: zuordnung,
    abschnitte,
    fehlendeRechte: [...fehlend].sort(),
    vollstaendig: fehlend.size === 0 && zuordnung.art !== 'keine',
    zeilen: zeilenZahl,
    sha256,
    erstelltAm: new Intl.DateTimeFormat('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Berlin', timeZoneName: 'short',
    }).format(jetzt),
  };
}

/** Die Auskunft als Markdown — das, was ein Mensch weitergibt. */
export function alsMarkdown(a: Auskunft): string {
  const z: string[] = [
    `# Auskunft nach Art. 15 DSGVO — ${a.firma}`,
    '',
    `Betroffene Person: **${a.betroffener.name ?? '(nicht lesbar)'}** `
    + `(${a.betroffener.art})`,
    '',
    `Anfrage: ${ART_TEXT[a.art].kurz} · erstellt ${a.erstelltAm}`,
    '',
    `Prüfsumme des Inhalts: \`${a.sha256}\``,
    '',
  ];
  if (!a.vollstaendig) {
    z.push(
      '> **Diese Auskunft ist UNVOLLSTÄNDIG.** Für die unten als gesperrt '
      + 'gekennzeichneten Abschnitte fehlen die Leserechte '
      + `(${a.fehlendeRechte.join(', ')}). Sie darf in dieser Form nicht `
      + 'herausgegeben werden.', '');
  }
  for (const s of a.abschnitte) {
    z.push(`## ${s.titel}`, '',
      `*Zweck:* ${s.zweck}`, '',
      `*Quelle:* \`${s.quelle}\` · *Aufbewahrung:* ${s.frist}`, '');
    if (s.offen !== null) {
      z.push(`**Der Umfang dieses Abschnitts ist offen (${s.offen}).** Er wird `
        + 'hier benannt und nicht beantwortet — eine Auskunft, die diese Daten '
        + 'stillschweigend auslässt, behauptet, es gäbe sie nicht.', '');
      continue;
    }
    if (s.gesperrt) {
      z.push(`**Gesperrt:** dieser Abschnitt braucht \`${s.recht ?? ''}\`. `
        + 'Er ist nicht leer — er ist ungelesen.', '');
      continue;
    }
    if (s.zeilen.length === 0) {
      z.push('*Keine Zeile — zu dieser Person ist hier nichts gespeichert.*', '');
      continue;
    }
    z.push(`| ${s.kopf.join(' | ')} |`,
      `|${s.kopf.map(() => '---').join('|')}|`,
      ...s.zeilen.map((r) => `| ${r.map(markdownZelle).join(' | ')} |`), '');
  }
  return z.join('\n');
}

/**
 * Das Artefakt festhalten (SEC-A9).
 *
 * **Warum das Speichern zur Erstellung gehört und nicht zum Versand.** Was
 * ausgehändigt wurde, ist im Streitfall die Frage — nicht, DASS geantwortet
 * wurde. Ohne diese Zeile gibt es die Prüfsumme nur in der Datei, die das Haus
 * verlassen hat, und ein Abdruck, den nur die Gegenseite hat, ist keiner.
 *
 * Die Zeile entsteht auch für eine UNVOLLSTÄNDIGE Auskunft, wenn eine erzeugt
 * wurde: der Versuch ist Teil des Vorgangs. `vollstaendig` steht daneben.
 */
export async function halteFest(
  kontext: { schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]> },
  auskunft: Auskunft, format: 'md' | 'json',
): Promise<void> {
  await kontext.schreibe(
    `insert into datenschutz_auskunft
       (mandant_id, anfrage_id, format, umfang, abschnitte, zeilen, vollstaendig,
        sha256, erzeugt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::datenschutz_auskunft_format,
             $3::jsonb, $4, $5, $6, $7, app.aktueller_benutzer())`,
    [auskunft.anfrageId, format,
      {
        betroffener: auskunft.betroffener.art,
        fehlendeRechte: auskunft.fehlendeRechte,
        abschnitte: auskunft.abschnitte.map((s) => ({
          schluessel: s.schluessel, zeilen: s.zeilen.length,
          gesperrt: s.gesperrt, offen: s.offen,
        })),
      },
      auskunft.abschnitte.length, auskunft.zeilen, auskunft.vollstaendig,
      auskunft.sha256]);
}

/** Die erteilten Auskünfte eines Vorgangs — der Nachweis in der Akte. */
export interface AuskunftZeile {
  readonly id: string;
  readonly format: string;
  readonly abschnitte: number;
  readonly zeilen: number;
  readonly vollstaendig: boolean;
  readonly sha256: string;
  readonly erzeugtAm: Date;
  readonly erzeugtVon: string | null;
}

export async function erteilte(
  kontext: LeseKontext, anfrageId: string,
): Promise<readonly AuskunftZeile[]> {
  return kontext.abfrage<AuskunftZeile>(
    `select a.id, a.format::text as format, a.abschnitte, a.zeilen,
            a.vollstaendig, a.sha256, a.erzeugt_am as "erzeugtAm",
            b.name as "erzeugtVon"
       from datenschutz_auskunft a
       left join benutzer b on b.id = a.erzeugt_von
      where a.mandant_id = app.aktiver_mandant() and a.anfrage_id = $1::uuid
      order by a.erzeugt_am desc`, [anfrageId]);
}
