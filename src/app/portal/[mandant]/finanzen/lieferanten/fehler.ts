/**
 * Die Fehlergründe des Lieferantenwegs, in beiden Sprachen (V-006).
 *
 * **Sie stehen hier und nicht in der Textdatei des Moduls**, weil sie an den
 * `grund`-Schlüsseln von `LieferantFehler` hängen: ein umbenannter Grund muss
 * genau eine Stelle finden, an der sein Satz steht. Eine Meldung, die nach
 * einer Umbenennung stillschweigend auf den rohen Schlüssel zurückfällt,
 * zeigt dem Menschen `iban_ungueltig` statt eines Satzes.
 */
import type { InternSprache } from '@/lib/i18n/intern';

export const LIEFERANT_FEHLER:
Readonly<Record<InternSprache, Readonly<Record<string, string>>>> = {
  de: {
    name_fehlt: 'Ein Lieferant braucht einen Namen.',
    iban_ungueltig:
      'Die IBAN stimmt nicht — die Prüfziffer passt nicht zur Nummer. Das ist '
      + 'fast immer ein Zahlendreher; bitte Zeichen für Zeichen gegen das '
      + 'Schreiben des Lieferanten prüfen.',
    zahlungsziel_ungueltig:
      'Das Zahlungsziel sind ganze Tage (0 bis 3650) — oder nichts.',
    leistungsart_unbekannt: 'Unbekannte Leistungsart.',
    datum_unlesbar: 'Das Datum der Freistellungsbescheinigung ist nicht lesbar.',
    land_ungueltig:
      'Das Land ist ein Länderkürzel aus zwei Buchstaben (DE, AT, PL).',
    nicht_gefunden: 'Diesen Lieferanten gibt es nicht — oder er ist archiviert.',
    rechnungen_offen:
      'Auf diesem Lieferanten liegen noch nicht abgeschlossene '
      + 'Eingangsrechnungen. Schliessen Sie die zuerst ab — sonst zeigt eine '
      + 'offene Zahlung auf einen Empfänger, den niemand mehr auswählen kann.',
    kein_schreibrecht: 'Dafür fehlt das Recht `eingang.schreiben`.',
    status_unbekannt: 'Unbekannter Status.',
  },
  en: {
    name_fehlt: 'A Lieferant needs a name.',
    iban_ungueltig:
      'The IBAN is wrong — its check digits do not match the number. That is '
      + 'almost always a transposition; please check it character by character '
      + 'against the supplier’s letter.',
    zahlungsziel_ungueltig:
      'Payment terms are whole days (0 to 3650) — or nothing.',
    leistungsart_unbekannt: 'Unknown type of service.',
    datum_unlesbar: 'The date of the exemption certificate is unreadable.',
    land_ungueltig: 'The country is a two-letter code (DE, AT, PL).',
    nicht_gefunden: 'No such Lieferant — or it is archived.',
    rechnungen_offen:
      'Incoming invoices on this Lieferant are not yet closed. Close those '
      + 'first — otherwise an open payment points to a payee nobody can select '
      + 'any more.',
    kein_schreibrecht: 'That requires the right `eingang.schreiben`.',
    status_unbekannt: 'Unknown status.',
  },
};
