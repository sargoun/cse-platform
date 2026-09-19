/**
 * `/[mandant]/finanzen/zahlungen` und `/zahlungen/[id]` — in beiden Sprachen.
 *
 * **Eine Datei je Teilflaeche, nicht eine je Domaene.** `finanzen` hat 31
 * Seiten; eine einzige Datei dafuer waere zweitausend Zeilen, an denen jede
 * Aenderung mit jeder anderen kollidiert. Der Schnitt laeuft entlang der
 * Ordner, weil dort auch die Arbeit entlanglaeuft.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`): `Storno`, `Lastschrift`, `Verwendungszweck` sind Begriffe
 * des UStG und des Zahlungsverkehrs. Wo einer stehen bleibt, steht die
 * Erklaerung daneben — nicht eine erfundene Entsprechung.
 */
import type { InternSprache } from '../../intern.js';

export interface ZahlungenTexte {
  readonly titel: string;
  readonly offeneForderungen: string;
  readonly summeOffen: string;
  readonly keineForderung: string;
  readonly tabelleForderungen: string;
  readonly rechnung: string;
  readonly bezahlt: string;
  readonly offen: string;

  readonly guthabenTitel: string;
  readonly guthabenErklaerung: string;
  readonly tabelleGuthaben: string;
  readonly seit: string;

  readonly erfassenTitel: string;
  readonly keineForderungZumBuchen: string;
  readonly betragInEuro: string;
  readonly buchungstag: string;
  readonly zahlungsmittel: string;
  readonly eingegangenAuf: string;
  readonly ohneKontobezug: string;
  readonly verwendungszweck: string;
  readonly ueberzahlungHinweis: string;
  readonly zahlungErfassen: string;

  readonly eingaengeTitel: string;
  readonly keineZahlung: string;
  readonly tabelleEingaenge: string;
  readonly mittel: string;
  readonly referenz: string;
  readonly nichtZugeordnet: string;

  /** Die Zahlungsmittel — `zahlungsmittel`-Enum aus 0121. */
  readonly mittelNamen: Readonly<Record<
    'ueberweisung' | 'lastschrift' | 'bar' | 'karte' | 'verrechnung', string>>;
}

export const ZAHLUNGEN_TEXTE: Readonly<Record<InternSprache, ZahlungenTexte>> = {
  de: {
    titel: 'Zahlungen',
    offeneForderungen: 'Offene Forderungen',
    summeOffen: 'Summe offen:',
    keineForderung:
      'Keine offene Forderung. Ein Posten entsteht mit dem Festschreiben einer '
      + 'Rechnung — ein Entwurf fordert nichts.',
    tabelleForderungen: 'Offene Forderungen mit Rechnungsnummer, Kunde, Betrag und Fälligkeit',
    rechnung: 'Rechnung',
    bezahlt: 'Bezahlt',
    offen: 'Offen',

    guthabenTitel: 'Guthaben der Kunden',
    guthabenErklaerung:
      'Ein Guthaben entsteht aus einer Überzahlung oder aus einem Storno. Es ist '
      + 'eine Verbindlichkeit: der Betrag steht dem Kunden zu, bis er mit einer '
      + 'Rechnung verrechnet oder erstattet wird.',
    tabelleGuthaben: 'Guthaben der Kunden mit Betrag und Entstehungstag',
    seit: 'Seit',

    erfassenTitel: 'Zahlungseingang erfassen',
    keineForderungZumBuchen:
      'Es gibt keine offene Forderung, auf die sich eine Zahlung buchen ließe.',
    betragInEuro: 'Betrag in Euro',
    buchungstag: 'Buchungstag',
    zahlungsmittel: 'Zahlungsmittel',
    eingegangenAuf: 'Eingegangen auf',
    ohneKontobezug: '— ohne Kontobezug —',
    verwendungszweck: 'Verwendungszweck oder Referenz',
    ueberzahlungHinweis:
      'Kommt mehr an, als offen ist, wird der Überschuss NICHT auf die Rechnung '
      + 'gebucht: er wird als Guthaben des Kunden geführt und oben ausgewiesen.',
    zahlungErfassen: 'Zahlung erfassen',

    eingaengeTitel: 'Erfasste Zahlungseingänge',
    keineZahlung: 'Noch keine Zahlung erfasst.',
    tabelleEingaenge:
      'Erfasste Zahlungseingänge mit Datum, Betrag, Zahlungsmittel und Zuordnung',
    mittel: 'Mittel',
    referenz: 'Referenz',
    nichtZugeordnet: 'nicht zugeordnet',

    mittelNamen: {
      ueberweisung: 'Überweisung', lastschrift: 'Lastschrift', bar: 'Barzahlung',
      karte: 'Kartenzahlung', verrechnung: 'Verrechnung',
    },
  },

  en: {
    titel: 'Payments',
    offeneForderungen: 'Open receivables',
    summeOffen: 'Total open:',
    keineForderung:
      'No open receivable. An item comes into being when an invoice is finalised '
      + '(festgeschrieben) — a draft claims nothing.',
    tabelleForderungen: 'Open receivables with invoice number, customer, amount and due date',
    rechnung: 'Invoice',
    bezahlt: 'Paid',
    offen: 'Open',

    guthabenTitel: 'Customer credit balances',
    guthabenErklaerung:
      'A credit balance arises from an overpayment or from a Storno (reversing '
      + 'entry). It is a liability: the amount belongs to the customer until it is '
      + 'set off against an invoice or refunded.',
    tabelleGuthaben: 'Customer credit balances with amount and date of origin',
    seit: 'Since',

    erfassenTitel: 'Record an incoming payment',
    keineForderungZumBuchen: 'There is no open receivable a payment could be booked to.',
    betragInEuro: 'Amount in Euro',
    buchungstag: 'Booking date',
    zahlungsmittel: 'Payment method',
    eingegangenAuf: 'Received in',
    ohneKontobezug: '— no account —',
    verwendungszweck: 'Payment reference',
    ueberzahlungHinweis:
      'If more arrives than is open, the excess is NOT booked onto the invoice: it '
      + 'is carried as a credit balance of the customer and shown above.',
    zahlungErfassen: 'Record payment',

    eingaengeTitel: 'Recorded incoming payments',
    keineZahlung: 'No payment recorded yet.',
    tabelleEingaenge: 'Recorded incoming payments with date, amount, method and allocation',
    mittel: 'Method',
    referenz: 'Reference',
    nichtZugeordnet: 'unallocated',

    mittelNamen: {
      ueberweisung: 'Bank transfer', lastschrift: 'Direct debit (Lastschrift)',
      bar: 'Cash', karte: 'Card', verrechnung: 'Set-off',
    },
  },
};
