/**
 * Die Wörter der Lieferantenstammdaten — in beiden Sprachen (V-006, D-592).
 *
 * **`Lieferant` bleibt stehen, auch im englischen Text.** Der Begriff ist im
 * deutschen Rechnungswesen an den Kreditor gebunden: `lieferantennummer` und
 * `kreditorennummer` sind zwei verschiedene Dinge — die erste ist die des
 * Hauses, die zweite die des DATEV-Kontenrahmens. „Supplier" für beides zu
 * schreiben verwischt genau diese Unterscheidung, an der der Export hängt.
 *
 * **§ 48 EStG und § 13b UStG stehen mit ihrer Nummer da.** Die Paragraphen
 * sind in beiden Sprachen dieselben; übersetzt wird, was sie bedeuten.
 */
import type { InternSprache } from '../../intern.js';

export interface LieferantenTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly neu: string;
  readonly neuTitel: string;
  readonly bearbeitenTitel: string;

  readonly nummer: string;
  readonly name: string;
  readonly nameBeispiel: string;
  readonly anschrift: string;
  readonly strasse: string;
  readonly hausnummer: string;
  readonly plz: string;
  readonly ort: string;
  readonly land: string;
  readonly landErklaerung: string;

  readonly kontakt: string;
  readonly email: string;
  readonly telefon: string;

  readonly steuer: string;
  readonly ustId: string;
  readonly ustIdErklaerung: string;
  readonly steuernummer: string;

  readonly bank: string;
  readonly iban: string;
  readonly ibanErklaerung: string;
  readonly ibanNichtLesbar: string;
  readonly bic: string;
  readonly zahlungsziel: string;
  readonly zahlungszielErklaerung: string;

  readonly bauleistung: string;
  readonly leistungsart: string;
  readonly leistungsartKeine: string;
  readonly leistungsartBau: string;
  readonly leistungsartReinigung: string;
  readonly leistungsartErklaerung: string;
  readonly bauleistenderBis: string;
  readonly bauleistenderErklaerung: string;

  readonly status: string;
  readonly statusAktiv: string;
  readonly statusGesperrt: string;
  readonly sperren: string;
  readonly entsperren: string;
  readonly sperrenErklaerung: string;
  readonly archivieren: string;
  readonly archivierenErklaerung: string;

  readonly rechnungen: string;
  readonly keine: string;
  readonly keineErklaerung: string;
  readonly keinSchreibrecht: string;
  readonly freiwillig: string;
  readonly speichern: string;
  readonly anlegen: string;
}

export const LIEFERANTEN_TEXTE: Readonly<Record<InternSprache, LieferantenTexte>> = {
  de: {
    modul: 'Lieferanten',
    titel: 'Lieferanten',
    untertitel:
      'Die Kreditorenstammdaten dieser Gesellschaft. Jede Eingangsrechnung '
      + 'verlangt einen Lieferanten — er kommt zuerst.',
    neu: 'Neuer Lieferant',
    neuTitel: 'Neuer Lieferant',
    bearbeitenTitel: 'Lieferant bearbeiten',

    nummer: 'Nummer',
    name: 'Name',
    nameBeispiel: 'Firmenname, wie er auf der Rechnung steht',
    anschrift: 'Anschrift',
    strasse: 'Strasse',
    hausnummer: 'Hausnummer',
    plz: 'PLZ',
    ort: 'Ort',
    land: 'Land',
    landErklaerung:
      'Zwei Buchstaben (DE, AT, PL). Bei einem Lieferanten ausserhalb '
      + 'Deutschlands entscheidet das Land über die Umsatzsteuerbehandlung.',

    kontakt: 'Kontakt',
    email: 'E-Mail',
    telefon: 'Telefon',

    steuer: 'Steuer',
    ustId: 'Umsatzsteuer-Identifikationsnummer',
    ustIdErklaerung:
      'Nötig für den innergemeinschaftlichen Erwerb und für § 13b UStG. Die '
      + 'Plattform prüft sie NICHT gegen das Bundeszentralamt — dafür ist keine '
      + 'Schnittstelle verbunden.',
    steuernummer: 'Steuernummer',

    bank: 'Bankverbindung',
    iban: 'IBAN',
    ibanErklaerung:
      'Wird auf Prüfziffer geprüft, nicht nur auf Gestalt — ein Zahlendreher '
      + 'ergibt sonst eine gültig aussehende IBAN, die an den Falschen geht. '
      + 'Jede Änderung wird protokolliert: „unsere Bankverbindung hat sich '
      + 'geändert" ist der häufigste Rechnungsbetrug im Mittelstand.',
    ibanNichtLesbar:
      'Die hinterlegte Bankverbindung wird hier nicht angezeigt — sie ist der '
      + 'Anwendung spaltenweise entzogen und nur über einen protokollierten Weg '
      + 'lesbar. Ein leeres Feld lässt sie unverändert; nur eine eingetragene '
      + 'IBAN ersetzt sie.',
    bic: 'BIC',
    zahlungsziel: 'Zahlungsziel in Tagen',
    zahlungszielErklaerung:
      'Ohne Vorgabe: ein Zahlungsziel ist eine Vereinbarung mit diesem '
      + 'Lieferanten, keine Hauspolitik. Leer heisst „nicht vereinbart" — und '
      + 'die Plattform rechnet dann keine Fälligkeit.',

    bauleistung: 'Bauleistung (§ 13b UStG, § 48 EStG)',
    leistungsart: 'Art der Leistung',
    leistungsartKeine: 'keine Bauleistung',
    leistungsartBau: 'Bauleistung (§ 13b Abs. 2 Nr. 4)',
    leistungsartReinigung: 'Gebäudereinigung (§ 13b Abs. 2 Nr. 8)',
    leistungsartErklaerung:
      'Entscheidet, ob die Steuerschuld auf den Leistungsempfänger übergeht. '
      + 'Die beiden Nummern sind nicht dasselbe und haben verschiedene '
      + 'Voraussetzungen — nur eine davon trifft zu.',
    bauleistenderBis: 'Freistellungsbescheinigung gültig bis (§ 48b EStG)',
    bauleistenderErklaerung:
      'Ein DATUM, kein Häkchen: eine Bescheinigung läuft ab. Ohne gültige '
      + 'Bescheinigung sind 15 % der Gegenleistung einzubehalten und ans '
      + 'Finanzamt abzuführen — wer das unterlässt, haftet dafür (§ 48a Abs. 3 '
      + 'EStG). Leer heisst: keine Bescheinigung vorgelegt.',

    status: 'Status',
    statusAktiv: 'aktiv',
    statusGesperrt: 'gesperrt',
    sperren: 'Sperren',
    entsperren: 'Sperre aufheben',
    sperrenErklaerung:
      'Ein gesperrter Lieferant bleibt in jeder Buchung stehen, die auf ihn '
      + 'zeigt; was endet, ist die Bereitschaft, neue Rechnungen von ihm '
      + 'anzunehmen. Der Fall „Qualitätsstreit" oder „Insolvenzverdacht" — und '
      + 'er ist umkehrbar.',
    archivieren: 'Archivieren',
    archivierenErklaerung:
      'Gelöscht wird nichts: an einem Lieferanten hängen Eingangsrechnungen mit '
      + 'zehnjähriger Aufbewahrung und der § 48-EStG-Nachweis. Solange noch '
      + 'Rechnungen offen sind, geht die Archivierung nicht — eine offene '
      + 'Zahlung zeigte sonst auf einen Empfänger, den niemand mehr auswählen '
      + 'kann.',

    rechnungen: 'Eingangsrechnungen',
    keine: 'Noch kein Lieferant erfasst.',
    keineErklaerung:
      'Jede Eingangsrechnung verlangt einen Lieferanten. Ohne ihn lässt sich '
      + 'keine Rechnung erfassen — er ist der erste Schritt der '
      + 'Kreditorenbuchhaltung.',
    keinSchreibrecht: 'Das Anlegen verlangt',
    freiwillig: '(freiwillig)',
    speichern: 'Änderungen speichern',
    anlegen: 'Lieferant anlegen',
  },

  en: {
    modul: 'Lieferanten (suppliers / accounts payable)',
    titel: 'Lieferanten',
    untertitel:
      'The accounts-payable master data of this Gesellschaft. Every incoming '
      + 'invoice requires a Lieferant — it comes first.',
    neu: 'New Lieferant',
    neuTitel: 'New Lieferant',
    bearbeitenTitel: 'Edit Lieferant',

    nummer: 'Number',
    name: 'Name',
    nameBeispiel: 'company name as it appears on the invoice',
    anschrift: 'Address',
    strasse: 'Street',
    hausnummer: 'No.',
    plz: 'Postcode',
    ort: 'Town',
    land: 'Country',
    landErklaerung:
      'Two letters (DE, AT, PL). For a supplier outside Germany the country '
      + 'decides the VAT treatment.',

    kontakt: 'Contact',
    email: 'Email',
    telefon: 'Phone',

    steuer: 'Tax',
    ustId: 'VAT identification number',
    ustIdErklaerung:
      'Needed for intra-Community acquisition and for § 13b UStG. The platform '
      + 'does NOT verify it against the federal tax office — no interface is '
      + 'connected.',
    steuernummer: 'Tax number',

    bank: 'Bank details',
    iban: 'IBAN',
    ibanErklaerung:
      'Checked on its check digits, not only its shape — a transposed pair of '
      + 'digits otherwise yields a valid-looking IBAN that pays the wrong '
      + 'party. Every change is logged: “our bank details have changed” is the '
      + 'most common invoice fraud.',
    ibanNichtLesbar:
      'The stored bank details are not shown here — they are withheld from the '
      + 'application column by column and readable only through a logged path. '
      + 'An empty field leaves them unchanged; only an entered IBAN replaces '
      + 'them.',
    bic: 'BIC',
    zahlungsziel: 'Payment terms in days',
    zahlungszielErklaerung:
      'No default: payment terms are an agreement with this supplier, not house '
      + 'policy. Empty means “not agreed” — and the platform then computes no '
      + 'due date.',

    bauleistung: 'Construction work (§ 13b UStG, § 48 EStG)',
    leistungsart: 'Type of service',
    leistungsartKeine: 'not construction work',
    leistungsartBau: 'Construction work (§ 13b(2) no. 4)',
    leistungsartReinigung: 'Building cleaning (§ 13b(2) no. 8)',
    leistungsartErklaerung:
      'Decides whether the VAT liability shifts to the recipient. The two '
      + 'numbers are not the same and have different conditions — only one of '
      + 'them applies.',
    bauleistenderBis: 'Exemption certificate valid until (§ 48b EStG)',
    bauleistenderErklaerung:
      'A DATE, not a checkbox: a certificate expires. Without a valid one, 15 % '
      + 'of the consideration must be withheld and paid to the tax office — '
      + 'whoever omits it is liable for it (§ 48a(3) EStG). Empty means no '
      + 'certificate was presented.',

    status: 'Status',
    statusAktiv: 'active',
    statusGesperrt: 'blocked',
    sperren: 'Block',
    entsperren: 'Unblock',
    sperrenErklaerung:
      'A blocked Lieferant stays in every booking that points to it; what ends '
      + 'is the willingness to accept new invoices from it. The '
      + '“quality dispute” or “suspected insolvency” case — and it is '
      + 'reversible.',
    archivieren: 'Archive',
    archivierenErklaerung:
      'Nothing is deleted: incoming invoices with a ten-year retention and the '
      + '§ 48 EStG record hang off a Lieferant. While invoices are still open, '
      + 'archiving is refused — an open payment would otherwise point to a '
      + 'payee nobody can select any more.',

    rechnungen: 'Incoming invoices',
    keine: 'No Lieferant on file yet.',
    keineErklaerung:
      'Every incoming invoice requires a Lieferant. Without one no invoice can '
      + 'be recorded — it is the first step of accounts payable.',
    keinSchreibrecht: 'Creating one requires',
    freiwillig: '(optional)',
    speichern: 'Save changes',
    anlegen: 'Create Lieferant',
  },
};
