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

  /* ── § 48 EStG und der Postenausgleich (V-090, V-091) ─────────────── */
  readonly bauabzugTitel: string;
  readonly bauabzugErklaerung: string;
  readonly bauabzugBuchen: string;
  readonly bauabzugKeine: string;
  readonly bauabzugGebucht: string;
  readonly einbehalt: string;

  readonly ausgleichTitel: string;
  readonly ausgleichErklaerung: string;
  readonly ausgleichForderung: string;
  readonly ausgleichGuthaben: string;
  readonly ausgleichGrund: string;
  readonly ausgleichGrundBeispiel: string;
  readonly ausgleichBuchen: string;
  readonly ausgleichNichtsZuTun: string;
  readonly ausgeglichen: string;

  readonly zuDenBankkonten: string;

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

    bauabzugTitel: 'Einbehalt nach § 48 EStG',
    bauabzugErklaerung:
      'Bei einer Bauleistung behält der Leistungsempfänger 15 % ein und führt '
      + 'sie ans Finanzamt ab — er schuldet sie nicht mehr. Ohne diese Buchung '
      + 'bliebe genau dieser Betrag dauerhaft offen: in jeder Altersliste und '
      + 'in jedem Mahnlauf. Gebucht wird er erst hier und nicht beim '
      + 'Festschreiben, denn ob der Kunde ihn tatsächlich einbehält, zeigt sich '
      + 'erst am Zahlungseingang.',
    bauabzugBuchen: 'Einbehalt buchen',
    bauabzugKeine:
      'Keine offene Forderung weist einen Einbehalt nach § 48 EStG aus.',
    bauabzugGebucht: 'Der Einbehalt ist gebucht.',
    einbehalt: 'Einbehalt',

    ausgleichTitel: 'Posten gegen Posten ausgleichen',
    ausgleichErklaerung:
      'Ein Guthaben gegen eine Forderung — ohne dass eine Zahlung erfunden '
      + 'wird. Der Fall: ein Kunde hat überzahlt oder eine Rechnung wurde '
      + 'storniert, und der Betrag soll die nächste Forderung decken. Beide '
      + 'Posten bleiben stehen; was entsteht, ist die Verbindung zwischen ihnen.',
    ausgleichForderung: 'Forderung (Soll)',
    ausgleichGuthaben: 'Guthaben (Haben)',
    ausgleichGrund: 'Grund',
    ausgleichGrundBeispiel: 'z. B. Überzahlung aus R-2026-00012 verrechnet',
    ausgleichBuchen: 'Ausgleich buchen',
    ausgleichNichtsZuTun:
      'Für einen Ausgleich braucht es beides: eine offene Forderung und ein '
      + 'Guthaben.',
    ausgeglichen: 'Der Ausgleich ist gebucht.',

    zuDenBankkonten: 'Bankkonten',

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

    bauabzugTitel: 'Withholding under § 48 EStG',
    bauabzugErklaerung:
      'For construction work the recipient withholds 15 % and pays it to the '
      + 'tax office — they no longer owe it. Without this booking exactly that '
      + 'amount would stay open forever: in every ageing list and every dunning '
      + 'run. It is booked here and not at finalisation, because whether the '
      + 'customer actually withholds it only shows at the incoming payment.',
    bauabzugBuchen: 'Book the withholding',
    bauabzugKeine: 'No open receivable shows a withholding under § 48 EStG.',
    bauabzugGebucht: 'The withholding has been booked.',
    einbehalt: 'Withholding',

    ausgleichTitel: 'Offset item against item',
    ausgleichErklaerung:
      'A credit against a receivable — without inventing a payment. The case: a '
      + 'customer overpaid or an invoice was reversed, and the amount should '
      + 'cover the next receivable. Both items remain; what is created is the '
      + 'link between them.',
    ausgleichForderung: 'Receivable (debit)',
    ausgleichGuthaben: 'Credit',
    ausgleichGrund: 'Reason',
    ausgleichGrundBeispiel: 'e.g. overpayment from R-2026-00012 applied',
    ausgleichBuchen: 'Book the offset',
    ausgleichNichtsZuTun: 'An offset needs both: an open receivable and a credit.',
    ausgeglichen: 'The offset has been booked.',

    zuDenBankkonten: 'Bank accounts',

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
