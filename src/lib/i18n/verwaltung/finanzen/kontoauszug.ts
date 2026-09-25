/**
 * Die Wörter des Kontoauszugsblatts (`buchhaltung/bank/[auszugId]`) — in
 * beiden Sprachen (V-217, D-710, D-592).
 *
 * **Die Abweisungen sind SCHLÜSSEL.** `/api/buchhaltung/bank/umsatz` schickt
 * den Grund zurück (`?fehler=<grund>`), nicht den Satz des Dienstes: die
 * Sätze der Dienste sind deutsch, das Blatt spricht zwei Sprachen. Die
 * Gründe der Klärung kommen aus `ImportFehler`, die des Zahlungsausgangs
 * aus `ZahlungFehler` (mit dem Vorsatz `zahlung_`); ein unbekannter Grund
 * bekommt `fehlerSonst`, nie den Schlüssel selbst (`eigenerEintrag`).
 *
 * **Was hier nicht übersetzt wird:** die Begründung des Abgleichs
 * (`vorschlag_text`) und die Klärungsnotiz stehen an der Zeile, so wie sie
 * beim Abgleich bzw. von einem Menschen geschrieben wurden — Daten, keine
 * Beschriftung.
 */
import type { InternSprache } from '../../intern.js';

export interface KontoauszugTexte {
  /* ── Kopf ──────────────────────────────────────────────────────────── */
  /** Vor der Kennung des Auszugs: „Auszug 2026-09". */
  readonly auszug: string;
  readonly wurzelTitel: string;
  readonly zurListe: string;

  /* ── Rückmeldungen ─────────────────────────────────────────────────── */
  readonly meldungen: Readonly<Record<'zugeordnet' | 'ohne_bezug', string>>;
  readonly abgeglichen: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;

  /* ── Die Angaben des Auszugs ───────────────────────────────────────── */
  readonly bankkonto: string;
  readonly iban: string;
  readonly zeitraum: string;
  readonly zeilen: string;
  readonly anfangssaldo: string;
  readonly endsaldo: string;

  /* ── Die Saldenprobe ───────────────────────────────────────────────── */
  readonly probeStimmt: (anfang: string, bewegung: string) => string;
  readonly probeFehlt: (anfang: string, bewegung: string, ergibt: string, ende: string) => string;

  /* ── Die Umsätze ───────────────────────────────────────────────────── */
  readonly keineZeile: string;
  readonly tabelle: string;
  readonly nr: string;
  readonly datum: string;
  readonly betrag: string;
  readonly gegenpartei: string;
  readonly verwendungszweck: string;
  readonly zustand: string;
  readonly vormerkung: string;
  readonly warum: string;
  readonly zugeordnet: string;
  readonly zugeordnetZu: (nummer: string) => string;
  readonly nochNichtAbgeglichen: string;

  /* ── Die Klärung ───────────────────────────────────────────────────── */
  readonly klaerung: string;
  readonly wartend: (anzahl: number) => string;
  /** Vor der Laufnummer in der Klärungszeile: „Nr. 12". */
  readonly nrKurz: string;
  readonly offenerPosten: string;
  readonly offeneVerbindlichkeit: string;
  readonly waehlen: string;
  readonly zuordnen: string;
  readonly vormerkungWartet: string;
  readonly ohneBezugWarum: string;
  readonly ohneBezugBeispiel: string;
  readonly ohneBezug: string;

  /* ── Die Archivkopie ───────────────────────────────────────────────── */
  readonly keineArchivkopie: string;
}

const DE: KontoauszugTexte = {
  auszug: 'Auszug',
  wurzelTitel: 'Bank',
  zurListe: 'Zur Liste',

  meldungen: {
    zugeordnet: 'Der Umsatz ist zugeordnet; die Zahlung ist angelegt.',
    ohne_bezug: 'Der Umsatz ist als „ohne Bezug" vermerkt.',
  },
  abgeglichen: 'Der Auszug ist damit vollständig abgeglichen.',
  fehler: {
    posten_waehlen: 'Bitte einen offenen Posten wählen.',
    umsatz_fehlt: 'Diesen Umsatz gibt es nicht.',
    schon_entschieden:
      'Über diesen Umsatz ist bereits entschieden. Eine Entscheidung wird nicht '
      + 'überschrieben; eine falsche Zuordnung wird widerrufen.',
    vormerkung: 'Eine Vormerkung wird nicht zugeordnet — die Bank hat noch nicht gebucht.',
    nur_eingang:
      'Nur ein Zahlungseingang wird einer Forderung zugeordnet. Ein Ausgang ist '
      + 'keine Kundenzahlung.',
    posten_nicht_offen:
      'Dieser Posten ist nicht offen — er ist ausgeglichen oder gehört nicht hierher.',
    verbindlichkeit_nicht_offen:
      'Diese Verbindlichkeit ist nicht offen — sie ist bezahlt, oder der Posten ist '
      + 'keiner gegenüber einem Lieferanten.',
    begruendung_fehlt:
      'Ohne Begründung bleibt der Umsatz in Klärung — „ohne Bezug" braucht einen '
      + 'Satz von mindestens fünf Zeichen, der später allein steht.',
    zahlung_nicht_gefunden: 'Der offene Posten ist nicht erreichbar.',
    zahlung_kein_posten:
      'Zu dieser Eingangsrechnung gibt es noch keinen offenen Posten — erst das '
      + 'Buchen eröffnet ihn.',
    zahlung_schon_ausgeglichen: 'Dieser Posten ist bereits ausgeglichen.',
    zahlung_storniert: 'Diese Zahlung ist storniert.',
    zahlung_abgewiesen:
      'Die Zahlung wurde abgewiesen — darf Ihr Zugang in dieser Gesellschaft '
      + 'Zahlungen erfassen?',
    zahlung_betrag_nicht_positiv: 'Der Betrag muss größer als null sein.',
    zahlung_bankkonto_fremd: 'Das Konto des Auszugs gehört nicht zu dieser Gesellschaft.',
  },
  fehlerSonst: 'Die Klärung wurde abgewiesen.',

  bankkonto: 'Bankkonto',
  iban: 'IBAN',
  zeitraum: 'Zeitraum',
  zeilen: 'Zeilen',
  anfangssaldo: 'Anfangssaldo',
  endsaldo: 'Endsaldo',

  probeStimmt: (anfang, bewegung) =>
    `Anfangssaldo ${anfang} plus die Bewegung der Zeilen (${bewegung}) ergibt den `
    + 'Endsaldo — der Auszug ist vollständig eingelesen.',
  probeFehlt: (anfang, bewegung, ergibt, ende) =>
    `Anfangssaldo ${anfang} plus die Bewegung der Zeilen (${bewegung}) ergibt `
    + `${ergibt}, der Auszug nennt aber ${ende}. Es fehlt eine Zeile.`,

  keineZeile: 'Dieser Auszug trägt keine Zeile.',
  tabelle: 'Die Umsätze dieses Auszugs und warum sie stehen, wo sie stehen',
  nr: 'Nr.',
  datum: 'Datum',
  betrag: 'Betrag',
  gegenpartei: 'Gegenpartei',
  verwendungszweck: 'Verwendungszweck',
  zustand: 'Zustand',
  vormerkung: 'Vormerkung',
  warum: 'Warum',
  zugeordnet: 'Zugeordnet',
  zugeordnetZu: (nummer) => `Zugeordnet zu ${nummer}`,
  nochNichtAbgeglichen: 'Noch nicht abgeglichen',

  klaerung: 'Klärung',
  wartend: (anzahl) =>
    `${String(anzahl)} ${anzahl === 1 ? 'Zeile wartet' : 'Zeilen warten'} auf eine `
    + 'Entscheidung. Zugeordnet wird der Betrag der Bank; gerechnet wird hier nichts.',
  nrKurz: 'Nr.',
  offenerPosten: 'Offener Posten',
  offeneVerbindlichkeit: 'Offene Verbindlichkeit',
  waehlen: '— wählen —',
  zuordnen: 'Zuordnen',
  vormerkungWartet: 'Eine Vormerkung wird erst zugeordnet, wenn die Bank gebucht hat.',
  ohneBezugWarum: 'Ohne Bezug — warum',
  ohneBezugBeispiel: 'z. B. Kontoführungsgebühr September',
  ohneBezug: 'Ohne Bezug',

  keineArchivkopie: 'Keine Archivkopie der Datei — der Objektspeicher ist nicht verbunden.',
};

const EN: KontoauszugTexte = {
  auszug: 'Statement',
  wurzelTitel: 'Bank',
  zurListe: 'Back to the list',

  meldungen: {
    zugeordnet: 'The transaction is matched; the payment has been recorded.',
    ohne_bezug: 'The transaction is marked as “no reference”.',
  },
  abgeglichen: 'The statement is now fully reconciled.',
  fehler: {
    posten_waehlen: 'Please choose an open item.',
    umsatz_fehlt: 'This transaction does not exist.',
    schon_entschieden:
      'This transaction has already been decided. A decision is not overwritten; '
      + 'a wrong match is revoked.',
    vormerkung: 'A pending entry is not matched — the bank has not booked it yet.',
    nur_eingang:
      'Only an incoming payment is matched to a receivable. An outgoing payment is '
      + 'not a customer payment.',
    posten_nicht_offen:
      'This item is not open — it has been settled or does not belong here.',
    verbindlichkeit_nicht_offen:
      'This payable is not open — it has been paid, or the item is not one owed to '
      + 'a supplier.',
    begruendung_fehlt:
      'Without a reason the transaction stays under clarification — “no reference” '
      + 'needs a sentence of at least five characters that stands on its own later.',
    zahlung_nicht_gefunden: 'The open item cannot be reached.',
    zahlung_kein_posten:
      'This incoming invoice has no open item yet — booking it opens one.',
    zahlung_schon_ausgeglichen: 'This item has already been settled.',
    zahlung_storniert: 'This payment has been reversed.',
    zahlung_abgewiesen:
      'The payment was rejected — is your access allowed to record payments in '
      + 'this company?',
    zahlung_betrag_nicht_positiv: 'The amount must be greater than zero.',
    zahlung_bankkonto_fremd: 'The statement’s account does not belong to this company.',
  },
  fehlerSonst: 'The clarification was rejected.',

  bankkonto: 'Bank account',
  iban: 'IBAN',
  zeitraum: 'Period',
  zeilen: 'Lines',
  anfangssaldo: 'Opening balance',
  endsaldo: 'Closing balance',

  probeStimmt: (anfang, bewegung) =>
    `Opening balance ${anfang} plus the movement of the lines (${bewegung}) gives the `
    + 'closing balance — the statement has been read in full.',
  probeFehlt: (anfang, bewegung, ergibt, ende) =>
    `Opening balance ${anfang} plus the movement of the lines (${bewegung}) gives `
    + `${ergibt}, but the statement states ${ende}. A line is missing.`,

  keineZeile: 'This statement has no lines.',
  tabelle: 'The transactions of this statement and why they stand where they stand',
  nr: 'No.',
  datum: 'Date',
  betrag: 'Amount',
  gegenpartei: 'Counterparty',
  verwendungszweck: 'Payment reference',
  zustand: 'State',
  vormerkung: 'Pending',
  warum: 'Why',
  zugeordnet: 'Matched',
  zugeordnetZu: (nummer) => `Matched to ${nummer}`,
  nochNichtAbgeglichen: 'Not reconciled yet',

  klaerung: 'Clarification',
  wartend: (anzahl) =>
    `${String(anzahl)} ${anzahl === 1 ? 'line is' : 'lines are'} waiting for a decision. `
    + 'The bank’s amount is matched; nothing is calculated here.',
  nrKurz: 'No.',
  offenerPosten: 'Open item',
  offeneVerbindlichkeit: 'Open payable',
  waehlen: '— choose —',
  zuordnen: 'Match',
  vormerkungWartet: 'A pending entry is matched only once the bank has booked it.',
  ohneBezugWarum: 'No reference — why',
  ohneBezugBeispiel: 'e.g. account fee September',
  ohneBezug: 'No reference',

  keineArchivkopie: 'No archive copy of the file — the object storage is not connected.',
};

export const KONTOAUSZUG_TEXTE: Readonly<Record<InternSprache, KontoauszugTexte>> = {
  de: DE,
  en: EN,
};
