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
import { NichtGefundenFehler } from '@/server/auth/fehler';
import type { LeseKontext } from '../../kontext/index.js';
import { VERARBEITUNGEN, type Verarbeitung } from '@/server/registry/verarbeitungen';
import { liesAufbewahrung } from '@/server/services/dokument/aufbewahrung';
import { fristText } from '@/server/services/datenschutz/verzeichnis';
import { markdownZelle } from '@/lib/markdown';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
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
  /** `geld`: ganze Cent aus der Datenbank, angezeigt als Euro (Invariante 1). */
  readonly format?: 'geld';
}

interface AbschnittDefinition {
  readonly schluessel: string;
  readonly titel: string;
  /** Die Verarbeitungstätigkeit aus dem Register — `null` bei keiner. */
  readonly verarbeitung: string | null;
  /** Die Tabelle(n), aus der die Zeilen kommen — so, wie sie heissen. */
  readonly quelle: string;
  /**
   * Dieselben Tabellen, maschinenlesbar — die Grundlage der Wache.
   *
   * `quelle` ist ein Satz für einen Menschen („person (über
   * app.person_stammdaten_lesen)"). Die Wache in
   * `tests/isolation/datenschutz-abdeckung.test.ts` stellt jede Tabelle des
   * Schemas mit `person_id`, `ansprechpartner_id` oder `bewerbung_id` GEGEN
   * diese Liste und fällt, sobald eine neue Migration eine dazulegt. Ohne
   * diese Angabe müsste sie den Satz parsen — und wäre damit grün, sobald
   * jemand die Formulierung ändert.
   */
  readonly tabellen: readonly string[];
  readonly leseweg: Leseweg;
  /** Das Recht, ohne das die Datenbank null Zeilen liefert. */
  readonly recht: string | null;
  /** Für welche Art von Betroffenem der Abschnitt überhaupt gilt. */
  readonly fuer: readonly ('person' | 'ansprechpartner' | 'bewerbung')[];
  readonly spalten: readonly Spalte[];
  /** `$1` ist die Kennung des Betroffenen. */
  readonly sql: string;
  /**
   * `art9`: der Abschnitt kommt nur auf ausdrückliche Mitgabe hinein — nie im
   * Standardexport (O-643, D-791, D-855). Ohne Mitgabe steht er als
   * „nicht mitgegeben" da, nicht als leer und nicht als gesperrt.
   */
  readonly mitgabe?: 'art9';
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
    tabellen: ['person'],
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
    tabellen: ['person'],
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
    tabellen: ['anstellung'],
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
     * Der Stundensatz steht im eigenen Abschnitt `entgelt` darunter:
     * `anstellung.stundensatz_intern` ist `cse_app` entzogen (K-05), und ein
     * eigenes Recht gehoert zu einem eigenen Abschnitt — sonst waere hier
     * entweder alles gesperrt oder der Satz still weg (V-332, D-855).
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
    schluessel: 'entgelt',
    titel: 'Interner Stundensatz',
    verarbeitung: 'V-01',
    quelle: 'anstellung_kondition (über app.auskunft_entgelt)',
    tabellen: ['anstellung_kondition'],
    leseweg: 'definer',
    recht: 'personal.entgelt_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Personalnummer', feld: 'personalnummer' },
      { kopf: 'Gilt ab', feld: 'gilt_ab' },
      { kopf: 'Gilt bis', feld: 'gilt_bis' },
      { kopf: 'Stundensatz (intern)', feld: 'stundensatz_cent', format: 'geld' },
      { kopf: 'Quelle', feld: 'quelle' },
    ],
    /*
     * Voreinstellung (O-642, D-791; Pruefstand PR #35): der Satz GEHOERT in
     * die Auskunft — ein Satz an einer Beschaeftigung ist ein Datum ueber den
     * Menschen (Art. 4 Nr. 1, Art. 15 DSGVO), auch wenn er zugleich
     * Kalkulationsdatum der Gesellschaft ist. Alle datierten Saetze, nicht nur
     * der heutige; eine Beschaeftigung ohne Kondition mit dem Spiegel aus den
     * Stammdaten. Der Definer prueft `personal.entgelt_lesen` und schreibt eine
     * Protokollzeile je Abruf; fehlt das Recht, ist der Abschnitt gesperrt.
     * // TODO(client, O-642): Voreinstellung — der interne Stundensatz gehoert in die Art.-15-Auskunft, alle datierten Saetze, ueber den beschraenkten Leser mit eigenem Recht (D-855).
     */
    sql: `select personalnummer, gilt_ab, gilt_bis, stundensatz_cent,
                 case quelle when 'kondition' then 'Kondition'
                             else 'Stammdaten (vor der datierten Kondition)' end as quelle
            from app.auskunft_entgelt($1::uuid)`,
  },
  {
    schluessel: 'zeiteintrag',
    titel: 'Arbeitszeitaufzeichnungen',
    verarbeitung: 'V-02',
    quelle: 'zeiteintrag',
    tabellen: ['zeiteintrag'],
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
    tabellen: ['abwesenheit'],
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
     * Die ART der Abwesenheit steht NICHT hier: `abwesenheit.abwesenheitsart_id`
     * sagt „Krankheit" oder „Kur", und das ist eine gesundheitsnahe Angabe
     * (Art. 9). Sie steht im eigenen Abschnitt `abwesenheitsgrund` darunter —
     * hinter eigenem Recht und nur auf ausdrueckliche Mitgabe (V-332, D-855).
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
    schluessel: 'abwesenheitsgrund',
    titel: 'Art der Abwesenheiten (Art. 9 DSGVO)',
    verarbeitung: 'V-04',
    quelle: 'abwesenheit, abwesenheitsart (über app.auskunft_abwesenheitsgruende)',
    tabellen: ['abwesenheit', 'abwesenheitsart'],
    leseweg: 'definer',
    recht: 'zeit.abwesenheit_grund_lesen',
    fuer: ['person'],
    mitgabe: 'art9',
    spalten: [
      { kopf: 'Von', feld: 'von' },
      { kopf: 'Bis', feld: 'bis' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Gesundheitsbezogen', feld: 'gesundheitsbezogen' },
      { kopf: 'AU-Bescheinigung', feld: 'au_bescheinigung_vorliegt' },
      { kopf: 'Bescheinigung bis', feld: 'au_bis' },
      { kopf: 'Bemerkung', feld: 'bemerkung' },
      { kopf: 'Urlaubstage gutgeschrieben (§ 9 BUrlG)', feld: 'urlaub_gutgeschrieben_tage' },
    ],
    /*
     * Voreinstellung (O-643, D-791): die Art gehoert in die Auskunft — Art. 15
     * kennt keine Ausnahme fuer Art.-9-Daten —, aber als EIGENER Abschnitt
     * hinter eigenem Recht, den die sachbearbeitende Person ausdruecklich
     * mitgibt; nie als stiller Beitrag zum Standardexport. Der Definer prueft
     * `zeit.abwesenheit_grund_lesen` und schreibt EINE Protokollzeile je
     * Abruf (dieselbe Aktion wie der Einzelleser).
     * // TODO(client, O-643): Voreinstellung — die Abwesenheitsart gehoert in die Auskunft, als eigener Abschnitt hinter eigenem Recht und nur auf ausdrueckliche Mitgabe, nicht im Standardexport (D-855).
     */
    sql: `select von, bis, status, art, gesundheitsbezogen, au_bescheinigung_vorliegt,
                 au_bis, bemerkung, urlaub_gutgeschrieben_tage
            from app.auskunft_abwesenheitsgruende($1::uuid)`,
  },
  /*
   * **Elf Abschnitte des Personenzweigs** (V-334, O-648, D-791, D-856). Sie
   * standen bis D-856 im Sammelabschnitt „offen". Voreinstellung (O-648):
   * alle gehören hinein — Zuordnungen, abgeleitete Befunde (eine Folgerung
   * über einen Menschen ist selbst personenbezogen) und Zugangsdaten ohne
   * Geheimnisse: kein Kennwort-Hash (der liegt ohnehin nicht in `benutzer`),
   * kein Markenwert (`checkin_token.token_hash` ist cse_app nicht gewährt),
   * keine Rohnutzlast eines Offline-Ereignisses (sie kann die Marke tragen).
   * Jeder Abschnitt liest über die Policy seines Fachrechts; fehlt es, ist er
   * gesperrt, nicht leer.
   * // TODO(client, O-648): Voreinstellung — Zuordnungen, abgeleitete Befunde und Zugangsdaten ohne Geheimnisse gehören in die Art.-15-Auskunft, je Tabelle ein Abschnitt mit eigenem Recht (D-791, D-856).
   */
  {
    schluessel: 'einsatz_zuordnung',
    titel: 'Einsätze (Zuordnungen im Dienstplan)',
    verarbeitung: 'V-03',
    quelle: 'einsatz_zuordnung',
    tabellen: ['einsatz_zuordnung'],
    leseweg: 'policy',
    recht: 'dienstplan.lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Beginn', feld: 'beginn_zeitpunkt' },
      { kopf: 'Ende', feld: 'ende_zeitpunkt' },
      { kopf: 'Funktion', feld: 'funktion' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Qualifikation geprüft', feld: 'qualifikation_geprueft_am' },
      { kopf: 'Zugesagt', feld: 'zugesagt_am' },
      { kopf: 'Abgesagt', feld: 'abgesagt_am' },
      { kopf: 'Absagegrund', feld: 'absage_grund' },
      { kopf: 'Entfernt', feld: 'entfernt_am' },
    ],
    sql: `select beginn_zeitpunkt, ende_zeitpunkt, funktion, status::text as status,
                 qualifikation_geprueft_am, zugesagt_am, abgesagt_am, absage_grund, entfernt_am
            from einsatz_zuordnung
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by beginn_zeitpunkt desc`,
  },
  {
    schluessel: 'zeitnachweis',
    titel: 'Monatsnachweise der Arbeitszeit (§ 17 MiLoG)',
    verarbeitung: 'V-02',
    quelle: 'zeitnachweis',
    tabellen: ['zeitnachweis'],
    leseweg: 'policy',
    recht: 'zeit.lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Monat', feld: 'monat' },
      { kopf: 'Zeilen', feld: 'zeilen_anzahl' },
      { kopf: 'Brutto (Min.)', feld: 'summe_brutto_minuten' },
      { kopf: 'Netto (Min.)', feld: 'summe_netto_minuten' },
      { kopf: 'Prüfsumme', feld: 'hash' },
      { kopf: 'Gesperrt', feld: 'gesperrt_am' },
    ],
    // Die Zeilen des Nachweises stehen schon im Abschnitt „Arbeitszeitaufzeichnungen".
    sql: `select monat, zeilen_anzahl, summe_brutto_minuten, summe_netto_minuten, hash, gesperrt_am
            from zeitnachweis
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by monat desc`,
  },
  {
    schluessel: 'team_mitglied',
    titel: 'Teams',
    verarbeitung: 'V-03',
    quelle: 'team_mitglied, team',
    tabellen: ['team_mitglied'],
    leseweg: 'policy',
    recht: 'kalender.lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Team', feld: 'team' },
      { kopf: 'Rolle', feld: 'rolle' },
      { kopf: 'Seit', feld: 'erstellt_am' },
      { kopf: 'Beendet', feld: 'beendet_am' },
    ],
    sql: `select t.name as team, m.rolle, m.erstellt_am, m.beendet_am
            from team_mitglied m
            left join team t on t.id = m.team_id
           where m.person_id = $1::uuid and m.mandant_id = app.aktiver_mandant()
           order by m.erstellt_am desc`,
  },
  {
    schluessel: 'bewacher_eintrag',
    titel: 'Bewacherregister (§ 34a GewO)',
    verarbeitung: 'V-01',
    quelle: 'bewacher_eintrag',
    tabellen: ['bewacher_eintrag'],
    leseweg: 'policy',
    recht: 'personal.nachweis_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Bewacher-ID', feld: 'bewacher_id' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Registriert seit', feld: 'registriert_seit' },
      { kopf: 'Gültig bis', feld: 'gueltig_bis' },
      { kopf: 'Letzte Prüfung', feld: 'letzte_pruefung_am' },
      { kopf: 'Nächste Prüfung', feld: 'naechste_pruefung_am' },
      { kopf: 'Bemerkung', feld: 'bemerkung' },
      { kopf: 'Quelle', feld: 'quelle' },
      { kopf: 'Erloschen', feld: 'erloschen_am' },
    ],
    // Ohne `mandant_id` — der Eintrag gehört dem Menschen (D-09), wie `nachweis`.
    sql: `select bewacher_id, status::text as status, registriert_seit, gueltig_bis,
                 letzte_pruefung_am, naechste_pruefung_am, bemerkung, quelle, erloschen_am
            from bewacher_eintrag
           where person_id = $1::uuid
           order by registriert_seit desc nulls last`,
  },
  {
    schluessel: 'arbeitszeit_verstoss',
    titel: 'Befunde zur Arbeitszeit (ArbZG)',
    verarbeitung: 'V-02',
    quelle: 'arbeitszeit_verstoss',
    tabellen: ['arbeitszeit_verstoss'],
    leseweg: 'policy',
    recht: 'dienstplan.arbzg_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Regel', feld: 'regel' },
      { kopf: 'Schwere', feld: 'schwere' },
      { kopf: 'Von', feld: 'zeitraum_beginn' },
      { kopf: 'Bis', feld: 'zeitraum_ende' },
      { kopf: 'Ist (Min.)', feld: 'ist_minuten' },
      { kopf: 'Grenze (Min.)', feld: 'grenzwert_minuten' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Quittiert', feld: 'quittiert_am' },
      { kopf: 'Begründung der Quittierung', feld: 'quittierung_begruendung' },
      { kopf: 'Erkannt', feld: 'erkannt_am' },
    ],
    sql: `select regel::text as regel, schwere::text as schwere, zeitraum_beginn, zeitraum_ende,
                 ist_minuten, grenzwert_minuten, status::text as status, quittiert_am,
                 quittierung_begruendung, erkannt_am
            from arbeitszeit_verstoss
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by zeitraum_beginn desc`,
  },
  {
    schluessel: 'planungs_konflikt',
    titel: 'Planungskonflikte',
    verarbeitung: 'V-03',
    quelle: 'planungs_konflikt',
    tabellen: ['planungs_konflikt'],
    leseweg: 'policy',
    recht: 'dienstplan.lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Schwere', feld: 'schwere' },
      { kopf: 'Von', feld: 'zeitraum_beginn' },
      { kopf: 'Bis', feld: 'zeitraum_ende' },
      { kopf: 'Blockiert', feld: 'blockiert' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Quittiert', feld: 'quittiert_am' },
      { kopf: 'Begründung der Quittierung', feld: 'quittierung_begruendung' },
      { kopf: 'Erkannt', feld: 'erkannt_am' },
    ],
    sql: `select art::text as art, schwere::text as schwere, zeitraum_beginn, zeitraum_ende,
                 blockiert, status::text as status, quittiert_am, quittierung_begruendung,
                 erkannt_am
            from planungs_konflikt
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by zeitraum_beginn desc`,
  },
  {
    schluessel: 'nachweis_warnung',
    titel: 'Warnungen zum Ablauf von Nachweisen',
    verarbeitung: 'V-01',
    quelle: 'nachweis_warnung',
    tabellen: ['nachweis_warnung'],
    leseweg: 'policy',
    recht: 'personal.nachweis_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Tage vor Ablauf', feld: 'stufe_tage' },
      { kopf: 'Nachweis gültig bis', feld: 'gueltig_bis' },
      { kopf: 'Ausgelöst', feld: 'ausgeloest_am' },
    ],
    sql: `select stufe_tage, gueltig_bis, ausgeloest_am
            from nachweis_warnung
           where person_id = $1::uuid
           order by ausgeloest_am desc`,
  },
  {
    schluessel: 'da_pflicht',
    titel: 'Pflichten aus Dienstanweisungen',
    verarbeitung: 'V-09',
    quelle: 'da_pflicht, dienstanweisung',
    tabellen: ['da_pflicht'],
    leseweg: 'policy',
    recht: 'dienstanweisung.lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Dienstanweisung', feld: 'titel' },
      { kopf: 'Quelle', feld: 'quelle' },
      { kopf: 'Aus der Zuordnung', feld: 'aus_zuordnung' },
      { kopf: 'Zugewiesen', feld: 'zugewiesen_am' },
      { kopf: 'Entfallen', feld: 'entfallen_am' },
    ],
    sql: `select d.titel, p.quelle::text as quelle, p.aus_zuordnung, p.zugewiesen_am, p.entfallen_am
            from da_pflicht p
            left join dienstanweisung d on d.id = p.dienstanweisung_id
           where p.person_id = $1::uuid and p.mandant_id = app.aktiver_mandant()
           order by p.zugewiesen_am desc`,
  },
  {
    schluessel: 'benutzer',
    titel: 'Konto für die Anmeldung',
    verarbeitung: 'V-10',
    quelle: 'benutzer',
    tabellen: ['benutzer'],
    leseweg: 'policy',
    recht: 'system.benutzer_lesen',
    fuer: ['person'],
    spalten: [
      { kopf: 'E-Mail', feld: 'email' },
      { kopf: 'Name', feld: 'name' },
      { kopf: 'Sprache', feld: 'sprache' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Letzte Anmeldung', feld: 'letzter_login_am' },
      { kopf: 'Letzte IP-Adresse', feld: 'letzte_ip' },
      { kopf: 'Deaktiviert', feld: 'deaktiviert_am' },
      { kopf: 'Angelegt', feld: 'erstellt_am' },
    ],
    // Kein Kennwort, kein zweiter Faktor: die liegen nicht in `benutzer`, und Geheimnisse gehören nicht in eine Auskunft.
    sql: `select email, name, sprache::text as sprache, status::text as status, letzter_login_am,
                 letzte_ip::text as letzte_ip, deaktiviert_am, erstellt_am
            from benutzer
           where person_id = $1::uuid
           order by erstellt_am`,
  },
  {
    schluessel: 'checkin_token',
    titel: 'Check-in-Marken',
    verarbeitung: 'V-02',
    quelle: 'checkin_token',
    tabellen: ['checkin_token'],
    leseweg: 'policy',
    recht: 'zeit.checkin_verwalten',
    fuer: ['person'],
    spalten: [
      { kopf: 'Zweck', feld: 'zweck' },
      { kopf: 'Gültig ab', feld: 'gueltig_ab' },
      { kopf: 'Gültig bis', feld: 'gueltig_bis' },
      { kopf: 'Kanal', feld: 'ausgabe_kanal' },
      { kopf: 'Ausgegeben', feld: 'ausgegeben_am' },
      { kopf: 'Eingelöst', feld: 'eingeloest_am' },
      { kopf: 'Versuche', feld: 'versuche' },
      { kopf: 'Widerrufen', feld: 'widerrufen_am' },
      { kopf: 'Widerrufsgrund', feld: 'widerruf_grund' },
      { kopf: 'IP-Adresse', feld: 'ip_adresse' },
      { kopf: 'Gerät', feld: 'user_agent' },
    ],
    // Ohne `token_hash` — der Markenwert ist ein Geheimnis und cse_app nicht gewährt.
    sql: `select zweck::text as zweck, gueltig_ab, gueltig_bis, ausgabe_kanal, ausgegeben_am,
                 eingeloest_am, versuche, widerrufen_am, widerruf_grund,
                 ip_adresse::text as ip_adresse, user_agent
            from checkin_token
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by ausgegeben_am desc nulls last`,
  },
  {
    schluessel: 'offline_ereignis',
    titel: 'Offline erfasste Ereignisse',
    verarbeitung: 'V-02',
    quelle: 'offline_ereignis',
    tabellen: ['offline_ereignis'],
    leseweg: 'policy',
    recht: 'zeit.nacherfassung_pruefen',
    fuer: ['person'],
    spalten: [
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Behauptete Zeit', feld: 'behauptete_zeit' },
      { kopf: 'Empfangen', feld: 'empfangen_am' },
      { kopf: 'Abweichung der Geräteuhr (Sek.)', feld: 'zeitabweichung_sek' },
      { kopf: 'Breite', feld: 'geo_lat' },
      { kopf: 'Länge', feld: 'geo_lon' },
      { kopf: 'Ortsstatus', feld: 'geo_status' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Ablehnungsgrund', feld: 'ablehnungsgrund' },
      { kopf: 'IP-Adresse', feld: 'ip_adresse' },
      { kopf: 'Gerät', feld: 'user_agent' },
    ],
    // Ohne Rohnutzlast: sie kann den Markenwert tragen (O-648 — keine Geheimnisse).
    sql: `select art::text as art, behauptete_zeit, empfangen_am, zeitabweichung_sek,
                 geo_lat, geo_lon, geo_status::text as geo_status, status::text as status,
                 ablehnungsgrund::text as ablehnungsgrund, ip_adresse::text as ip_adresse,
                 user_agent
            from offline_ereignis
           where person_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by empfangen_am desc`,
  },
  {
    schluessel: 'antrag',
    titel: 'Anträge (Urlaub, Tausch, Änderung)',
    verarbeitung: 'V-04',
    quelle: 'antrag',
    tabellen: ['antrag'],
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
    tabellen: ['stundenkonto'],
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
    tabellen: ['urlaubskonto'],
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
    tabellen: ['nachweis'],
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
    tabellen: ['da_kenntnisnahme'],
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
    tabellen: ['wachbuch_eintrag'],
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
    tabellen: ['schluessel_quittung'],
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
    tabellen: ['mitarbeiter_zugang'],
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
    tabellen: ['benachrichtigung'],
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
    tabellen: ['ansprechpartner'],
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
    tabellen: ['ansprechpartner'],
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
    tabellen: ['werbewiderspruch'],
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
    tabellen: ['bewerbung'],
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
      // Der Rückzug ist eine Angabe über die Bewerberin (V-363, 0508).
      { kopf: 'Zurückgezogen am', feld: 'zurueckgezogen_am' },
      { kopf: 'Rückzugsvermerk', feld: 'zurueckgezogen_vermerk' },
      { kopf: 'Aufbewahrung bis', feld: 'aufbewahrung_bis' },
    ],
    sql: `select b.name, b.email, b.telefon, b.nachricht, s.titel as stelle,
                 b.status::text as status, b.eingegangen_am, b.zurueckgezogen_am,
                 b.zurueckgezogen_vermerk, b.aufbewahrung_bis
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
    tabellen: ['bewerbung_bewertung'],
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
    tabellen: ['gespraech'],
    leseweg: 'policy',
    recht: 'recruiting.bewerbung_lesen',
    fuer: ['bewerbung'],
    /*
     * V-267: seit V-220 trägt ein Gespräch Absage und Vermerk mit Zeitpunkt —
     * und bei der Absage einen Satz über die Bewerberin. Eine Auskunft, die
     * ihn verschweigt, ist unvollständig (Art. 15 Abs. 1 DSGVO).
     */
    spalten: [
      { kopf: 'Termin', feld: 'termin' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Ort', feld: 'ort' },
      { kopf: 'Notiz', feld: 'notiz' },
      { kopf: 'Abgesagt am', feld: 'abgesagt_am' },
      { kopf: 'Absagegrund', feld: 'abgesagt_grund' },
      { kopf: 'Als geführt vermerkt am', feld: 'stattgefunden_vermerkt_am' },
    ],
    sql: `select termin, status::text as status, ort, notiz, abgesagt_am, abgesagt_grund,
                 stattgefunden_vermerkt_am
            from gespraech
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by termin desc nulls last`,
  },
  {
    schluessel: 'bewerbung_antwort',
    titel: 'Antworten an die Bewerberin',
    verarbeitung: 'V-05',
    quelle: 'bewerbung_antwort',
    tabellen: ['bewerbung_antwort'],
    leseweg: 'policy',
    recht: 'recruiting.bewerbung_lesen',
    fuer: ['bewerbung'],
    spalten: [
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Stand', feld: 'stand' },
      { kopf: 'Betreff', feld: 'betreff' },
      { kopf: 'Text', feld: 'text' },
      { kopf: 'Gesendet', feld: 'gesendet_am' },
      { kopf: 'An', feld: 'gesendet_an' },
    ],
    /*
     * **`text` steht MIT drin.** Der Abschnitt gab vorher nur Betreff,
     * Zeitpunkt und Empfängeradresse — also die Metadaten einer Nachricht an
     * diesen Menschen, nicht die Nachricht. Art. 15 Abs. 1 verlangt die Daten.
     */
    sql: `select art::text as art, stand::text as stand, betreff, text,
                 gesendet_am, gesendet_an
            from bewerbung_antwort
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by erstellt_am desc`,
  },
  {
    schluessel: 'betroffenenanfrage',
    titel: 'Frühere und laufende Betroffenenanfragen',
    verarbeitung: 'V-12',
    quelle: 'betroffenenanfrage',
    tabellen: ['betroffenenanfrage'],
    leseweg: 'policy',
    recht: 'datenschutz.auskunft_erstellen',
    fuer: ['person', 'ansprechpartner', 'bewerbung'],
    spalten: [
      { kopf: 'Eingegangen', feld: 'eingegangen_am' },
      { kopf: 'Art', feld: 'art' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Frist', feld: 'frist_am' },
      { kopf: 'Beantwortet', feld: 'beantwortet_am' },
    ],
    /*
     * **Der Vorgang selbst gehört in die Auskunft.** Dass jemand vor einem Jahr
     * schon einmal Auskunft verlangt hat, ist eine gespeicherte Angabe über
     * ihn — und `betroffenenanfrage` trägt alle drei Zuordnungsspalten. Ohne
     * diesen Abschnitt fehlte die einzige Tabelle, die in JEDEM Zweig einen
     * Personenbezug hat.
     *
     * Die Entscheidungs- und Verlängerungstexte stehen NICHT drin: sie sind
     * die interne Bearbeitung des Vorgangs, und das Ergebnis geht als
     * Antwortschreiben hinaus, nicht als Tabellenzelle.
     */
    sql: `select eingegangen_am, art::text as art, status::text as status,
                 coalesce(verlaengert_bis, frist_am) as frist_am,
                 beantwortet_am
            from betroffenenanfrage
           where mandant_id = app.aktiver_mandant()
             and (person_id = $1::uuid or ansprechpartner_id = $1::uuid
                  or bewerbung_id = $1::uuid)
           order by eingegangen_am desc`,
  },
  /* -----------------------------------------------------------------------
   * Der Kontaktzweig, vollständig — und der Befund, der ihn vollständig
   * gemacht hat.
   *
   * Hier standen DREI Abschnitte (`ansprechpartner`, der Widerspruchsstand,
   * das Widerspruchsprotokoll). `ansprechpartner_id` steht aber in SIEBEN
   * Tabellen des Schemas, nachgezählt in `information_schema.columns`:
   * `angebot`, `betroffenenanfrage`, `lead`, `lead_aktivitaet`, `objekt`,
   * `werbewiderspruch`, `werbewiderspruch_token`. Die Auskunft ging trotzdem
   * mit `vollstaendig = true`, Prüfsumme und dem Wort „Vollständig" an die
   * betroffene Person hinaus.
   *
   * **Das hebelte den eigenen Grundsatz der Datei aus.** Ein Abschnitt ohne
   * Recht ist `gesperrt` und sperrt den Abruf — eine Tabelle, die gar nicht
   * in der Liste steht, erscheint nirgends. Genau dann „sieht sie aus wie eine
   * Antwort". `lead_aktivitaet.inhalt` ist die tatsächliche Korrespondenz mit
   * diesem Menschen; sie wegzulassen ist nicht eine Auslegungsfrage, sondern
   * das Gegenteil von Art. 15 Abs. 1 lit. b.
   *
   * Dass die Liste nicht wieder hinter dem Schema zurückbleibt, hält
   * `tests/isolation/datenschutz-abdeckung.test.ts` fest: sie fällt bei der
   * nächsten Migration, die eine achte Tabelle dazulegt.
   * -------------------------------------------------------------------- */
  {
    schluessel: 'lead',
    titel: 'Anfragen und Vorgänge (Leads)',
    verarbeitung: 'V-06',
    quelle: 'lead',
    tabellen: ['lead'],
    leseweg: 'policy',
    recht: 'crm.lesen',
    fuer: ['ansprechpartner'],
    spalten: [
      { kopf: 'Nummer', feld: 'leadnummer' },
      { kopf: 'Eingang', feld: 'erstellt_am' },
      { kopf: 'Quelle', feld: 'quelle' },
      { kopf: 'Betreff', feld: 'betreff' },
      { kopf: 'Bedarf', feld: 'bedarf_zusammenfassung' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Nächste Aktion', feld: 'naechste_aktion_text' },
      { kopf: 'Verloren, Grund', feld: 'verloren_grund' },
      { kopf: 'Bewertung', feld: 'punktzahl' },
      { kopf: 'Begründung der Bewertung', feld: 'punktzahl_begruendung' },
    ],
    /*
     * **Mit `punktzahl` und `punktzahl_begruendung`** (V-334, D-856). Die
     * Bewertung ist eine Folgerung über den Vorgang, und nach der
     * Voreinstellung zu O-648 gehören auch Folgerungen in die Auskunft, wenn
     * sie an einem Menschen hängen.
     */
    sql: `select leadnummer, erstellt_am, quelle::text as quelle, betreff,
                 bedarf_zusammenfassung, status::text as status,
                 naechste_aktion_text, verloren_grund, punktzahl, punktzahl_begruendung
            from lead
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()
           order by erstellt_am desc`,
  },
  {
    schluessel: 'lead_aktivitaet',
    titel: 'Korrespondenz und Vermerke zum Vorgang',
    verarbeitung: 'V-06',
    quelle: 'lead_aktivitaet',
    tabellen: ['lead_aktivitaet'],
    leseweg: 'policy',
    recht: 'crm.lesen',
    fuer: ['ansprechpartner'],
    spalten: [
      { kopf: 'Wann', feld: 'geschehen_am' },
      { kopf: 'Typ', feld: 'typ' },
      { kopf: 'Richtung', feld: 'richtung' },
      { kopf: 'Zweck', feld: 'zweck' },
      { kopf: 'Kanal', feld: 'kanal' },
      { kopf: 'Betreff', feld: 'betreff' },
      { kopf: 'Inhalt', feld: 'inhalt' },
      { kopf: 'Rechtsgrundlage (Stand)', feld: 'rechtsgrundlage_snapshot' },
      { kopf: 'Von', feld: 'akteur_art' },
    ],
    /*
     * `inhalt` steht MIT drin, und das ist der Punkt dieses Abschnitts: das
     * ist die Korrespondenz selbst. `rechtsgrundlage_snapshot` daneben, weil
     * Art. 15 Abs. 1 lit. a die Zwecke UND die Grundlage verlangt — und die
     * ist hier je Nachricht festgehalten, nicht je Kontakt.
     */
    sql: `select geschehen_am, typ::text as typ, richtung::text as richtung,
                 zweck::text as zweck, kanal, betreff, inhalt,
                 rechtsgrundlage_snapshot::text as rechtsgrundlage_snapshot,
                 akteur_art::text as akteur_art
            from lead_aktivitaet
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()
           order by geschehen_am desc`,
  },
  {
    schluessel: 'angebot',
    titel: 'Angebote, in denen diese Person als Ansprechpartner steht',
    verarbeitung: 'V-06',
    quelle: 'angebot',
    tabellen: ['angebot'],
    leseweg: 'policy',
    recht: 'angebot.lesen',
    fuer: ['ansprechpartner'],
    spalten: [
      { kopf: 'Nummer', feld: 'angebotsnummer' },
      { kopf: 'Titel', feld: 'titel' },
      { kopf: 'Status', feld: 'status' },
      { kopf: 'Versendet', feld: 'versendet_am' },
      { kopf: 'Entschieden', feld: 'entschieden_am' },
      { kopf: 'Notiz zur Entscheidung', feld: 'entscheidung_notiz' },
    ],
    /*
     * **Ohne `netto_cent`.** Der Preis ist eine Angabe über das Geschäft, nicht
     * über den Menschen; er steht im Angebot, das der Kunde ohnehin hat.
     * Das Recht ist `angebot.lesen` und nicht `crm.lesen` — so verlangt es die
     * Policy `t_mandant` auf `angebot`, nachgemessen in `pg_policies`.
     */
    sql: `select angebotsnummer, titel, status::text as status, versendet_am,
                 entschieden_am, entscheidung_notiz
            from angebot
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()
           order by erstellt_am desc`,
  },
  {
    schluessel: 'objekt',
    titel: 'Objekte, für die diese Person als Ansprechpartner geführt wird',
    verarbeitung: 'V-06',
    quelle: 'objekt',
    tabellen: ['objekt'],
    leseweg: 'policy',
    recht: 'objekt.lesen',
    fuer: ['ansprechpartner'],
    spalten: [
      { kopf: 'Nummer', feld: 'objektnummer' },
      { kopf: 'Bezeichnung', feld: 'bezeichnung' },
      { kopf: 'Ort', feld: 'ort' },
      { kopf: 'Seit', feld: 'erstellt_am' },
    ],
    /*
     * **Nur die Zuordnung, nicht das Objekt.** „Diese Person ist
     * Ansprechpartnerin für Objekt X" IST eine Angabe über sie und gehört
     * deshalb hierher. Der Zutrittshinweis, die Bemerkung und die Geodaten
     * sind Angaben über das Gebäude und stehen NICHT drin — eine
     * Art.-15-Auskunft ist kein Objektauszug.
     */
    sql: `select objektnummer, bezeichnung, ort, erstellt_am
            from objekt
           where ansprechpartner_id = $1::uuid
             and mandant_id = app.aktiver_mandant()
           order by objektnummer`,
  },
  {
    schluessel: 'werbewiderspruch_token',
    titel: 'Ausgegebene Widerspruchslinks (§ 7 Abs. 3 Nr. 4 UWG)',
    verarbeitung: 'V-06',
    quelle: 'werbewiderspruch_token (über app.werbewiderspruch_token_auskunft)',
    tabellen: ['werbewiderspruch_token'],
    leseweg: 'definer',
    recht: 'datenschutz.auskunft_erstellen',
    fuer: ['ansprechpartner'],
    spalten: [
      { kopf: 'Ausgegeben', feld: 'ausgegeben_am' },
      { kopf: 'Kanal', feld: 'kanal' },
      { kopf: 'Benutzt', feld: 'eingeloest_am' },
      { kopf: 'Versuche', feld: 'versuche' },
      { kopf: 'Zurückgezogen', feld: 'widerrufen_am' },
      { kopf: 'Grund', feld: 'widerruf_grund' },
    ],
    /*
     * **Der einzige Weg, und der Abdruck bleibt drinnen.** `cse_app` hat auf
     * `werbewiderspruch_token` GAR KEIN Recht (0222) — ein direktes `select`
     * liefert nicht „keine Links", sondern scheitert. Der Definer prüft sein
     * Recht und protokolliert; `token_hash` gibt er nicht heraus: das wäre der
     * Schlüssel, mit dem sich der Widerspruch dieses Kontakts erklären liesse.
     */
    sql: `select ausgegeben_am, kanal, eingeloest_am, versuche, widerrufen_am,
                 widerruf_grund
            from app.werbewiderspruch_token_auskunft($1::uuid)`,
  },
  /* -----------------------------------------------------------------------
   * Und derselbe Befund im Bewerbungszweig: `bewerbung_id` steht in SECHS
   * Tabellen, geführt waren vier. `einstellungsentscheidung` und `kandidat`
   * fehlten — die Entscheidung mit ihrer Begründung und die
   * Qualifikationsnotiz, also genau das, was eine Bewerberin wissen will.
   * -------------------------------------------------------------------- */
  {
    schluessel: 'einstellungsentscheidung',
    titel: 'Einstellungsentscheidung',
    verarbeitung: 'V-05',
    quelle: 'einstellungsentscheidung',
    tabellen: ['einstellungsentscheidung'],
    leseweg: 'policy',
    recht: 'recruiting.bewerbung_lesen',
    fuer: ['bewerbung'],
    spalten: [
      { kopf: 'Ergebnis', feld: 'ergebnis' },
      { kopf: 'Begründung', feld: 'begruendung' },
      { kopf: 'Entschieden', feld: 'entschieden_am' },
    ],
    /*
     * Die Begründung steht drin. Sie ist die Angabe, die der Bewerberin
     * gegenüber NICHT genannt wird (eine Absage nennt keinen Grund — AGG),
     * und sie ist genau deshalb eine gespeicherte Angabe über sie, die Art. 15
     * herausverlangt. Die zwei Pflichten widersprechen sich nicht: die eine
     * betrifft die Absage, die andere die Auskunft.
     */
    sql: `select ergebnis::text as ergebnis, begruendung, entschieden_am
            from einstellungsentscheidung
           where bewerbung_id = $1::uuid and mandant_id = app.aktiver_mandant()
           order by entschieden_am desc`,
  },
  {
    schluessel: 'kandidat',
    titel: 'Kandidatenprofil',
    verarbeitung: 'V-05',
    quelle: 'kandidat',
    tabellen: ['kandidat'],
    leseweg: 'policy',
    recht: 'recruiting.bewerbung_lesen',
    fuer: ['bewerbung'],
    spalten: [
      { kopf: 'Quelle', feld: 'quelle_art' },
      { kopf: 'Qualifikationen', feld: 'qualifikationen' },
      { kopf: 'Sprachen', feld: 'sprachen' },
      { kopf: 'Erfahrung (Jahre)', feld: 'erfahrung_jahre' },
      { kopf: 'Notiz', feld: 'notiz' },
      { kopf: 'Bestätigt', feld: 'bestaetigt_am' },
    ],
    sql: `select quelle_art::text as quelle_art,
                 array_to_string(qualifikationen, ', ') as qualifikationen,
                 array_to_string(sprachen, ', ') as sprachen,
                 erfahrung_jahre, notiz, bestaetigt_am
            from kandidat
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
  readonly quelle: string; readonly tabellen: readonly string[];
  readonly fuer: readonly ('person' | 'ansprechpartner' | 'bewerbung')[];
  readonly frage: string;
}[] = [
  {
    schluessel: 'agentenlauf',
    titel: 'Agentenläufe, Wissens-Chunks, Freigabe-Snapshots',
    /*
     * **`agent_aufgabe` und `agent_schritt`, nicht `agent_lauf`.** Hier stand
     * ein Name, den es im Schema gar nicht gibt — und niemand merkte es, weil
     * ein offener Abschnitt nichts abfragt. Die neue Wache
     * (`datenschutz-abdeckung.test.ts`) hat ihn beim ersten Lauf gefunden: sie
     * prüft beide Richtungen, also auch, dass die Liste keine Tabelle nennt,
     * die es nicht gibt.
     */
    quelle: 'agent_aufgabe · agent_schritt · wissens_chunk · freigabe_snapshot',
    tabellen: ['agent_aufgabe', 'agent_schritt', 'wissens_chunk',
      'freigabe_snapshot'],
    fuer: ['person', 'ansprechpartner', 'bewerbung'],
    frage: 'O-113',
  },
];

/**
 * Jede Tabelle, über die diese Auskunft etwas sagt — auch die, über die sie
 * ausdrücklich NICHTS sagt.
 *
 * `tests/isolation/datenschutz-abdeckung.test.ts` stellt sie gegen jede
 * Tabelle des Schemas mit `person_id`, `ansprechpartner_id` oder
 * `bewerbung_id` und fällt, sobald eine neue dazukommt. Ein Abschnitt, ein
 * offener Abschnitt — beides zählt; nur Schweigen zählt nicht.
 */
export const ABDECKUNG: ReadonlySet<string> = new Set([
  ...ABSCHNITTE.flatMap((d) => [...d.tabellen]),
  ...OFFENE_ABSCHNITTE.flatMap((o) => [...o.tabellen]),
]);

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
  /**
   * Warum der Abschnitt NICHT mitgegeben ist — `null`, wenn er es ist.
   * Nur für Abschnitte, die erst auf ausdrückliche Mitgabe hineinkommen
   * (Art. 9, O-643, D-855): nicht leer, nicht gesperrt, sondern benannt.
   */
  readonly zurueckgehalten: string | null;
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
  /**
   * Die Abschnitte, für die keine BEZIFFERTE Aufbewahrungsfrist vorliegt.
   *
   * Art. 15 Abs. 1 lit. d verlangt die geplante Speicherdauer oder wenigstens
   * die Kriterien für ihre Festlegung. „Voreinstellung (O-514), noch nicht
   * hinterlegt" ist
   * beides nicht. Die Frist stand in der ausgelieferten Datei und wurde dabei
   * als Angabe geführt; jetzt zählt sie hier, erscheint als Warnblock über
   * allen Abschnitten und der Abruf verlangt dafür eine ausdrückliche
   * Bestätigung (`/api/datenschutz/auskunft?fristen=bestaetigt`).
   */
  readonly offeneFristen: readonly string[];
  readonly vollstaendig: boolean;
  /** Ob die Abschnitte mit Art.-9-Daten ausdrücklich mitgegeben sind (O-643, D-855). */
  readonly art9Mitgegeben: boolean;
  readonly zeilen: number;
  readonly sha256: string;
  readonly erstelltAm: string;
}

/** Was die sachbearbeitende Person ausdrücklich mitgibt (O-643, D-855). */
export interface AuskunftOptionen {
  /** Die Art der Abwesenheiten (Art. 9 DSGVO) — nie im Standardexport. */
  readonly art9?: boolean;
}

/** Der Satz eines nicht mitgegebenen Art.-9-Abschnitts — ein Satz, keine Lücke. */
export const ART9_ZURUECKGEHALTEN =
  'Nicht mitgegeben: Gesundheitsdaten (Art. 9 DSGVO) kommen nur auf ausdrückliche Mitgabe in '
  + 'die Auskunft (Voreinstellung O-643). Es gibt sie — dieser Abschnitt sagt es, statt sie '
  + 'still auszulassen.';

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

/** Ganze Cent aus der Datenbank (bigint kommt als Ziffernfolge) als Euro — Invariante 1. */
export function geldText(wert: unknown): string {
  if (wert === null || wert === undefined || wert === '') return '—';
  const text = String(wert);
  if (!/^-?\d+$/u.test(text)) return alsText(wert);
  return formatiereGeld(cent(BigInt(text)));
}

/** Kanonische Form: stabile Reihenfolge, keine Uhr, kein Vermerk über den Leser. */
function kanonisch(a: readonly AuskunftAbschnitt[]): string {
  return JSON.stringify(a.map((x) => ({
    schluessel: x.schluessel, gesperrt: x.gesperrt, offen: x.offen,
    zurueckgehalten: x.zurueckgehalten, kopf: x.kopf, zeilen: x.zeilen,
  })));
}

/**
 * Trägt dieser Fristtext eine Zahl — oder sagt er „noch nicht entschieden"?
 *
 * **Warum ein Textvergleich und keine zweite Datenquelle.** `fristText` ist die
 * EINE Stelle, die aus dem Register und den Aufbewahrungsregeln einen Satz
 * macht; eine zweite Funktion, die dasselbe noch einmal entscheidet, wäre die
 * zweite Wahrheit, die beim ersten Auseinanderlaufen niemand sieht. Geprüft
 * wird deshalb das Ergebnis: ein Satz mit „nicht entschieden", „nicht gesetzt"
 * oder „nicht hinterlegt" ist keine Speicherdauer im Sinne des Art. 15 Abs. 1
 * lit. d.
 */
/**
 * Ob eine Frist eine ZAHL nennt. „Voreinstellung (O-514), noch nicht
 * hinterlegt" nennt keine: die Voreinstellung steht in `DECISIONS.md` D-798,
 * das Verzeichnis führt sie noch nicht (V-368) — die Auskunft darf sie deshalb
 * nicht als Angabe ausgeben, und die Bestätigung vor dem Abruf bleibt.
 */
export function istBeziffert(frist: string): boolean {
  return !/nicht entschieden|nicht gesetzt|nicht hinterlegt/iu.test(frist);
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
  optionen: AuskunftOptionen = {},
): Promise<Auskunft> {
  const art9 = optionen.art9 === true;
  const [kopf] = await kontext.abfrage<{
    art: AnfrageArt; mandant_id: string; firma: string;
  }>(
    `select b.art::text as art, b.mandant_id, m.firma
       from betroffenenanfrage b
       join mandant m on m.id = b.mandant_id
      where b.mandant_id = app.aktiver_mandant() and b.id = $1::uuid`, [anfrageId]);
  if (kopf === undefined) {
    /*
     * **404, nicht 500 — und nicht 403** (AUT-06). Hier stand ein nackter
     * `Error`; `/api/datenschutz/auskunft` fängt nur die drei typisierten
     * Fehler und liess ihn durch, also antwortete eine erfundene oder fremde
     * Kennung mit 500. Ein Vorgang, den diese Sitzung nicht sehen darf, ist
     * einer, den es nicht gibt — dieselbe Antwort wie `ladeVorgang`.
     */
    throw new NichtGefundenFehler(
      `betroffenenanfrage ${anfrageId} nicht im aktiven Mandanten`);
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
  const mitgegeben = (d: AbschnittDefinition): boolean => d.mitgabe !== 'art9' || art9;
  const noetig = [...new Set(anwendbar
    .filter(mitgegeben)
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
  const ohneFrist: string[] = [];

  for (const d of anwendbar) {
    const v = verarbeitungOder(d.verarbeitung);
    const frist = v === undefined
      ? 'Voreinstellung (O-514), noch nicht hinterlegt'
      : fristText(v, regeln, tageBewerbung);
    if (!istBeziffert(frist)) ohneFrist.push(d.titel);
    const zweck = v === undefined ? 'nicht im Register geführt' : v.zweck;
    if (!mitgegeben(d)) {
      abschnitte.push({
        schluessel: d.schluessel, titel: d.titel, zweck, quelle: d.quelle,
        frist, recht: d.recht, leseweg: d.leseweg, gesperrt: false, offen: null,
        zurueckgehalten: ART9_ZURUECKGEHALTEN, kopf: [], zeilen: [],
      });
      continue;
    }
    const gesperrt = d.recht !== null && gehalten.get(d.recht) !== true;
    if (gesperrt && d.recht !== null) fehlend.add(d.recht);

    const zeilen = gesperrt || zuordnung.id === null
      ? []
      : (await kontext.abfrage<Record<string, unknown>>(d.sql, [zuordnung.id]))
        .map((r) => d.spalten.map((s) => (s.format === 'geld'
          ? geldText(r[s.feld]) : alsText(r[s.feld]))));

    abschnitte.push({
      schluessel: d.schluessel, titel: d.titel, zweck, quelle: d.quelle,
      frist, recht: d.recht, leseweg: d.leseweg, gesperrt, offen: null,
      zurueckgehalten: null, kopf: d.spalten.map((s) => s.kopf), zeilen,
    });
  }

  /*
   * `art` schliesst `'keine'` ein (`ZuordnungArt`); die Verengung weiter oben
   * wirkt nicht in den Rueckruf hinein — dieselbe Stelle, an der `anwendbar`
   * den Fall schon einmal getrennt hat.
   */
  const offen = art === 'keine'
    ? [] : OFFENE_ABSCHNITTE.filter((x) => x.fuer.includes(art));
  for (const o of offen) {
    abschnitte.push({
      schluessel: o.schluessel, titel: o.titel,
      zweck: 'Voreinstellung (O-113): gehört zur Auskunft und wird von einem Menschen beigefügt '
        + '— maschinell liest die Auskunft diese Tabellen noch nicht (V-301)',
      quelle: o.quelle,
      frist: 'Voreinstellung: Aufbewahrung nach § 147 AO / GoBD, Löschung erst danach',
      recht: null, leseweg: 'offen', gesperrt: false, offen: o.frage,
      zurueckgehalten: null, kopf: [], zeilen: [],
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
    offeneFristen: ohneFrist,
    vollstaendig: fehlend.size === 0 && zuordnung.art !== 'keine',
    art9Mitgegeben: art9,
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
  /*
   * **Die offene Frist steht VOR den Abschnitten, nicht in einer Zelle.**
   *
   * Sie stand bisher je Abschnitt als „Aufbewahrung: Noch nicht entschieden —
   * O-514" und ging als Angabe durch. Art. 15 Abs. 1 lit. d verlangt die
   * geplante Dauer oder die Kriterien; „noch nicht entschieden" ist keins von
   * beidem, und eine Auskunft, die zur wichtigsten Pflichtangabe schweigt,
   * darf das nicht im Kleingedruckten tun.
   */
  if (a.offeneFristen.length > 0) {
    z.push(
      `> **Für ${String(a.offeneFristen.length)} von `
      + `${String(a.abschnitte.length)} Abschnitten ist die Aufbewahrungsfrist `
      + 'noch nicht hinterlegt (Voreinstellung O-514).** Art. 15 Abs. 1 lit. d verlangt die '
      + 'geplante Speicherdauer oder wenigstens die Kriterien für ihre '
      + 'Festlegung. Wir nennen sie für diese Abschnitte deshalb NICHT, statt '
      + 'eine Zahl zu behaupten: '
      + `${a.offeneFristen.join(' · ')}.`, '');
  }
  for (const s of a.abschnitte) {
    z.push(`## ${s.titel}`, '',
      `*Zweck:* ${s.zweck}`, '',
      `*Quelle:* \`${s.quelle}\` · *Aufbewahrung:* ${s.frist}`, '');
    if (s.zurueckgehalten !== null) {
      z.push(`**${s.zurueckgehalten}**`, '');
      continue;
    }
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
