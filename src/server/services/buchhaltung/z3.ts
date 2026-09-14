import 'server-only';
import { createHash } from 'node:crypto';
import { schreibeZip } from '../archiv/zip.js';
import { nachCp1252, passtInCp1252 } from './datev/cp1252.js';
import {
  liesWirtschaftsjahr, wirtschaftsjahrZeitraum, type Wirtschaftsjahr,
} from './wirtschaftsjahr.js';

/**
 * Der Z3-Export — die Datentraegerueberlassung nach § 147 Abs. 6 AO
 * (ACC-09, GoBD Rz. 158 ff., PR 66, D-485).
 *
 * **Was Z3 ist.** Die Finanzverwaltung hat drei Zugriffsarten: Z1 ist der
 * unmittelbare Zugriff am System, Z2 der mittelbare ueber einen Mitarbeiter,
 * Z3 die Ueberlassung der Daten auf einem Datentraeger. Fuer Z3 verlangt sie
 * die aufzeichnungspflichtigen Daten in maschinell auswertbarer Form mitsamt
 * einer Strukturbeschreibung — der „Beschreibungsstandard fuer die
 * Datentraegerueberlassung" (`index.xml`, DTD `gdpdu-01-09-2004`), den die
 * Pruefsoftware IDEA einliest.
 *
 * **Was hier entsteht.** Ein ZIP je Wirtschaftsjahr: eine CSV-Tabelle je
 * Buch (Journal, Ausgangsrechnungen mit Positionen, Eingangsrechnungen,
 * Zahlungen und Zuordnungen, offene Posten, Belege) und je Stammdatum
 * (Kunden, Lieferanten, Kontenzuordnung, Steuersaetze, Nummernkreise,
 * Perioden), dazu `index.xml`, ein `LIESMICH.txt` in Worten und
 * `pruefsummen.txt` mit dem SHA-256 jeder Datei (`sha256sum -c`).
 *
 * **Reproduzierbar, wie das Pruefbuendel.** Keine Uhr im Paket, jede Tabelle
 * total geordnet, STORE-ZIP mit Nullzeitstempel (`archiv/zip.ts`): derselbe
 * Jahrgang ergibt dieselben Bytes und denselben Hash. Das Protokoll haelt
 * fest, WANN ein Paket abgerufen wurde; das Paket selbst sagt nur, WAS es ist.
 *
 * **Ehrlich ueber Luecken.** Der Z3-Export ist keine Freigabe, sondern eine
 * Ueberlassung: er zeigt den Stand, wie er ist. Buchungszeilen ohne Konto
 * oder Beleg stehen drin — und `LIESMICH.txt` nennt ihre Zahl aus
 * `app.export_unvollstaendig`, damit niemand ein unvollstaendiges Paket fuer
 * ein geprueftes haelt. Platzhalter (Wirtschaftsjahr, Kontenzuordnung, O-05)
 * stehen als Platzhalter drin.
 *
 * **Was nicht drinsteht.** IBAN und Kreditoren-/Debitorennummern sind
 * `cse_app` spaltenweise entzogen (K-05) und stehen deshalb nicht in den
 * Stammdaten; die Kontenzuordnung (`konten.csv`) traegt die Kontonummern.
 * Personenbezogene Daten ueber das Steuerrelevante hinaus (Ansprechpartner,
 * Personal, Zeiten) gehoeren nicht in eine Betriebspruefung der Buchfuehrung
 * und fehlen mit Absicht. Nichts hier rechnet Steuern oder Loehne (D-06).
 *
 * **Zeichensatz.** Die CSV-Dateien sind Windows-1252 (ANSI) — die Vorgabe
 * des Beschreibungsstandards, dieselbe wie beim DATEV-Export; Zeichen
 * ausserhalb werden zu `?`, und das Manifest zaehlt sie. `index.xml`,
 * `LIESMICH.txt` und `pruefsummen.txt` sind UTF-8.
 */
export interface Z3Kontext {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  readonly aktiverMandantId: string;
}

export type SpaltenTyp = 'text' | 'zahl' | 'betrag' | 'datum';

export interface Spalte {
  readonly name: string;
  readonly typ: SpaltenTyp;
  /** Teil des Primaerschluessels — steht in der Tabelle VOR jeder anderen Spalte. */
  readonly schluessel?: true;
  readonly text: string;
}

export interface TabellenSpezifikation {
  readonly name: string;
  readonly text: string;
  /** Welche Parameter die Abfrage erwartet: nur den Mandanten, dazu den Zeitraum, oder keinen. */
  readonly parameter: 'mandant' | 'zeitraum' | 'keine';
  readonly sql: string;
  readonly spalten: readonly Spalte[];
}

export interface Z3Tabelle {
  readonly name: string;
  readonly datei: string;
  readonly text: string;
  readonly zeilen: number;
  readonly sha256: string;
  readonly groesseBytes: number;
}

export interface Z3Paket {
  readonly mandantId: string;
  readonly firma: string;
  readonly jahr: number;
  readonly von: string;
  readonly bis: string;
  readonly bezeichnung: string;
  readonly wirtschaftsjahr: Wirtschaftsjahr;
  readonly tabellen: readonly Z3Tabelle[];
  /** Buchungszeilen des Zeitraums ohne Beleg oder Konto (`app.export_unvollstaendig`). */
  readonly unvollstaendig: number;
  /** Zeichen, die Windows-1252 nicht kennt und die als `?` im Paket stehen. */
  readonly ersetzteZeichen: number;
  readonly indexXml: Uint8Array;
  readonly liesmich: Uint8Array;
  readonly pruefsummen: Uint8Array;
  readonly zip: Uint8Array;
  readonly zipSha256: string;
}

export const INDEX_NAME = 'index.xml';
export const LIESMICH_NAME = 'LIESMICH.txt';
export const PRUEFSUMMEN_NAME = 'pruefsummen.txt';
export const DTD_NAME = 'gdpdu-01-09-2004.dtd';
export const HINWEIS_D06 =
  'Dieses Paket überlässt Daten. Es enthält keine Berechnung von Steuern oder Löhnen (D-06).';

const ZEIT = (spalte: string): string =>
  `to_char(${spalte} at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI:SS')`;
const JA_NEIN = (ausdruck: string): string => `case when ${ausdruck} then 'ja' else 'nein' end`;

/**
 * Die Tabellen des Pakets — Reihenfolge, Spalten, Abfrage.
 *
 * Jede Abfrage ist TOTAL geordnet (zuletzt immer die Kennung), damit zwei
 * Laeufe dieselben Bytes ergeben. Betraege kommen als `::text` aus der
 * Datenbank und werden hier zu Dezimalkomma-Text; keine Zahl wird je zu
 * `number` (Invariante 1). Schluesselspalten stehen zuerst — der
 * Beschreibungsstandard fuehrt sie vor den uebrigen, und die CSV muss dieselbe
 * Reihenfolge haben wie `index.xml`.
 */
export const TABELLEN: readonly TabellenSpezifikation[] = [
  {
    name: 'buchungen',
    text: 'Journal (Grundbuch): jede Buchungszeile des Wirtschaftsjahrs nach Belegdatum, mit Konto, Gegenkonto, Steuerschlüssel, Beleg und dessen SHA-256.',
    parameter: 'zeitraum',
    sql: `select bs.id::text as id, bs.buchung_id::text as buchung_id,
                 bs.belegdatum::text as belegdatum, bs.buchungsdatum::text as buchungsdatum,
                 to_char(p.beginn_am, 'YYYY-MM') as periode,
                 bs.umsatz_cent::text as umsatz, bs.soll_haben::text as soll_haben,
                 bs.konto, bs.gegenkonto, bs.bu_schluessel, g.schluessel as steuersatz,
                 bs.buchungstext, bs.kostenstelle, bs.kostentraeger, bs.herkunft::text as herkunft,
                 bs.rechnung_id::text as rechnung_id, bs.eingangsrechnung_id::text as eingangsrechnung_id,
                 bs.zahlung_id::text as zahlung_id, bs.beleg_id::text as beleg_id,
                 b.belegnummer, b.datei_sha256 as beleg_sha256,
                 ${JA_NEIN('bs.festgeschrieben')} as festgeschrieben,
                 ${ZEIT('bs.festgeschrieben_am')} as festgeschrieben_am,
                 bs.storniert_durch_id::text as storniert_durch_id, bs.pruefhinweis,
                 ${ZEIT('bs.erstellt_am')} as erstellt_am
            from buchungssatz bs
            join periode p on p.id = bs.periode_id and p.mandant_id = bs.mandant_id
            left join beleg b on b.id = bs.beleg_id and b.mandant_id = bs.mandant_id
            left join steuersatz_gruppe g on g.id = bs.steuersatz_gruppe_id
           where bs.mandant_id = $1::uuid and bs.belegdatum between $2::date and $3::date
           order by bs.belegdatum, bs.buchung_id, bs.soll_haben, bs.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung der Buchungszeile' },
      { name: 'buchung_id', typ: 'text', text: 'Kennung des Buchungssatzes (Soll und Haben teilen sie)' },
      { name: 'belegdatum', typ: 'datum', text: 'Belegdatum' },
      { name: 'buchungsdatum', typ: 'datum', text: 'Buchungsdatum' },
      { name: 'periode', typ: 'text', text: 'Periode JJJJ-MM' },
      { name: 'umsatz', typ: 'betrag', text: 'Umsatz in EUR, ohne Vorzeichen — die Richtung steht in soll_haben' },
      { name: 'soll_haben', typ: 'text', text: 'soll oder haben' },
      { name: 'konto', typ: 'text', text: 'Konto (Kontenrahmen laut LIESMICH)' },
      { name: 'gegenkonto', typ: 'text', text: 'Gegenkonto' },
      { name: 'bu_schluessel', typ: 'text', text: 'Buchungsschlüssel (DATEV BU)' },
      { name: 'steuersatz', typ: 'text', text: 'Steuersatzgruppe (siehe steuersaetze.csv)' },
      { name: 'buchungstext', typ: 'text', text: 'Buchungstext' },
      { name: 'kostenstelle', typ: 'text', text: 'Kostenstelle' },
      { name: 'kostentraeger', typ: 'text', text: 'Kostenträger' },
      { name: 'herkunft', typ: 'text', text: 'Herkunft: rechnung, eingangsrechnung, zahlung, manuell' },
      { name: 'rechnung_id', typ: 'text', text: 'Kennung der Ausgangsrechnung (rechnungen.csv)' },
      { name: 'eingangsrechnung_id', typ: 'text', text: 'Kennung der Eingangsrechnung (eingangsrechnungen.csv)' },
      { name: 'zahlung_id', typ: 'text', text: 'Kennung der Zahlung (zahlungen.csv)' },
      { name: 'beleg_id', typ: 'text', text: 'Kennung des Belegs (belege.csv)' },
      { name: 'belegnummer', typ: 'text', text: 'Belegnummer' },
      { name: 'beleg_sha256', typ: 'text', text: 'SHA-256 der archivierten Belegdatei' },
      { name: 'festgeschrieben', typ: 'text', text: 'ja/nein — GoBD-Festschreibung' },
      { name: 'festgeschrieben_am', typ: 'text', text: 'Zeitpunkt der Festschreibung, Europe/Berlin' },
      { name: 'storniert_durch_id', typ: 'text', text: 'Kennung der stornierenden Zeile' },
      { name: 'pruefhinweis', typ: 'text', text: 'Hinweis, warum eine Zeile ohne Beleg steht' },
      { name: 'erstellt_am', typ: 'text', text: 'Zeitpunkt der Erfassung, Europe/Berlin' },
    ],
  },
  {
    name: 'rechnungen',
    text: 'Ausgangsrechnungen (festgeschrieben) des Wirtschaftsjahrs nach Rechnungsdatum, mit Kunde, Beträgen und dem Glied der Hash-Kette.',
    parameter: 'zeitraum',
    sql: `select r.id::text as id, r.nummer, r.nummer_laufend::text as nummer_laufend,
                 r.rechnungsart::text as rechnungsart, r.rechnungsdatum::text as rechnungsdatum,
                 r.leistung_von::text as leistung_von, r.leistung_bis::text as leistung_bis,
                 r.kunde_id::text as kunde_id, k.kundennummer, k.name as kunde_name, k.ust_id as kunde_ust_id,
                 r.netto_gesamt_cent::text as netto, r.steuer_gesamt_cent::text as steuer,
                 r.brutto_cent::text as brutto, r.abzug_brutto_cent::text as abzug_brutto,
                 r.zahlbetrag_cent::text as zahlbetrag,
                 r.einbehalt_bauabzugsteuer_cent::text as einbehalt_bauabzugsteuer,
                 ${JA_NEIN('r.reverse_charge')} as reverse_charge,
                 ${JA_NEIN('r.ist_kleinbetrag')} as ist_kleinbetrag,
                 r.faellig_am::text as faellig_am, r.zahlungsmittel_code,
                 ${ZEIT('r.festgeschrieben_am')} as festgeschrieben_am,
                 r.nummernkreis_id::text as nummernkreis_id,
                 h.vorheriger_hash, h.nutzlast_sha256, h.hash, h.algorithmus
            from rechnung r
            join kunde k on k.id = r.kunde_id and k.mandant_id = r.mandant_id
            left join rechnung_hash h on h.rechnung_id = r.id and h.mandant_id = r.mandant_id
           where r.mandant_id = $1::uuid and r.status = 'festgeschrieben'
             and r.rechnungsdatum between $2::date and $3::date
           order by r.rechnungsdatum, r.nummer_laufend, r.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung der Rechnung' },
      { name: 'nummer', typ: 'text', text: 'Rechnungsnummer (lückenlos je Nummernkreis)' },
      { name: 'nummer_laufend', typ: 'zahl', text: 'Laufende Nummer im Kreis' },
      { name: 'rechnungsart', typ: 'text', text: 'standard, abschlag, anzahlung, schluss, storno' },
      { name: 'rechnungsdatum', typ: 'datum', text: 'Rechnungsdatum' },
      { name: 'leistung_von', typ: 'datum', text: 'Leistungszeitraum Beginn' },
      { name: 'leistung_bis', typ: 'datum', text: 'Leistungszeitraum Ende' },
      { name: 'kunde_id', typ: 'text', text: 'Kennung des Kunden (kunden.csv)' },
      { name: 'kundennummer', typ: 'text', text: 'Kundennummer' },
      { name: 'kunde_name', typ: 'text', text: 'Name des Kunden' },
      { name: 'kunde_ust_id', typ: 'text', text: 'USt-IdNr. des Kunden' },
      { name: 'netto', typ: 'betrag', text: 'Nettosumme EUR' },
      { name: 'steuer', typ: 'betrag', text: 'Umsatzsteuer EUR' },
      { name: 'brutto', typ: 'betrag', text: 'Bruttosumme EUR' },
      { name: 'abzug_brutto', typ: 'betrag', text: 'Abzug vorheriger Abschläge EUR' },
      { name: 'zahlbetrag', typ: 'betrag', text: 'Zahlbetrag EUR' },
      { name: 'einbehalt_bauabzugsteuer', typ: 'betrag', text: 'Einbehalt § 48 EStG EUR' },
      { name: 'reverse_charge', typ: 'text', text: 'ja/nein — § 13b UStG' },
      { name: 'ist_kleinbetrag', typ: 'text', text: 'ja/nein — § 33 UStDV' },
      { name: 'faellig_am', typ: 'datum', text: 'Fälligkeit' },
      { name: 'zahlungsmittel_code', typ: 'text', text: 'Zahlungsmittel (UNTDID 4461)' },
      { name: 'festgeschrieben_am', typ: 'text', text: 'Zeitpunkt der Festschreibung, Europe/Berlin' },
      { name: 'nummernkreis_id', typ: 'text', text: 'Kennung des Nummernkreises (nummernkreise.csv)' },
      { name: 'vorheriger_hash', typ: 'text', text: 'Hash des Vorgängers in der Kette' },
      { name: 'nutzlast_sha256', typ: 'text', text: 'SHA-256 der kanonischen Rechnungsnutzlast' },
      { name: 'hash', typ: 'text', text: 'Kettenglied SHA256(Nutzlast + vorheriger Hash)' },
      { name: 'algorithmus', typ: 'text', text: 'Kettenverfahren' },
    ],
  },
  {
    name: 'rechnungspositionen',
    text: 'Positionen der festgeschriebenen Ausgangsrechnungen des Wirtschaftsjahrs (Einzelaufzeichnung).',
    parameter: 'zeitraum',
    sql: `select p.id::text as id, p.rechnung_id::text as rechnung_id, p.position_nr::text as position_nr,
                 p.positionsart::text as positionsart, p.bezeichnung,
                 replace(p.menge::text, '.', ',') as menge, p.einheit,
                 p.einzelpreis_cent::text as einzelpreis, p.rabatt_bp::text as rabatt_bp,
                 p.netto_cent::text as netto, g.schluessel as steuersatz, p.satz_bp::text as satz_bp,
                 p.kategorie::text as kategorie, p.erloeskonto_schluessel,
                 p.leistung_von::text as leistung_von, p.leistung_bis::text as leistung_bis
            from rechnungsposition p
            join rechnung r on r.id = p.rechnung_id and r.mandant_id = p.mandant_id
            join steuersatz_gruppe g on g.id = p.steuersatz_gruppe_id
           where p.mandant_id = $1::uuid and r.status = 'festgeschrieben'
             and r.rechnungsdatum between $2::date and $3::date
           order by r.rechnungsdatum, r.nummer_laufend, p.rechnung_id, p.position_nr, p.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung der Position' },
      { name: 'rechnung_id', typ: 'text', text: 'Kennung der Rechnung (rechnungen.csv)' },
      { name: 'position_nr', typ: 'zahl', text: 'Positionsnummer' },
      { name: 'positionsart', typ: 'text', text: 'Positionsart' },
      { name: 'bezeichnung', typ: 'text', text: 'Bezeichnung' },
      { name: 'menge', typ: 'text', text: 'Menge (drei Nachkommastellen, Dezimalkomma)' },
      { name: 'einheit', typ: 'text', text: 'Einheit' },
      { name: 'einzelpreis', typ: 'betrag', text: 'Einzelpreis EUR' },
      { name: 'rabatt_bp', typ: 'zahl', text: 'Rabatt in Basispunkten' },
      { name: 'netto', typ: 'betrag', text: 'Netto EUR' },
      { name: 'steuersatz', typ: 'text', text: 'Steuersatzgruppe (steuersaetze.csv)' },
      { name: 'satz_bp', typ: 'zahl', text: 'Steuersatz in Basispunkten (1900 = 19 %)' },
      { name: 'kategorie', typ: 'text', text: 'EN-16931-Steuerkategorie' },
      { name: 'erloeskonto_schluessel', typ: 'text', text: 'Erlöskontoschlüssel (konten.csv)' },
      { name: 'leistung_von', typ: 'datum', text: 'Leistungszeitraum Beginn' },
      { name: 'leistung_bis', typ: 'datum', text: 'Leistungszeitraum Ende' },
    ],
  },
  {
    name: 'eingangsrechnungen',
    text: 'Eingangsrechnungen des Wirtschaftsjahrs (nach Rechnungsdatum, sonst Eingang) mit Lieferant, Beträgen und Status — abgelehnte eingeschlossen, als solche gekennzeichnet.',
    parameter: 'zeitraum',
    sql: `select e.id::text as id, e.interne_belegnummer, e.status::text as status,
                 e.lieferant_id::text as lieferant_id, l.lieferantennummer, l.name as lieferant_name,
                 l.ust_id as lieferant_ust_id, e.rechnungsnummer_lieferant,
                 ${JA_NEIN('e.selbst_abgerechnet')} as selbst_abgerechnet, e.gutschrift_nummer,
                 e.rechnungsdatum::text as rechnungsdatum, e.leistungsdatum::text as leistungsdatum,
                 e.eingang_am::text as eingang_am,
                 e.netto_cent::text as netto, e.steuer_cent::text as steuer, e.brutto_cent::text as brutto,
                 ${JA_NEIN('e.reverse_charge')} as reverse_charge,
                 ${JA_NEIN('e.bauabzugsteuer_pflichtig')} as bauabzugsteuer_pflichtig,
                 e.faellig_am::text as faellig_am,
                 ${ZEIT('e.freigegeben_am')} as freigegeben_am, ${ZEIT('e.gebucht_am')} as gebucht_am,
                 e.beleg_id::text as beleg_id, e.kostenstelle, e.abgelehnt_grund
            from eingangsrechnung e
            left join lieferant l on l.id = e.lieferant_id and l.mandant_id = e.mandant_id
           where e.mandant_id = $1::uuid
             and coalesce(e.rechnungsdatum, e.eingang_am) between $2::date and $3::date
           order by coalesce(e.rechnungsdatum, e.eingang_am), e.interne_belegnummer, e.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung der Eingangsrechnung' },
      { name: 'interne_belegnummer', typ: 'text', text: 'Interne Belegnummer (beim Buchen vergeben)' },
      { name: 'status', typ: 'text', text: 'eingegangen, in_pruefung, freigegeben, gebucht, abgelehnt' },
      { name: 'lieferant_id', typ: 'text', text: 'Kennung des Lieferanten (lieferanten.csv)' },
      { name: 'lieferantennummer', typ: 'text', text: 'Lieferantennummer' },
      { name: 'lieferant_name', typ: 'text', text: 'Name des Lieferanten' },
      { name: 'lieferant_ust_id', typ: 'text', text: 'USt-IdNr. des Lieferanten' },
      { name: 'rechnungsnummer_lieferant', typ: 'text', text: 'Rechnungsnummer des Lieferanten' },
      { name: 'selbst_abgerechnet', typ: 'text', text: 'ja/nein — Gutschrift nach § 14 Abs. 2 UStG' },
      { name: 'gutschrift_nummer', typ: 'text', text: 'Eigene Gutschriftsnummer' },
      { name: 'rechnungsdatum', typ: 'datum', text: 'Rechnungsdatum' },
      { name: 'leistungsdatum', typ: 'datum', text: 'Leistungsdatum' },
      { name: 'eingang_am', typ: 'datum', text: 'Eingang' },
      { name: 'netto', typ: 'betrag', text: 'Netto EUR' },
      { name: 'steuer', typ: 'betrag', text: 'Vorsteuer EUR' },
      { name: 'brutto', typ: 'betrag', text: 'Brutto EUR' },
      { name: 'reverse_charge', typ: 'text', text: 'ja/nein — § 13b UStG als Empfänger' },
      { name: 'bauabzugsteuer_pflichtig', typ: 'text', text: 'ja/nein — § 48 EStG' },
      { name: 'faellig_am', typ: 'datum', text: 'Fälligkeit' },
      { name: 'freigegeben_am', typ: 'text', text: 'Freigabe, Europe/Berlin' },
      { name: 'gebucht_am', typ: 'text', text: 'Buchung, Europe/Berlin' },
      { name: 'beleg_id', typ: 'text', text: 'Kennung des Belegs (belege.csv)' },
      { name: 'kostenstelle', typ: 'text', text: 'Kostenstelle' },
      { name: 'abgelehnt_grund', typ: 'text', text: 'Ablehnungsgrund' },
    ],
  },
  {
    name: 'zahlungen',
    text: 'Zahlungen des Wirtschaftsjahrs nach Zahlungsdatum, Stornos eingeschlossen.',
    parameter: 'zeitraum',
    sql: `select z.id::text as id, z.richtung::text as richtung, z.betrag_cent::text as betrag,
                 z.zahlungsdatum::text as zahlungsdatum, z.valuta::text as valuta,
                 z.zahlungsmittel::text as zahlungsmittel,
                 z.bankkonto_id::text as bankkonto_id, z.kasse_id::text as kasse_id, z.referenz,
                 ${ZEIT('z.storniert_am')} as storniert_am, z.storniert_durch_id::text as storniert_durch_id,
                 ${ZEIT('z.erstellt_am')} as erstellt_am
            from zahlung z
           where z.mandant_id = $1::uuid and z.zahlungsdatum between $2::date and $3::date
           order by z.zahlungsdatum, z.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung der Zahlung' },
      { name: 'richtung', typ: 'text', text: 'eingang oder ausgang' },
      { name: 'betrag', typ: 'betrag', text: 'Betrag EUR' },
      { name: 'zahlungsdatum', typ: 'datum', text: 'Zahlungsdatum' },
      { name: 'valuta', typ: 'datum', text: 'Valuta' },
      { name: 'zahlungsmittel', typ: 'text', text: 'Zahlungsmittel' },
      { name: 'bankkonto_id', typ: 'text', text: 'Kennung des Bankkontos' },
      { name: 'kasse_id', typ: 'text', text: 'Kennung der Kasse' },
      { name: 'referenz', typ: 'text', text: 'Verwendungszweck / Referenz' },
      { name: 'storniert_am', typ: 'text', text: 'Storno, Europe/Berlin' },
      { name: 'storniert_durch_id', typ: 'text', text: 'Kennung der stornierenden Zahlung' },
      { name: 'erstellt_am', typ: 'text', text: 'Erfassung, Europe/Berlin' },
    ],
  },
  {
    name: 'zuordnungen',
    text: 'Zuordnungen von Zahlungen zu offenen Posten (Ausgleich, Skonto, Abschreibung) für Zahlungen des Wirtschaftsjahrs.',
    parameter: 'zeitraum',
    sql: `select zz.id::text as id, zz.zahlung_id::text as zahlung_id,
                 zz.offener_posten_id::text as offener_posten_id, zz.art::text as art,
                 zz.betrag_cent::text as betrag, zz.skonto_netto_cent::text as skonto_netto,
                 zz.skonto_steuer_cent::text as skonto_steuer, g.schluessel as steuersatz, zz.notiz,
                 ${ZEIT('zz.erstellt_am')} as erstellt_am
            from zahlung_zuordnung zz
            join zahlung z on z.id = zz.zahlung_id and z.mandant_id = zz.mandant_id
            left join steuersatz_gruppe g on g.id = zz.steuersatz_gruppe_id
           where zz.mandant_id = $1::uuid and z.zahlungsdatum between $2::date and $3::date
           order by z.zahlungsdatum, zz.zahlung_id, zz.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung der Zuordnung' },
      { name: 'zahlung_id', typ: 'text', text: 'Kennung der Zahlung (zahlungen.csv)' },
      { name: 'offener_posten_id', typ: 'text', text: 'Kennung des offenen Postens (offene_posten.csv)' },
      { name: 'art', typ: 'text', text: 'Art der Zuordnung' },
      { name: 'betrag', typ: 'betrag', text: 'Zugeordneter Betrag EUR' },
      { name: 'skonto_netto', typ: 'betrag', text: 'Skonto netto EUR' },
      { name: 'skonto_steuer', typ: 'betrag', text: 'Skonto Steueranteil EUR' },
      { name: 'steuersatz', typ: 'text', text: 'Steuersatzgruppe des Skontos' },
      { name: 'notiz', typ: 'text', text: 'Notiz' },
      { name: 'erstellt_am', typ: 'text', text: 'Erfassung, Europe/Berlin' },
    ],
  },
  {
    name: 'offene_posten',
    text: 'Offene Posten (Debitoren und Kreditoren) mit Fälligkeit im Wirtschaftsjahr — Stand zum Zeitpunkt des Abrufs.',
    parameter: 'zeitraum',
    sql: `select op.id::text as id, op.art::text as art, op.rechnung_id::text as rechnung_id,
                 op.eingangsrechnung_id::text as eingangsrechnung_id, op.kunde_id::text as kunde_id,
                 op.betrag_cent::text as betrag, op.bezahlt_cent::text as bezahlt, op.offen_cent::text as offen,
                 op.faellig_am::text as faellig_am, op.ausgeglichen_am::text as ausgeglichen_am,
                 op.letzte_mahnstufe::text as letzte_mahnstufe, op.letzte_mahnung_am::text as letzte_mahnung_am
            from offener_posten op
           where op.mandant_id = $1::uuid and op.faellig_am between $2::date and $3::date
           order by op.faellig_am, op.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung des Postens' },
      { name: 'art', typ: 'text', text: 'debitor, kreditor, Gutschriftsposten' },
      { name: 'rechnung_id', typ: 'text', text: 'Kennung der Ausgangsrechnung' },
      { name: 'eingangsrechnung_id', typ: 'text', text: 'Kennung der Eingangsrechnung' },
      { name: 'kunde_id', typ: 'text', text: 'Kennung des Kunden' },
      { name: 'betrag', typ: 'betrag', text: 'Forderung / Verbindlichkeit EUR' },
      { name: 'bezahlt', typ: 'betrag', text: 'Ausgeglichen EUR' },
      { name: 'offen', typ: 'betrag', text: 'Offen EUR' },
      { name: 'faellig_am', typ: 'datum', text: 'Fälligkeit' },
      { name: 'ausgeglichen_am', typ: 'datum', text: 'Ausgleich' },
      { name: 'letzte_mahnstufe', typ: 'zahl', text: 'Letzte Mahnstufe' },
      { name: 'letzte_mahnung_am', typ: 'datum', text: 'Letzte Mahnung' },
    ],
  },
  {
    name: 'belege',
    text: 'Belege des Wirtschaftsjahrs (nach Belegdatum, sonst Eingang) mit archivierter Datei und deren SHA-256.',
    parameter: 'zeitraum',
    sql: `select b.id::text as id, b.belegnummer, b.typ::text as typ, b.quelle::text as quelle,
                 b.belegdatum::text as belegdatum, ${ZEIT('b.eingegangen_am')} as eingegangen_am,
                 b.betrag_brutto_cent::text as betrag_brutto,
                 b.dokument_id::text as dokument_id, b.dokument_version_id::text as dokument_version_id,
                 b.datei_sha256, d.mime_typ, d.groesse_bytes::text as groesse_bytes,
                 d.entstanden_am::text as entstanden_am, d.aufbewahrung_bis::text as aufbewahrung_bis,
                 ${JA_NEIN('d.loeschsperre')} as loeschsperre
            from beleg b
            join dokument d on d.id = b.dokument_id and d.mandant_id = b.mandant_id
           where b.mandant_id = $1::uuid
             and coalesce(b.belegdatum, (b.eingegangen_am at time zone 'Europe/Berlin')::date)
                 between $2::date and $3::date
           order by coalesce(b.belegdatum, (b.eingegangen_am at time zone 'Europe/Berlin')::date),
                    b.belegnummer, b.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung des Belegs' },
      { name: 'belegnummer', typ: 'text', text: 'Belegnummer' },
      { name: 'typ', typ: 'text', text: 'Belegtyp' },
      { name: 'quelle', typ: 'text', text: 'Herkunft der Datei' },
      { name: 'belegdatum', typ: 'datum', text: 'Belegdatum' },
      { name: 'eingegangen_am', typ: 'text', text: 'Eingang, Europe/Berlin' },
      { name: 'betrag_brutto', typ: 'betrag', text: 'Bruttobetrag zur Suche EUR' },
      { name: 'dokument_id', typ: 'text', text: 'Kennung des Dokuments' },
      { name: 'dokument_version_id', typ: 'text', text: 'Kennung der Dateiversion' },
      { name: 'datei_sha256', typ: 'text', text: 'SHA-256 der Datei' },
      { name: 'mime_typ', typ: 'text', text: 'Dateityp' },
      { name: 'groesse_bytes', typ: 'zahl', text: 'Größe in Bytes' },
      { name: 'entstanden_am', typ: 'datum', text: 'Entstehung (Fristbeginn nach § 147 Abs. 4 AO)' },
      { name: 'aufbewahrung_bis', typ: 'datum', text: 'Ende der Aufbewahrung' },
      { name: 'loeschsperre', typ: 'text', text: 'ja/nein' },
    ],
  },
  {
    name: 'kunden',
    text: 'Debitorenstamm — alle Kunden der Gesellschaft, ohne Ansprechpartner.',
    parameter: 'mandant',
    sql: `select k.id::text as id, k.kundennummer, k.typ::text as typ, k.name, k.rechtsform, k.ust_id,
                 k.steuernummer, k.plz, k.ort, k.land,
                 ${JA_NEIN('k.ist_oeffentlicher_auftraggeber')} as oeffentlicher_auftraggeber,
                 k.leitweg_id, k.status::text as status, ${ZEIT('k.archiviert_am')} as archiviert_am
            from kunde k
           where k.mandant_id = $1::uuid
           order by k.kundennummer, k.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung des Kunden' },
      { name: 'kundennummer', typ: 'text', text: 'Kundennummer' },
      { name: 'typ', typ: 'text', text: 'firma, behoerde, privat' },
      { name: 'name', typ: 'text', text: 'Name' },
      { name: 'rechtsform', typ: 'text', text: 'Rechtsform' },
      { name: 'ust_id', typ: 'text', text: 'USt-IdNr.' },
      { name: 'steuernummer', typ: 'text', text: 'Steuernummer' },
      { name: 'plz', typ: 'text', text: 'PLZ' },
      { name: 'ort', typ: 'text', text: 'Ort' },
      { name: 'land', typ: 'text', text: 'Land (ISO 3166-1)' },
      { name: 'oeffentlicher_auftraggeber', typ: 'text', text: 'ja/nein' },
      { name: 'leitweg_id', typ: 'text', text: 'Leitweg-ID (XRechnung)' },
      { name: 'status', typ: 'text', text: 'Status' },
      { name: 'archiviert_am', typ: 'text', text: 'Archivierung, Europe/Berlin' },
    ],
  },
  {
    name: 'lieferanten',
    text: 'Kreditorenstamm — alle Lieferanten der Gesellschaft; Bankverbindung mit Absicht nicht enthalten (K-05).',
    parameter: 'mandant',
    sql: `select l.id::text as id, l.lieferantennummer, l.name, l.ust_id, l.steuernummer,
                 l.plz, l.ort, l.land, l.leistungsart::text as leistungsart,
                 l.ist_bauleistender_bis::text as ist_bauleistender_bis, l.status,
                 ${ZEIT('l.archiviert_am')} as archiviert_am
            from lieferant l
           where l.mandant_id = $1::uuid
           order by l.lieferantennummer, l.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung des Lieferanten' },
      { name: 'lieferantennummer', typ: 'text', text: 'Lieferantennummer' },
      { name: 'name', typ: 'text', text: 'Name' },
      { name: 'ust_id', typ: 'text', text: 'USt-IdNr.' },
      { name: 'steuernummer', typ: 'text', text: 'Steuernummer' },
      { name: 'plz', typ: 'text', text: 'PLZ' },
      { name: 'ort', typ: 'text', text: 'Ort' },
      { name: 'land', typ: 'text', text: 'Land (ISO 3166-1)' },
      { name: 'leistungsart', typ: 'text', text: 'Bauleistungsart (§ 13b UStG)' },
      { name: 'ist_bauleistender_bis', typ: 'datum', text: 'Bauleistender bis (§ 48 EStG)' },
      { name: 'status', typ: 'text', text: 'Status' },
      { name: 'archiviert_am', typ: 'text', text: 'Archivierung, Europe/Berlin' },
    ],
  },
  {
    name: 'konten',
    text: 'Kontenzuordnung der Gesellschaft (Erlös-, Steuer-, Debitoren-, Kreditoren-, Bank- und Kassenkonten) mit Platzhalterstand.',
    parameter: 'mandant',
    sql: `select km.id::text as id, km.kontenrahmen::text as kontenrahmen,
                 km.schluessel_typ::text as schluessel_typ, km.konto, km.gegenkonto, km.bu_schluessel,
                 g.schluessel as steuersatz, km.erloeskonto_schluessel,
                 km.kunde_id::text as kunde_id, km.lieferant_id::text as lieferant_id,
                 km.bankkonto_id::text as bankkonto_id, km.kasse_id::text as kasse_id,
                 km.prioritaet::text as prioritaet, km.gueltig_von::text as gueltig_von,
                 km.gueltig_bis::text as gueltig_bis, ${JA_NEIN('km.ist_platzhalter')} as ist_platzhalter
            from konto_mapping km
            left join steuersatz_gruppe g on g.id = km.steuersatz_gruppe_id
           where km.mandant_id = $1::uuid
           order by km.schluessel_typ, km.konto, km.gueltig_von, km.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung der Zuordnung' },
      { name: 'kontenrahmen', typ: 'text', text: 'skr03 oder skr04' },
      { name: 'schluessel_typ', typ: 'text', text: 'Art der Zuordnung' },
      { name: 'konto', typ: 'text', text: 'Konto' },
      { name: 'gegenkonto', typ: 'text', text: 'Gegenkonto' },
      { name: 'bu_schluessel', typ: 'text', text: 'Buchungsschlüssel' },
      { name: 'steuersatz', typ: 'text', text: 'Steuersatzgruppe' },
      { name: 'erloeskonto_schluessel', typ: 'text', text: 'Erlöskontoschlüssel' },
      { name: 'kunde_id', typ: 'text', text: 'Kennung des Kunden (Debitorenkonto)' },
      { name: 'lieferant_id', typ: 'text', text: 'Kennung des Lieferanten (Kreditorenkonto)' },
      { name: 'bankkonto_id', typ: 'text', text: 'Kennung des Bankkontos' },
      { name: 'kasse_id', typ: 'text', text: 'Kennung der Kasse' },
      { name: 'prioritaet', typ: 'zahl', text: 'Priorität bei mehreren Treffern' },
      { name: 'gueltig_von', typ: 'datum', text: 'Gültig ab' },
      { name: 'gueltig_bis', typ: 'datum', text: 'Gültig bis' },
      { name: 'ist_platzhalter', typ: 'text', text: 'ja/nein — noch nicht vom Steuerberater bestätigt (O-05)' },
    ],
  },
  {
    name: 'steuersaetze',
    text: 'Steuersatzgruppen der Plattform (gelten für alle Gesellschaften).',
    parameter: 'keine',
    sql: `select g.schluessel, g.bezeichnung, g.satz_bp::text as satz_bp, g.kategorie::text as kategorie,
                 g.steuer_kennzeichen::text as steuer_kennzeichen, g.befreiungsgrund_code,
                 g.gueltig_von::text as gueltig_von, g.gueltig_bis::text as gueltig_bis
            from steuersatz_gruppe g
           order by g.schluessel`,
    spalten: [
      { name: 'schluessel', typ: 'text', schluessel: true, text: 'Schlüssel der Gruppe' },
      { name: 'bezeichnung', typ: 'text', text: 'Bezeichnung' },
      { name: 'satz_bp', typ: 'zahl', text: 'Satz in Basispunkten (1900 = 19 %)' },
      { name: 'kategorie', typ: 'text', text: 'EN-16931-Steuerkategorie' },
      { name: 'steuer_kennzeichen', typ: 'text', text: 'Steuerkennzeichen' },
      { name: 'befreiungsgrund_code', typ: 'text', text: 'Befreiungsgrund (VATEX)' },
      { name: 'gueltig_von', typ: 'datum', text: 'Gültig ab' },
      { name: 'gueltig_bis', typ: 'datum', text: 'Gültig bis' },
    ],
  },
  {
    name: 'nummernkreise',
    text: 'Nummernkreise der Gesellschaft — Maske, Lückenlosigkeit, nächste Nummer, Öffnung und Schluss.',
    parameter: 'mandant',
    sql: `select n.id::text as id, n.kreis_typ::text as kreis_typ, n.bezeichnung, n.jahr::text as jahr,
                 ${JA_NEIN('n.lueckenlos')} as lueckenlos, n.format_maske,
                 n.zuruecksetzung::text as zuruecksetzung, n.naechste_nummer::text as naechste_nummer,
                 n.geoeffnet_am::text as geoeffnet_am, n.geschlossen_am::text as geschlossen_am,
                 ${JA_NEIN('n.ist_platzhalter')} as ist_platzhalter
            from nummernkreis n
           where n.mandant_id = $1::uuid
           order by n.kreis_typ, n.jahr, n.geoeffnet_am, n.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung des Kreises' },
      { name: 'kreis_typ', typ: 'text', text: 'Art des Kreises' },
      { name: 'bezeichnung', typ: 'text', text: 'Bezeichnung' },
      { name: 'jahr', typ: 'zahl', text: 'Jahr (0 = jahresübergreifend)' },
      { name: 'lueckenlos', typ: 'text', text: 'ja/nein' },
      { name: 'format_maske', typ: 'text', text: 'Nummernmaske' },
      { name: 'zuruecksetzung', typ: 'text', text: 'nie oder jaehrlich' },
      { name: 'naechste_nummer', typ: 'zahl', text: 'Nächste zu vergebende Nummer' },
      { name: 'geoeffnet_am', typ: 'datum', text: 'Geöffnet' },
      { name: 'geschlossen_am', typ: 'datum', text: 'Geschlossen' },
      { name: 'ist_platzhalter', typ: 'text', text: 'ja/nein' },
    ],
  },
  {
    name: 'perioden',
    text: 'Perioden des Wirtschaftsjahrs mit Status des Periodenschlosses und den beim Schließen eingefrorenen Zahlen.',
    parameter: 'zeitraum',
    sql: `select p.id::text as id, p.jahr::text as jahr, p.monat::text as monat,
                 p.beginn_am::text as beginn_am, p.ende_am::text as ende_am, p.status::text as status,
                 ${ZEIT('p.vorlaeufig_geschlossen_am')} as vorlaeufig_geschlossen_am,
                 ${ZEIT('p.geschlossen_am')} as geschlossen_am,
                 p.umsatz_erloes_cent::text as umsatz_erloes, p.aufwand_cent::text as aufwand,
                 p.ergebnis_cent::text as ergebnis
            from periode p
           where p.mandant_id = $1::uuid and p.beginn_am between $2::date and $3::date
           order by p.jahr, p.monat, p.id`,
    spalten: [
      { name: 'id', typ: 'text', schluessel: true, text: 'Kennung der Periode' },
      { name: 'jahr', typ: 'zahl', text: 'Jahr' },
      { name: 'monat', typ: 'zahl', text: 'Monat' },
      { name: 'beginn_am', typ: 'datum', text: 'Beginn' },
      { name: 'ende_am', typ: 'datum', text: 'Ende' },
      { name: 'status', typ: 'text', text: 'offen, vorlaeufig_geschlossen, geschlossen' },
      { name: 'vorlaeufig_geschlossen_am', typ: 'text', text: 'Vorläufiger Schluss, Europe/Berlin' },
      { name: 'geschlossen_am', typ: 'text', text: 'Endgültiger Schluss, Europe/Berlin' },
      { name: 'umsatz_erloes', typ: 'betrag', text: 'Eingefrorene Erlöse EUR' },
      { name: 'aufwand', typ: 'betrag', text: 'Eingefrorener Aufwand EUR' },
      { name: 'ergebnis', typ: 'betrag', text: 'Eingefrorenes Ergebnis EUR' },
    ],
  },
];

export class Z3Fehler extends Error {
  constructor(nachricht: string, readonly grund: 'wert' | 'spalte') {
    super(nachricht);
    this.name = 'Z3Fehler';
  }
}

/**
 * Cent → Dezimaltext mit Komma und Vorzeichen: `-123456n` → `-1234,56`.
 * Rein ueber Zeichenketten (Invariante 1). `null` → leer.
 */
export function dezimalText(cent: bigint | string | null): string {
  if (cent === null || cent === '') return '';
  const wert = typeof cent === 'bigint' ? cent : BigInt(cent);
  const betrag = wert < 0n ? -wert : wert;
  const roh = betrag.toString().padStart(3, '0');
  return `${wert < 0n ? '-' : ''}${roh.slice(0, -2)},${roh.slice(-2)}`;
}

/**
 * Ein CSV-Feld nach Beschreibungsstandard: Text in Anfuehrungszeichen, ein
 * enthaltenes verdoppelt; Zeilenumbrueche und Steuerzeichen werden zu
 * Leerzeichen — ein Feld darf seine Zeile nicht verlassen. Zahlen, Betraege
 * und Daten stehen unmaskiert; was ihre Gestalt nicht hat, ist ein Fehler,
 * kein stillschweigend krummer Wert.
 */
export function csvFeld(wert: unknown, typ: SpaltenTyp, spalte: string): string {
  if (wert === null || wert === undefined) return '';
  if (typ === 'text') {
    let text = String(wert);
    let sauber = '';
    for (const zeichen of text) {
      const punkt = zeichen.codePointAt(0) ?? 0;
      sauber += punkt < 0x20 || punkt === 0x7f ? ' ' : zeichen;
    }
    text = sauber;
    return `"${text.replace(/"/gu, '""')}"`;
  }
  const text = typeof wert === 'bigint' ? wert.toString() : String(wert);
  if (typ === 'betrag') {
    if (!/^-?\d+$/u.test(text)) throw new Z3Fehler(`${spalte}: "${text}" ist kein Centbetrag.`, 'wert');
    return dezimalText(text);
  }
  if (typ === 'zahl') {
    if (!/^-?\d+$/u.test(text)) throw new Z3Fehler(`${spalte}: "${text}" ist keine ganze Zahl.`, 'wert');
    return text;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new Z3Fehler(`${spalte}: "${text}" ist kein ISO-Datum.`, 'wert');
  return text;
}

/** Kopfzeile plus Zeilen, `;`-getrennt, CRLF — als Text (die Kodierung kommt danach). */
export function csvText(
  spalten: readonly Spalte[], zeilen: readonly Readonly<Record<string, unknown>>[],
): string {
  const kopf = spalten.map((s) => s.name).join(';');
  const koerper = zeilen.map((z) => spalten.map((s) => {
    if (!(s.name in z)) throw new Z3Fehler(`Spalte ${s.name} fehlt in der Abfrage.`, 'spalte');
    return csvFeld(z[s.name], s.typ, s.name);
  }).join(';'));
  return [kopf, ...koerper].map((zeile) => `${zeile}\r\n`).join('');
}

export function xmlText(wert: string): string {
  return wert
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}

function spalteXml(s: Spalte): string {
  const element = s.schluessel === true ? 'VariablePrimaryKey' : 'VariableColumn';
  const typ = s.typ === 'text' ? '<AlphaNumeric/>'
    : s.typ === 'zahl' ? '<Numeric/>'
      : s.typ === 'betrag' ? '<Numeric><Accuracy>2</Accuracy></Numeric>'
        : '<Date><Format>YYYY-MM-DD</Format></Date>';
  return `        <${element}>\n          <Name>${xmlText(s.name)}</Name>\n`
    + `          <Description>${xmlText(s.text)}</Description>\n          ${typ}\n        </${element}>\n`;
}

export interface IndexAngaben {
  readonly firma: string;
  readonly ort: string;
  readonly bezeichnung: string;
  readonly von: string;
  readonly bis: string;
  readonly tabellen: readonly { readonly spez: TabellenSpezifikation; readonly zeilen: number }[];
}

/**
 * `index.xml` nach dem Beschreibungsstandard fuer die Datentraegerueberlassung
 * (Version 1.0): DataSet → DataSupplier → Media → Table je CSV, mit
 * Spaltentyp, Dezimal- und Tausendersymbol, Trennzeichen und Kopfzeile
 * (`Range From=2`: die Daten beginnen in Zeile 2).
 *
 * Die DTD liegt dem Paket nicht bei (O-365); die Deklaration nennt sie, damit
 * eine Pruefsoftware sie aus ihrem eigenen Bestand zieht.
 */
export function indexXml(a: IndexAngaben): string {
  const tabellen = a.tabellen.map(({ spez }) => {
    const schluessel = spez.spalten.filter((s) => s.schluessel === true);
    const uebrige = spez.spalten.filter((s) => s.schluessel !== true);
    return `    <Table>\n      <URL>${xmlText(spez.name)}.csv</URL>\n      <Name>${xmlText(spez.name)}</Name>\n`
      + `      <Description>${xmlText(spez.text)}</Description>\n`
      + `      <Validity>\n        <Range>\n          <From>${a.von}</From>\n          <To>${a.bis}</To>\n        </Range>\n      </Validity>\n`
      + '      <DecimalSymbol>,</DecimalSymbol>\n      <DigitGroupingSymbol>.</DigitGroupingSymbol>\n'
      + '      <Range>\n        <From>2</From>\n      </Range>\n'
      + '      <VariableLength>\n        <ColumnDelimiter>;</ColumnDelimiter>\n'
      + '        <RecordDelimiter>&#13;&#10;</RecordDelimiter>\n        <TextEncapsulator>"</TextEncapsulator>\n'
      + [...schluessel, ...uebrige].map(spalteXml).join('')
      + '      </VariableLength>\n    </Table>\n';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<!DOCTYPE DataSet SYSTEM "${DTD_NAME}">\n`
    + '<DataSet>\n  <Version>1.0</Version>\n  <DataSupplier>\n'
    + `    <Name>${xmlText(a.firma)}</Name>\n    <Location>${xmlText(a.ort)}</Location>\n`
    + `    <Comment>${xmlText(`Datenträgerüberlassung (Z3) nach § 147 Abs. 6 AO, Wirtschaftsjahr ${a.bezeichnung}, `
      + `${a.von} bis ${a.bis}. Beträge in EUR mit Dezimalkomma, CSV in Windows-1252. ${HINWEIS_D06}`)}</Comment>\n`
    + '  </DataSupplier>\n  <Media>\n'
    + `    <Name>${xmlText(`Z3 ${a.bezeichnung} ${a.firma}`)}</Name>\n`
    + tabellen
    + '  </Media>\n</DataSet>\n';
}

export interface MandantRoh {
  readonly firma: string;
  readonly rechtsform: string | null;
  readonly ort: string | null;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ust_id: string | null;
  readonly steuernummer: string | null;
  readonly finanzamt: string | null;
  readonly handelsregister_gericht: string | null;
  readonly handelsregister_nummer: string | null;
  readonly kontenrahmen: string | null;
  readonly sachkontenlaenge: number | null;
  readonly konfig_platzhalter: boolean | null;
}

function liesmichText(p: {
  readonly m: MandantRoh; readonly bezeichnung: string; readonly von: string; readonly bis: string;
  readonly wj: Wirtschaftsjahr; readonly tabellen: readonly Z3Tabelle[];
  readonly unvollstaendig: number; readonly ersetzteZeichen: number;
}): string {
  const m = p.m;
  const zeilen = [
    `Z3-Datenträgerüberlassung (§ 147 Abs. 6 AO) — ${m.firma}${m.rechtsform === null ? '' : ` (${m.rechtsform})`}`,
    `Wirtschaftsjahr ${p.bezeichnung}: ${p.von} bis ${p.bis}`,
    '',
    'GESELLSCHAFT',
    `  Anschrift: ${[m.strasse, [m.plz, m.ort].filter((x) => x !== null).join(' ')].filter((x) => x !== null && x !== '').join(', ') || '—'}`,
    `  USt-IdNr.: ${m.ust_id ?? '—'} · Steuernummer: ${m.steuernummer ?? '—'} · Finanzamt: ${m.finanzamt ?? '—'}`,
    `  Handelsregister: ${[m.handelsregister_gericht, m.handelsregister_nummer].filter((x) => x !== null).join(' ') || '—'}`,
    `  Kontenrahmen: ${m.kontenrahmen ?? 'nicht festgelegt'}${m.sachkontenlaenge === null ? '' : `, Sachkontenlänge ${String(m.sachkontenlaenge)}`}`
      + `${m.konfig_platzhalter === true ? ' — PLATZHALTER, vom Steuerberater noch nicht bestätigt (O-05)' : ''}`,
    `  Wirtschaftsjahr beginnt am ${String(p.wj.beginnTag)}.${String(p.wj.beginnMonat)}.`
      + `${p.wj.istPlatzhalter ? ' — angenommen (Kalenderjahr, O-05)' : ''}`,
    '',
    'INHALT',
    '  index.xml       Strukturbeschreibung nach dem Beschreibungsstandard für die Datenträgerüberlassung',
    `                  (Version 1.0, DTD ${DTD_NAME} — die DTD selbst liegt nicht bei, O-365)`,
    '  pruefsummen.txt SHA-256 jeder Datei; prüfen mit: sha256sum -c pruefsummen.txt',
    ...p.tabellen.map((t) => `  ${t.datei.padEnd(24)}${String(t.zeilen).padStart(7)} Zeilen — ${t.text}`),
    '',
    'FORMAT',
    '  CSV: Trennzeichen ";", Textfelder in Anführungszeichen (enthaltene verdoppelt), Zeilenende CRLF,',
    '  erste Zeile = Spaltennamen, Zeichensatz Windows-1252 (ANSI). Beträge in EUR mit Dezimalkomma, ohne',
    '  Tausenderpunkt; Daten als JJJJ-MM-TT; Zeitpunkte als JJJJ-MM-TT HH:MM:SS in Europe/Berlin.',
    '  Im Journal steht der Umsatz ohne Vorzeichen; die Richtung steht in soll_haben.',
    `  Zeichen außerhalb von Windows-1252 wurden durch "?" ersetzt: ${String(p.ersetzteZeichen)}.`,
    '',
    'HINWEISE',
    `  Buchungszeilen des Zeitraums ohne Beleg oder ohne Konto: ${String(p.unvollstaendig)}`
      + `${p.unvollstaendig > 0 ? ' — sie stehen im Journal (Spalten beleg_id, konto leer); das Paket zeigt den Stand, es bereinigt ihn nicht.' : '.'}`,
    '  Kreditoren- und Debitorennummern sowie Bankverbindungen sind der Anwendungsrolle spaltenweise entzogen',
    '  und stehen nicht im Stamm; die Kontonummern tragen die Zuordnungen in konten.csv.',
    '  Personal- und Zeitdaten gehören nicht in diese Überlassung; sie sind kein Teil der Buchführung.',
    '  Das Paket ist reproduzierbar: derselbe Jahrgang ergibt dieselben Bytes und denselben SHA-256,',
    '  solange sich die Daten nicht ändern. Wann es abgerufen wurde, steht im Protokoll der Plattform.',
    `  ${HINWEIS_D06}`,
    '',
  ];
  return zeilen.map((z) => `${z}\r\n`).join('');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function zaehleErsetzt(text: string): number {
  let n = 0;
  for (const zeichen of text) if (!passtInCp1252(zeichen)) n += 1;
  return n;
}

export interface Z3Tabellenlauf {
  readonly wirtschaftsjahr: Wirtschaftsjahr;
  readonly von: string;
  readonly bis: string;
  readonly bezeichnung: string;
  readonly mandant: MandantRoh;
  readonly tabellen: readonly Z3Tabelle[];
  readonly beschrieben: readonly { readonly spez: TabellenSpezifikation; readonly zeilen: number }[];
  readonly eintraege: readonly { readonly pfad: string; readonly bytes: Uint8Array }[];
  readonly unvollstaendig: number;
  readonly ersetzteZeichen: number;
}

/**
 * Die Tabellen eines Wirtschaftsjahrs als CSV-Eintraege — der Teil, den das
 * Z3-Paket und das Jahrespaket (ACC-11) gemeinsam haben. Wer die Tabellen
 * braucht, ruft das hier; das Paket legt Index, LIESMICH und Pruefsummen
 * darum.
 */
export async function baueZ3Tabellen(db: Z3Kontext, jahr: number): Promise<Z3Tabellenlauf> {
  const wj = await liesWirtschaftsjahr(db);
  const { von, bis, bezeichnung } = wirtschaftsjahrZeitraum(jahr, wj);
  const mandantId = db.aktiverMandantId;

  const [m] = await db.abfrage<MandantRoh>(
    `select m.firma, m.rechtsform, m.ort, m.strasse, m.plz, m.ust_id, m.steuernummer, m.finanzamt,
            m.handelsregister_gericht, m.handelsregister_nummer,
            k.kontenrahmen::text as kontenrahmen, k.sachkontenlaenge, k.ist_platzhalter as konfig_platzhalter
       from mandant m
       left join datev_konfiguration k on k.mandant_id = m.id
      where m.id = $1::uuid`, [mandantId]);
  if (m === undefined) throw new Z3Fehler('Die Gesellschaft ist nicht lesbar.', 'wert');

  const [offen] = await db.abfrage<{ n: number }>(
    `select count(*)::int as n from app.export_unvollstaendig($1::uuid, $2::date, $3::date)`,
    [mandantId, von, bis]);
  const unvollstaendig = offen?.n ?? 0;

  const eintraege: { pfad: string; bytes: Uint8Array }[] = [];
  const tabellen: Z3Tabelle[] = [];
  const beschrieben: { spez: TabellenSpezifikation; zeilen: number }[] = [];
  let ersetzteZeichen = 0;
  for (const spez of TABELLEN) {
    const werte = spez.parameter === 'keine' ? []
      : spez.parameter === 'mandant' ? [mandantId] : [mandantId, von, bis];
    const zeilen = await db.abfrage<Readonly<Record<string, unknown>>>(spez.sql, werte);
    const text = csvText(spez.spalten, zeilen);
    ersetzteZeichen += zaehleErsetzt(text);
    const bytes = nachCp1252(text);
    const datei = `${spez.name}.csv`;
    eintraege.push({ pfad: datei, bytes });
    tabellen.push({ name: spez.name, datei, text: spez.text, zeilen: zeilen.length,
      sha256: sha256(bytes), groesseBytes: bytes.byteLength });
    beschrieben.push({ spez, zeilen: zeilen.length });
  }
  return { wirtschaftsjahr: wj, von, bis, bezeichnung, mandant: m, tabellen, beschrieben,
    eintraege, unvollstaendig, ersetzteZeichen };
}

/** Baut das Paket eines Wirtschaftsjahrs — vollstaendig im Speicher, ohne Objektspeicher. */
export async function erstelleZ3Paket(db: Z3Kontext, jahr: number): Promise<Z3Paket> {
  const lauf = await baueZ3Tabellen(db, jahr);
  const { wirtschaftsjahr: wj, von, bis, bezeichnung, mandant: m, tabellen, beschrieben,
    unvollstaendig, ersetzteZeichen } = lauf;
  const mandantId = db.aktiverMandantId;
  const eintraege = [...lauf.eintraege];

  const index = new TextEncoder().encode(indexXml({
    firma: m.firma, ort: m.ort ?? '', bezeichnung, von, bis, tabellen: beschrieben,
  }));
  const liesmich = new TextEncoder().encode(liesmichText({
    m, bezeichnung, von, bis, wj, tabellen, unvollstaendig, ersetzteZeichen,
  }));
  eintraege.push({ pfad: INDEX_NAME, bytes: index }, { pfad: LIESMICH_NAME, bytes: liesmich });
  const pruefsummen = new TextEncoder().encode(
    [...eintraege].sort((a, b) => (a.pfad < b.pfad ? -1 : 1))
      .map((e) => `${sha256(e.bytes)}  ${e.pfad}\n`).join(''));
  eintraege.push({ pfad: PRUEFSUMMEN_NAME, bytes: pruefsummen });

  const zip = schreibeZip(eintraege);
  return {
    mandantId, firma: m.firma, jahr, von, bis, bezeichnung, wirtschaftsjahr: wj,
    tabellen, unvollstaendig, ersetzteZeichen,
    indexXml: index, liesmich, pruefsummen, zip, zipSha256: sha256(zip),
  };
}
