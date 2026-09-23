/**
 * Die Wörter der Kette Lead → Angebot → Auftrag → Rechnung — in beiden
 * Sprachen (V-138, V-139, V-140, CRM-05, CRM-06, CRM-07, D-592).
 *
 * Leadblatt, Kundenblatt, die Masken „Neues Angebot", „Neuer Auftrag" und
 * „Neuer Lead", das Raumbuch und die Bekanntmachung im Radar tragen dieselben
 * Begriffe; sie stehen deshalb an EINER Stelle.
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text** — `Lead`,
 * `Kunde`, `Angebot`, `Auftrag`, `Rechnung`, `Vergaberadar`: erklärt wird in
 * Klammern, ersetzt wird nicht (siehe `./basis.ts`).
 */
import type { InternSprache } from '../intern.js';

export interface KetteTexte {
  /* ── Leadblatt: die Kette ──────────────────────────────────────────── */
  readonly ketteTitel: string;
  readonly ketteErklaerung: string;
  readonly herkunft: string;
  readonly quelleWerte: Readonly<Record<string, string>>;
  readonly empfohlenVon: (name: string) => string;
  readonly bekanntmachung: string;
  readonly kunde: string;
  readonly ohneKunde: string;
  readonly uebernehmenTitel: string;
  readonly uebernehmenErklaerung: string;
  readonly name: string;
  readonly art: string;
  readonly artWerte: Readonly<Record<string, string>>;
  readonly ustId: string;
  readonly ustIdErklaerung: string;
  readonly uebernehmen: string;
  readonly zuordnenTitel: string;
  readonly zuordnenErklaerung: string;
  readonly kundeWaehlen: string;
  readonly zuordnen: string;
  readonly angebotErstellen: string;
  readonly auftragAnlegen: string;
  readonly ausRaumbuch: string;
  readonly angeboteTitel: string;
  readonly auftraegeTitel: string;
  readonly rechnungenTitel: string;
  readonly keineAngebote: string;
  readonly keineAuftraege: string;
  readonly keineRechnungen: string;
  readonly ohneRecht: string;

  /* ── Spalten ───────────────────────────────────────────────────────── */
  readonly nummer: string;
  readonly titel: string;
  readonly status: string;
  readonly netto: string;
  readonly wertNetto: string;
  readonly brutto: string;
  readonly datum: string;
  readonly angelegt: string;
  readonly start: string;
  readonly ohneNummer: string;
  readonly offen: string;
  readonly beschriftungAngebote: string;
  readonly beschriftungAuftraege: string;
  readonly beschriftungRechnungen: string;

  /* ── Kundenblatt ───────────────────────────────────────────────────── */
  readonly anfragenTitel: string;
  readonly keineAnfragen: string;
  readonly keineAngeboteKunde: string;
  readonly keineRechnungenKunde: string;
  readonly dokumenteTitel: string;
  readonly keineDokumente: string;
  readonly kategorieWerte: Readonly<Record<string, string>>;
  readonly verlaufTitel: string;
  readonly verlaufErklaerung: string;
  readonly keinVerlauf: string;
  readonly typWerte: Readonly<Record<string, string>>;
  readonly richtungWerte: Readonly<Record<string, string>>;
  readonly zurAnfrage: string;
  readonly beschriftungAnfragen: string;
  readonly beschriftungDokumente: string;

  /* ── Neuer Lead: die Empfehlung ────────────────────────────────────── */
  readonly empfohlenVonFeld: string;
  readonly keineEmpfehlung: string;
  readonly empfehlungErklaerung: string;

  /* ── Radar: die Übernahme ──────────────────────────────────────────── */
  readonly radarTitel: string;
  readonly radarErklaerung: string;
  readonly auftraggeber: string;
  readonly radarUebernehmen: string;
  readonly radarSchon: (leadnummer: string) => string;
  readonly zumLead: string;

  /* ── Masken mit ?lead= ─────────────────────────────────────────────── */
  readonly zurAnfrageVorbelegt: (leadnummer: string, betreff: string) => string;
  readonly anfrageOhneKunde: string;
  readonly anfrageUnbekannt: string;
  readonly kundeAusAnfrage: string;
  readonly anfrage: string;
  readonly raumbuchAnfrage: string;

  readonly nichtAngelegt: string;
  /** Die Abweisungen der Kette — Leadblatt, Radar, „Neuer Lead". */
  readonly fehler: Readonly<Record<string, string>>;
  /**
   * Die Abweisungen der beiden Masken, die ein Formular zurückschicken
   * (Raumbuch → Angebot, „Neuer Auftrag"). Getrennt von `fehler`, weil
   * derselbe Schlüssel dort etwas anderes meint: `unvollstaendig` ist auf dem
   * Leadblatt eine Wiedervorlage ohne Betreff, hier ein Auftrag ohne Start.
   */
  readonly maskeFehler: Readonly<Record<string, string>>;
}

const DE: KetteTexte = {
  ketteTitel: 'Kunde, Angebote und Aufträge',
  ketteErklaerung:
    'Die Anfrage ist der Anfang der Kette: aus ihr entsteht ein Angebot, aus dem Angebot '
    + 'ein Auftrag, aus dem Auftrag eine Rechnung. Über diese Kette zählt der '
    + 'Herkunftsbericht, welcher Kanal Aufträge gebracht hat.',
  herkunft: 'Herkunft',
  quelleWerte: {
    webformular: 'Webformular',
    vergabe_radar: 'Vergaberadar',
    manuell: 'Von Hand erfasst',
    empfehlung: 'Empfehlung',
    akquise: 'Akquise',
  },
  empfohlenVon: (name) => `Empfohlen von ${name}`,
  bekanntmachung: 'Bekanntmachung',
  kunde: 'Kunde',
  ohneKunde:
    'Dieser Anfrage ist noch kein Kunde zugeordnet. Ein Angebot braucht einen Empfänger — '
    + 'übernehmen Sie die Anfrage als Kunden oder ordnen Sie einen bestehenden zu.',
  uebernehmenTitel: 'Als Kunde übernehmen',
  uebernehmenErklaerung:
    'Legt den Kunden mit dem Namen aus der Anfrage an; der Anfragende wird sein '
    + 'Ansprechpartner. Die Rechtsgrundlage für Werbung ist danach „keine" — sie setzt ein '
    + 'Mensch mit Quelle und Datum am Kunden. Die Antwort auf die Anfrage bleibt möglich.',
  name: 'Name',
  art: 'Art',
  artWerte: { firma: 'Firma', behoerde: 'Behörde', privat: 'Privatperson' },
  ustId: 'USt-IdNr.',
  ustIdErklaerung:
    'Mit USt-IdNr. erkennt die Gruppenansicht denselben Kunden in einer anderen '
    + 'Gesellschaft. Ohne sie bleibt er dort allein — ein gleicher Name ist keine gleiche Firma.',
  uebernehmen: 'Als Kunde übernehmen',
  zuordnenTitel: 'Einem bestehenden Kunden zuordnen',
  zuordnenErklaerung:
    'Für die Anfrage eines Kunden, den es schon gibt. Der Anfragende wird sein '
    + 'Ansprechpartner, wenn er noch keinem Kunden gehört.',
  kundeWaehlen: 'Kunden wählen',
  zuordnen: 'Zuordnen',
  angebotErstellen: 'Angebot erstellen',
  auftragAnlegen: 'Auftrag direkt anlegen',
  ausRaumbuch: 'Angebot aus dem Raumbuch',
  angeboteTitel: 'Angebote',
  auftraegeTitel: 'Aufträge',
  rechnungenTitel: 'Rechnungen',
  keineAngebote: 'Noch kein Angebot zu dieser Anfrage.',
  keineAuftraege: 'Noch kein Auftrag aus dieser Anfrage.',
  keineRechnungen: 'Noch keine Rechnung zu diesen Aufträgen.',
  ohneRecht: 'Sichtbar für, wer dieses Recht hält:',

  nummer: 'Nummer',
  titel: 'Titel',
  status: 'Status',
  netto: 'Netto',
  wertNetto: 'Wert netto',
  brutto: 'Brutto',
  datum: 'Datum',
  angelegt: 'Angelegt',
  start: 'Start',
  ohneNummer: 'Entwurf',
  offen: 'offen',
  beschriftungAngebote: 'Angebote zu dieser Anfrage',
  beschriftungAuftraege: 'Aufträge aus dieser Anfrage',
  beschriftungRechnungen: 'Rechnungen zu diesen Aufträgen',

  anfragenTitel: 'Anfragen',
  keineAnfragen: 'Keine Anfrage dieses Kunden.',
  keineAngeboteKunde: 'Noch kein Angebot für diesen Kunden.',
  keineRechnungenKunde: 'Noch keine Rechnung an diesen Kunden.',
  dokumenteTitel: 'Dokumente',
  keineDokumente: 'Kein Dokument an diesem Kunden.',
  kategorieWerte: {
    kunde: 'Kundenunterlage', vertrag: 'Vertrag', angebot: 'Angebot', rechnung: 'Rechnung',
    beleg: 'Beleg', mitarbeiter: 'Personal', projekt: 'Projekt',
    buchhaltung: 'Buchhaltung', unternehmen: 'Unternehmen',
  },
  verlaufTitel: 'Kommunikation und Verlauf',
  verlaufErklaerung:
    'Was am Kunden und an seinen Anfragen festgehalten wurde — die letzten zwanzig Einträge.',
  keinVerlauf: 'Noch nichts festgehalten.',
  typWerte: {
    notiz: 'Notiz', anruf: 'Anruf', email: 'E-Mail', termin: 'Termin', aufgabe: 'Aufgabe',
    system: 'System',
  },
  richtungWerte: { eingehend: 'eingehend', ausgehend: 'ausgehend', intern: 'intern' },
  zurAnfrage: 'zur Anfrage',
  beschriftungAnfragen: 'Anfragen dieses Kunden',
  beschriftungDokumente: 'Dokumente dieses Kunden',

  empfohlenVonFeld: 'Empfohlen von (Kunde)',
  keineEmpfehlung: '— keine Empfehlung —',
  empfehlungErklaerung:
    'Kam die Anfrage auf Empfehlung eines Kunden, wählen Sie ihn hier. Der Herkunftsbericht '
    + 'zählt sie dann unter „Empfehlung" statt unter „Von Hand erfasst".',

  radarTitel: 'Als Lead übernehmen',
  radarErklaerung:
    'Legt eine Anfrage mit der Herkunft „Vergaberadar" an — Titel, Beschreibung und '
    + 'Auftraggeber aus der Bekanntmachung, den Wert nur, wenn er in Euro genannt ist. Der '
    + 'Stand der Bekanntmachung bleibt, wie er ist.',
  auftraggeber: 'Auftraggeber (Vergabestelle)',
  radarUebernehmen: 'Als Lead übernehmen',
  radarSchon: (nr) => `Diese Bekanntmachung ist schon als Lead ${nr} übernommen.`,
  zumLead: 'Zum Lead',

  zurAnfrageVorbelegt: (nr, betreff) => `Zur Anfrage ${nr}: ${betreff}`,
  anfrageOhneKunde:
    'Die Anfrage hat noch keinen Kunden. Übernehmen Sie sie zuerst auf dem Leadblatt als '
    + 'Kunden oder ordnen Sie einen bestehenden zu — sonst entsteht der Vorgang ohne Bezug.',
  anfrageUnbekannt:
    'Diese Anfrage ist nicht erreichbar. Der Vorgang entsteht ohne Bezug zu einer Anfrage.',
  kundeAusAnfrage: 'Der Kunde kommt aus der Anfrage und steht damit fest.',
  anfrage: 'Anfrage',
  raumbuchAnfrage:
    'Dieses Angebot antwortet auf eine Anfrage. Sie muss demselben Kunden gehören wie das '
    + 'Objekt — sonst wird es nicht angelegt.',

  nichtAngelegt: 'Das wurde nicht angelegt. Es wurde nichts geändert.',
  fehler: {
    lead_unbekannt: 'Diese Anfrage ist in dieser Gesellschaft nicht erreichbar.',
    lead_ohne_kunde:
      'Die Anfrage hat noch keinen Kunden. Übernehmen Sie sie als Kunden oder ordnen Sie '
      + 'einen bestehenden zu.',
    lead_kunde_abweichend:
      'Die Anfrage gehört einem anderen Kunden als dieser Vorgang.',
    lead_hat_kunde: 'Diese Anfrage hat schon einen Kunden.',
    lead_hat_vorgaenge:
      'An dieser Anfrage hängt schon ein Angebot oder Auftrag. Ihr Kunde bleibt.',
    kunde_unbekannt: 'Diesen Kunden gibt es in dieser Gesellschaft nicht.',
    name_fehlt: 'Ein Kunde braucht einen Namen.',
    typ_fehlt: 'Bitte wählen Sie eine Art.',
    empfehlung_ohne_kunde:
      'Eine Empfehlung nennt den Kunden, der empfohlen hat.',
    empfehlung_selbst:
      'Ein Kunde empfiehlt sich nicht selbst. Eine neue Anfrage eines Bestandskunden ist '
      + 'eine Erfassung von Hand.',
    unbekannte_quelle: 'Diese Herkunft gibt es hier nicht.',
    ohne_namen:
      'Ein Lead braucht einen Namen: einen bestehenden Kunden oder eine Firma im Klartext.',
    betreff_fehlt: 'Ein Lead braucht einen Betreff.',
    schon_uebernommen: 'Diese Bekanntmachung ist schon als Lead übernommen.',
    ausschreibung_unbekannt: 'Diese Bekanntmachung ist nicht erreichbar.',
    ohne_auftraggeber:
      'Die Bekanntmachung nennt keine Vergabestelle. Bitte tragen Sie den Auftraggeber ein.',
    ohne_titel: 'Die Bekanntmachung hat keinen Titel.',
    kein_schreibrecht: 'Dafür fehlt das Recht crm.schreiben.',
  },
  maskeFehler: {
    unbepreiste_flaeche:
      'Ein Teil der Fläche ist nicht bepreisbar — Räume ohne Belagsart oder Belagsarten ohne '
      + 'gültigen Leistungswert. Bitte zuerst das Raumbuch vervollständigen.',
    turnus: 'Diesen Turnus gibt es nicht.',
    unvollstaendig: 'Es fehlt eine Pflichtangabe — Kunde, Bezeichnung, Art oder Start.',
    keine_zahl: 'Personalbedarf oder Wochenstunden ist keine Zahl.',
    ausserhalb_bereich:
      'Personalbedarf (ganze Personen, 0 bis 5.000) oder Wochenstunden (0 bis 10.000) liegt '
      + 'außerhalb des Bereichs.',
    kein_kreis: 'Für diesen Vorgang ist in dieser Gesellschaft kein Nummernkreis eingerichtet.',
    platzhalter: 'Der Nummernkreis ist noch ein Platzhalter und vergibt keine Nummer.',
    geschlossen: 'Der Nummernkreis ist geschlossen.',
    definer_kreis: 'Der Nummernkreis ist nicht richtig eingerichtet.',
    maske_ungueltig: 'Die Nummernmaske des Kreises ist ungültig.',
  },
};

const EN: KetteTexte = {
  ketteTitel: 'Kunde (customer), quotes and orders',
  ketteErklaerung:
    'The enquiry starts the chain: it leads to an Angebot (quote), the quote to an Auftrag '
    + '(order), the order to a Rechnung (invoice). The origin report counts which channel '
    + 'brought orders along this chain.',
  herkunft: 'Origin',
  quelleWerte: {
    webformular: 'Website form',
    vergabe_radar: 'Vergaberadar (tender radar)',
    manuell: 'Entered by hand',
    empfehlung: 'Referral',
    akquise: 'Akquise (prospecting)',
  },
  empfohlenVon: (name) => `Referred by ${name}`,
  bekanntmachung: 'Tender notice',
  kunde: 'Kunde (customer)',
  ohneKunde:
    'No customer is assigned to this enquiry yet. A quote needs a recipient — take the '
    + 'enquiry over as a customer or assign an existing one.',
  uebernehmenTitel: 'Take over as Kunde (customer)',
  uebernehmenErklaerung:
    'Creates the customer with the name from the enquiry; the enquirer becomes its contact '
    + 'person. The legal basis for advertising is “none” afterwards — a person sets it on the '
    + 'customer, with source and date. Replying to the enquiry stays possible.',
  name: 'Name',
  art: 'Kind',
  artWerte: { firma: 'Company', behoerde: 'Public authority', privat: 'Private person' },
  ustId: 'VAT ID (USt-IdNr.)',
  ustIdErklaerung:
    'With a VAT ID the group view recognises the same customer in another company of the '
    + 'group. Without it the customer stands alone there — the same name is not the same firm.',
  uebernehmen: 'Take over as customer',
  zuordnenTitel: 'Assign to an existing Kunde (customer)',
  zuordnenErklaerung:
    'For an enquiry from a customer already on file. The enquirer becomes its contact person '
    + 'if they do not belong to a customer yet.',
  kundeWaehlen: 'Choose a customer',
  zuordnen: 'Assign',
  angebotErstellen: 'Create Angebot (quote)',
  auftragAnlegen: 'Create Auftrag (order) directly',
  ausRaumbuch: 'Angebot (quote) from the room book',
  angeboteTitel: 'Angebote (quotes)',
  auftraegeTitel: 'Aufträge (orders)',
  rechnungenTitel: 'Rechnungen (invoices)',
  keineAngebote: 'No quote for this enquiry yet.',
  keineAuftraege: 'No order from this enquiry yet.',
  keineRechnungen: 'No invoice for these orders yet.',
  ohneRecht: 'Shown to holders of this right:',

  nummer: 'Number',
  titel: 'Title',
  status: 'Status',
  netto: 'Net',
  wertNetto: 'Net value',
  brutto: 'Gross',
  datum: 'Date',
  angelegt: 'Created',
  start: 'Start',
  ohneNummer: 'Draft',
  offen: 'open',
  beschriftungAngebote: 'Quotes for this enquiry',
  beschriftungAuftraege: 'Orders from this enquiry',
  beschriftungRechnungen: 'Invoices for these orders',

  anfragenTitel: 'Enquiries (Leads)',
  keineAnfragen: 'No enquiry from this customer.',
  keineAngeboteKunde: 'No quote for this customer yet.',
  keineRechnungenKunde: 'No invoice to this customer yet.',
  dokumenteTitel: 'Documents',
  keineDokumente: 'No document on this customer.',
  kategorieWerte: {
    kunde: 'Customer file', vertrag: 'Contract', angebot: 'Quote', rechnung: 'Invoice',
    beleg: 'Receipt', mitarbeiter: 'Personnel', projekt: 'Project',
    buchhaltung: 'Accounting', unternehmen: 'Company',
  },
  verlaufTitel: 'Communication and history',
  verlaufErklaerung:
    'What was recorded on the customer and on its enquiries — the latest twenty entries.',
  keinVerlauf: 'Nothing recorded yet.',
  typWerte: {
    notiz: 'Note', anruf: 'Call', email: 'E-mail', termin: 'Meeting', aufgabe: 'Task',
    system: 'System',
  },
  richtungWerte: { eingehend: 'incoming', ausgehend: 'outgoing', intern: 'internal' },
  zurAnfrage: 'to the enquiry',
  beschriftungAnfragen: 'Enquiries from this customer',
  beschriftungDokumente: 'Documents on this customer',

  empfohlenVonFeld: 'Referred by (customer)',
  keineEmpfehlung: '— not a referral —',
  empfehlungErklaerung:
    'If the enquiry came on a customer’s recommendation, choose that customer here. The origin '
    + 'report then counts it under “Referral” instead of “Entered by hand”.',

  radarTitel: 'Take over as Lead',
  radarErklaerung:
    'Creates an enquiry with the origin “Vergaberadar” — title, description and contracting '
    + 'authority from the notice, the value only if it is given in euro. The state of the '
    + 'notice stays as it is.',
  auftraggeber: 'Contracting authority (Vergabestelle)',
  radarUebernehmen: 'Take over as Lead',
  radarSchon: (nr) => `This notice has already been taken over as Lead ${nr}.`,
  zumLead: 'Open the Lead',

  zurAnfrageVorbelegt: (nr, betreff) => `For enquiry ${nr}: ${betreff}`,
  anfrageOhneKunde:
    'The enquiry has no customer yet. Take it over as a customer on the Lead page first, or '
    + 'assign an existing one — otherwise this is created without a link to the enquiry.',
  anfrageUnbekannt:
    'This enquiry is not reachable. This is created without a link to an enquiry.',
  kundeAusAnfrage: 'The customer comes from the enquiry and is fixed.',
  anfrage: 'Enquiry (Lead)',
  raumbuchAnfrage:
    'This quote answers an enquiry. It has to belong to the same customer as the property '
    + '(Objekt) — otherwise the quote is not created.',

  nichtAngelegt: 'That was not created. Nothing was changed.',
  fehler: {
    lead_unbekannt: 'This enquiry is not reachable in this Mandant (company).',
    lead_ohne_kunde:
      'The enquiry has no customer yet. Take it over as a customer or assign an existing one.',
    lead_kunde_abweichend: 'The enquiry belongs to a different customer than this record.',
    lead_hat_kunde: 'This enquiry already has a customer.',
    lead_hat_vorgaenge:
      'A quote or order already hangs on this enquiry. Its customer stays.',
    kunde_unbekannt: 'There is no such customer in this Mandant (company).',
    name_fehlt: 'A customer needs a name.',
    typ_fehlt: 'Please choose a kind.',
    empfehlung_ohne_kunde: 'A referral names the customer who made it.',
    empfehlung_selbst:
      'A customer does not refer itself. A new enquiry from an existing customer is entered '
      + 'by hand.',
    unbekannte_quelle: 'That origin is not available here.',
    ohne_namen: 'A Lead needs a name: an existing customer or a company in plain text.',
    betreff_fehlt: 'A Lead needs a subject.',
    schon_uebernommen: 'This notice has already been taken over as a Lead.',
    ausschreibung_unbekannt: 'This tender notice is not reachable.',
    ohne_auftraggeber:
      'The notice names no contracting authority. Please enter it.',
    ohne_titel: 'The notice has no title.',
    kein_schreibrecht: 'That needs the right crm.schreiben.',
  },
  maskeFehler: {
    unbepreiste_flaeche:
      'Part of the area cannot be priced — rooms without a floor type, or floor types without '
      + 'a valid performance value. Please complete the room book first.',
    turnus: 'There is no such cleaning interval.',
    unvollstaendig: 'A required field is missing — customer, description, kind or start.',
    keine_zahl: 'Staff needed or weekly hours is not a number.',
    ausserhalb_bereich:
      'Staff needed (whole persons, 0 to 5,000) or weekly hours (0 to 10,000) is out of range.',
    kein_kreis: 'No number range is set up for this in this Mandant (company).',
    platzhalter: 'The number range is still a placeholder and assigns no number.',
    geschlossen: 'The number range is closed.',
    definer_kreis: 'The number range is not set up correctly.',
    maske_ungueltig: 'The number mask of the range is invalid.',
  },
};

export const KETTE_TEXTE: Readonly<Record<InternSprache, KetteTexte>> = { de: DE, en: EN };
