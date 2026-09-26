/**
 * Die Wörter der Bankkonten — in beiden Sprachen (V-007, D-592).
 *
 * **Die IBAN wird nie übersetzt und nie umbrochen.** Sie steht in beiden
 * Sprachen als eine Zeichenkette; eine „schön" gruppierte Anzeige wäre eine
 * zweite Schreibweise derselben Nummer, und beim Abtippen ist das genau die
 * Gelegenheit für einen Zahlendreher.
 */
import type { InternSprache } from '../../intern.js';

export interface BankkontenTexte {
  readonly modul: string;
  readonly titel: string;
  /** Der Name des Rückwegs — die Zahlungsseite, von der man kommt. */
  readonly zurueckZahlungen: string;
  readonly untertitel: string;
  readonly keine: string;
  readonly keineErklaerung: string;

  readonly bezeichnung: string;
  readonly bezeichnungBeispiel: string;
  readonly iban: string;
  readonly ibanErklaerung: string;
  readonly bic: string;
  readonly kontoinhaber: string;
  readonly kontoinhaberErklaerung: string;
  readonly istStandard: string;
  readonly istStandardErklaerung: string;
  readonly standard: string;

  readonly anlegen: string;
  readonly anlegenTitel: string;
  readonly keinSchreibrecht: string;
  readonly freiwillig: string;
  readonly angelegt: string;
  readonly ibanFalsch: string;
}

export const BANKKONTEN_TEXTE: Readonly<Record<InternSprache, BankkontenTexte>> = {
  de: {
    modul: 'Bankkonten',
    titel: 'Bankkonten',
    zurueckZahlungen: 'Zahlungen',
    untertitel:
      'Die Konten dieser Gesellschaft. Eines davon steht auf jeder Rechnung '
      + '(BT-85) und ist das, auf dem ein Zahlungseingang verbucht wird.',
    keine: 'Noch kein Bankkonto hinterlegt.',
    keineErklaerung:
      'Ohne Bankkonto trägt eine Rechnung keine Zahlungsangabe, und ein '
      + 'Zahlungseingang lässt sich keinem Konto zuordnen. Es ist der erste '
      + 'Schritt, bevor die erste Rechnung hinausgeht.',

    bezeichnung: 'Bezeichnung',
    bezeichnungBeispiel: 'z. B. Geschäftskonto Berliner Sparkasse',
    iban: 'IBAN',
    ibanErklaerung:
      'Wird auf Prüfziffer geprüft, nicht nur auf Gestalt. Sie wird in jede '
      + 'festgeschriebene Rechnung eingefroren — und die sind danach '
      + 'unveränderlich: ein Zahlendreher steht dann auf jeder von ihnen.',
    bic: 'BIC',
    kontoinhaber: 'Kontoinhaber',
    kontoinhaberErklaerung:
      'So, wie er bei der Bank geführt wird — er steht als BT-85 auf der '
      + 'Rechnung und muss zur IBAN passen.',
    istStandard: 'Als Standardkonto verwenden',
    istStandardErklaerung:
      'Das Konto, das eine neue Rechnung vorschlägt. Es gibt höchstens eines; '
      + 'das bisherige verliert die Markierung.',
    standard: 'Standard',

    anlegen: 'Bankkonto anlegen',
    anlegenTitel: 'Neues Bankkonto',
    keinSchreibrecht: 'Das Anlegen verlangt',
    freiwillig: '(freiwillig)',
    angelegt: 'Das Bankkonto ist angelegt.',
    ibanFalsch:
      'Die IBAN stimmt nicht — die Prüfziffer passt nicht zur Nummer. Das ist '
      + 'fast immer ein Zahlendreher.',
  },

  en: {
    modul: 'Bank accounts',
    titel: 'Bank accounts',
    zurueckZahlungen: 'Payments',
    untertitel:
      'The accounts of this Gesellschaft. One of them appears on every invoice '
      + '(BT-85) and is the one an incoming payment is booked against.',
    keine: 'No bank account on file yet.',
    keineErklaerung:
      'Without a bank account an invoice carries no payment details, and an '
      + 'incoming payment cannot be assigned to an account. It is the first '
      + 'step before the first invoice goes out.',

    bezeichnung: 'Label',
    bezeichnungBeispiel: 'e.g. business account, Berliner Sparkasse',
    iban: 'IBAN',
    ibanErklaerung:
      'Checked on its check digits, not only its shape. It is frozen into every '
      + 'finalised invoice — and those are immutable afterwards: a transposed '
      + 'digit then appears on every one of them.',
    bic: 'BIC',
    kontoinhaber: 'Account holder',
    kontoinhaberErklaerung:
      'As held by the bank — it appears as BT-85 on the invoice and must match '
      + 'the IBAN.',
    istStandard: 'Use as the default account',
    istStandardErklaerung:
      'The account a new invoice proposes. There is at most one; the previous '
      + 'one loses the mark.',
    standard: 'Default',

    anlegen: 'Create bank account',
    anlegenTitel: 'New bank account',
    keinSchreibrecht: 'Creating one requires',
    freiwillig: '(optional)',
    angelegt: 'The bank account has been created.',
    ibanFalsch:
      'The IBAN is wrong — its check digits do not match the number. That is '
      + 'almost always a transposition.',
  },
};
