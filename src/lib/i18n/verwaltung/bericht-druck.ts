/**
 * Die Wörter des Druckblatts eines Berichts — in beiden Sprachen (REP-07,
 * V-227, D-721).
 *
 * **Der Rahmen folgt der Sprache, die Tabelle nicht.** Kopf, Hinweise und
 * Knöpfe stehen in der Sprache der Sitzung. Die Tabelle ist die CSV-Datei auf
 * Papier — dieselben Spaltenköpfe, dieselben Werte, dieselbe Zahlenform wie
 * in der Datei (`berichtTabelle`); sie bleibt deutsch, und das englische
 * Blatt sagt es dazu. Zwei Tabellen, die sich in einer Sprache unterscheiden,
 * liessen sich nicht mehr Zeile für Zeile gegen die Datei legen.
 */
import type { InternSprache } from '../intern.js';

export type DruckBericht =
  'umsatz' | 'auftraege' | 'attribution' | 'mitarbeiter' | 'projekte' | 'pipeline';

export interface BerichtDruckTexte {
  readonly titel: Readonly<Record<DruckBericht, string>>;
  readonly dokumentTitel: (bericht: string, bereich: string) => string;
  readonly zeitraum: string;
  readonly koernung: string;
  readonly koernungen: Readonly<Record<'monat' | 'quartal' | 'jahr', string>>;
  readonly stand: string;
  readonly drucken: string;
  readonly zurueck: string;
  /** Über dem Blatt, nicht darauf: wie aus der Seite eine Datei wird. */
  readonly anleitung: string;
  readonly tabelle: (titel: string) => string;
  readonly leer: string;
  /** Unter der Tabelle — woher die Zeilen kommen. */
  readonly quelle: string;
  /** Nur im englischen Blatt: warum die Tabelle deutsch ist. */
  readonly tabelleDeutsch: string | null;
}

export const BERICHT_DRUCK_TEXTE: Readonly<Record<InternSprache, BerichtDruckTexte>> = {
  de: {
    titel: {
      umsatz: 'Umsatz & Ergebnis', auftraege: 'Aufträge & Leads', attribution: 'Herkunft',
      mitarbeiter: 'Stunden & Auslastung', projekte: 'Projekte', pipeline: 'Vergabepipeline',
    },
    dokumentTitel: (bericht, bereich) => `${bericht} — ${bereich}`,
    zeitraum: 'Zeitraum',
    koernung: 'Körnung',
    koernungen: { monat: 'Monate', quartal: 'Quartale', jahr: 'Jahr' },
    stand: 'Stand',
    drucken: 'Drucken oder als PDF sichern',
    zurueck: 'Zurück zum Bericht',
    anleitung: 'Diese Seite ist das Dokument: A4, weißes Blatt. Der Druckdialog des '
      + 'Browsers macht daraus ein Papier oder eine PDF-Datei. Knöpfe und dieser Satz '
      + 'erscheinen nicht auf dem Ausdruck.',
    tabelle: (titel) => `${titel} — Tabelle`,
    leer: 'Im Zeitraum liegt keine Zeile.',
    quelle: 'Dieselben Zeilen und Spalten wie die CSV-Datei dieses Berichts, gelesen zum '
      + 'genannten Stand mit den Rechten der Person, die das Blatt aufgerufen hat. '
      + 'Beträge in ganzen Cent gerechnet.',
    tabelleDeutsch: null,
  },
  en: {
    titel: {
      umsatz: 'Revenue & result', auftraege: 'Orders & leads', attribution: 'Attribution',
      mitarbeiter: 'Hours & utilisation', projekte: 'Projects', pipeline: 'Tender pipeline',
    },
    dokumentTitel: (bericht, bereich) => `${bericht} — ${bereich}`,
    zeitraum: 'Period',
    koernung: 'Granularity',
    koernungen: { monat: 'Months', quartal: 'Quarters', jahr: 'Year' },
    stand: 'As of',
    drucken: 'Print or save as PDF',
    zurueck: 'Back to the report',
    anleitung: 'This page is the document: A4, white sheet. The browser’s print '
      + 'dialogue turns it into paper or a PDF file. Buttons and this sentence do not '
      + 'appear on the printout.',
    tabelle: (titel) => `${titel} — table`,
    leer: 'No rows in this period.',
    quelle: 'The same rows and columns as this report’s CSV file, read as of the date '
      + 'shown with the rights of the person who opened the sheet. Amounts calculated '
      + 'in whole cents.',
    tabelleDeutsch: 'The table is the CSV file on paper and stays in German — the same '
      + 'column headings, values and number format as the file.',
  },
};
