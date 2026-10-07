/**
 * Die Bauabzugsteuer-Anmeldung nach § 48a EStG — das Blatt der Monatssummen
 * in beiden Sprachen (FIN-10, V-315, O-187, D-847, D-592).
 *
 * **`Bauabzugsteuer`, `Anmeldung`, `Finanzamt` und `§ 48a EStG` bleiben im
 * englischen Text stehen**: es sind die Namen des Vorgangs und der Behörde.
 * Erklärt wird in Klammern, ersetzt wird nicht.
 */
import type { InternSprache } from '../../intern.js';

export interface BauabzugTexte {
  readonly modul: string;
  readonly titel: string;
  readonly einleitung: string;
  readonly voreinstellung: string;
  readonly elster: string;
  readonly ohneZahlungsrecht: string;
  readonly leer: string;
  readonly spalteMonat: string;
  readonly spalteLieferant: string;
  readonly spalteEinbehalt: string;
  readonly spalteRechnungen: string;
  readonly spalteFrist: string;
  readonly steuernummer: (nummer: string) => string;
  readonly fristVorbei: string;
  readonly fristHeute: string;
  readonly fristOffen: string;
  readonly offenTitel: string;
  readonly offenErklaerung: string;
  readonly spalteBeleg: string;
  readonly spalteOffen: string;
  readonly zuDenEingangsrechnungen: string;
}

export const BAUABZUG_TEXTE: Readonly<Record<InternSprache, BauabzugTexte>> = {
  de: {
    modul: 'Finanzen',
    titel: 'Bauabzugsteuer-Anmeldung',
    einleitung: 'Was die Gesellschaft bei Zahlungen an Bauleistende einbehalten hat — je '
      + 'Lieferant und Monat der Zahlung. Angemeldet und abgeführt wird bis zum 10. des '
      + 'Folgemonats, beim Finanzamt des Lieferanten (§ 48a EStG); fällt der Tag auf ein '
      + 'Wochenende oder einen Feiertag, am nächsten Werktag (§ 108 Abs. 3 AO).',
    voreinstellung: 'Voreinstellung (O-187): die Anmeldung gibt der Steuerberater ab; die '
      + 'Plattform bereitet sie vor. Der Einbehalt einer Rechnung wird den Monaten ihrer '
      + 'Zahlungen anteilig zugeordnet — gezahlt ist die Gegenleistung, wenn das Geld fließt.',
    elster: 'ELSTER: nicht verbunden. Die Plattform meldet nichts an und überweist nichts.',
    ohneZahlungsrecht: 'Ohne das Leserecht für Zahlungen sind die Zahlungen unsichtbar — '
      + 'dann steht hier jeder Einbehalt als „noch keinem Monat zugeordnet", auch wenn er '
      + 'längst gezahlt ist.',
    leer: 'Für diese Gesellschaft ist kein Einbehalt einer Zahlung zugeordnet.',
    spalteMonat: 'Monat der Zahlung',
    spalteLieferant: 'Lieferant',
    spalteEinbehalt: 'Einbehalt',
    spalteRechnungen: 'Rechnungen',
    spalteFrist: 'Anmeldung bis',
    steuernummer: (nummer) => `Steuernummer ${nummer}`,
    fristVorbei: 'Frist vorbei',
    fristHeute: 'heute fällig',
    fristOffen: 'offen',
    offenTitel: 'Noch keinem Monat zugeordnet',
    offenErklaerung: 'Einbehalt aus Rechnungen, die noch nicht (ganz) bezahlt sind — oder '
      + 'deren Rest ohne Geld ausgeglichen wurde (Skonto, Differenz). Er gehört in den Monat '
      + 'der Zahlung; geraten wird er nicht.',
    spalteBeleg: 'Beleg',
    spalteOffen: 'Noch offen',
    zuDenEingangsrechnungen: 'Zu den Eingangsrechnungen',
  },
  en: {
    modul: 'Finance',
    titel: 'Bauabzugsteuer-Anmeldung (construction withholding tax return)',
    einleitung: 'What the company withheld on payments to construction providers — per '
      + 'supplier and month of payment. The Anmeldung is filed and the money paid by the 10th '
      + 'of the following month, to the supplier\'s Finanzamt (§ 48a EStG); if that day is a '
      + 'weekend or public holiday, on the next working day (§ 108 (3) AO).',
    voreinstellung: 'Default (O-187): the tax adviser files the Anmeldung; the platform '
      + 'prepares it. An invoice\'s withholding is assigned to the months of its payments pro '
      + 'rata — the consideration is rendered when the money moves.',
    elster: 'ELSTER: not connected. The platform files nothing and transfers nothing.',
    ohneZahlungsrecht: 'Without the read right for payments, payments are invisible — every '
      + 'withholding then shows as "not yet assigned to a month", even if it was paid long ago.',
    leer: 'No withholding of this company is assigned to a payment.',
    spalteMonat: 'Month of payment',
    spalteLieferant: 'Supplier',
    spalteEinbehalt: 'Withheld',
    spalteRechnungen: 'Invoices',
    spalteFrist: 'File by',
    steuernummer: (nummer) => `Tax number ${nummer}`,
    fristVorbei: 'deadline passed',
    fristHeute: 'due today',
    fristOffen: 'open',
    offenTitel: 'Not yet assigned to a month',
    offenErklaerung: 'Withholding from invoices that are not (fully) paid yet — or whose '
      + 'remainder was settled without money (cash discount, difference). It belongs to the '
      + 'month of payment; it is not guessed.',
    spalteBeleg: 'Document',
    spalteOffen: 'Still open',
    zuDenEingangsrechnungen: 'To incoming invoices',
  },
};
