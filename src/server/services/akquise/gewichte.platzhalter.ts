import 'server-only';

/**
 * Die Gewichte der Akquise-Bewertung, die **noch niemand entschieden hat**
 * (§12 der Auftragsbeschreibung, O-15).
 *
 * Eine eigene Datei — dasselbe Muster wie `radar/gewichte.platzhalter.ts` und
 * `agent/limits.platzhalter.ts`: jeder unbestätigte Wert steht genau einmal,
 * mit seiner Frage daneben, und die Oberfläche kann ihn als **PLATZHALTER**
 * ausweisen. Kommt die Antwort des Mandanten, ändert sich diese Datei — und
 * sonst nichts.
 *
 * **Warum es überhaupt Zahlen sind.** §12 verlangt einen Lead-Score und eine
 * Priorität. Ohne Gewichte gäbe es keine Rangfolge und damit keine Liste, die
 * jemand morgens durchsieht. Die Zahlen sind ein Gerüst, kein Urteil: sie
 * sagen „die Branche wiegt mehr als die Entfernung", weil die Branche
 * entscheidet, ob wir die Leistung überhaupt anbieten — nicht, weil jemand
 * 40 Punkte für richtig hält.
 *
 * TODO(client, O-15): Welche Kriterien und Gewichte gelten für den Lead-Score
 * der Akquise — Branche, Entfernung, Unternehmensgrösse, bestehende
 * Kundenbeziehung —, und ab welcher Punktzahl soll ein Ziel dem Vertrieb
 * vorgelegt werden?
 */

export const SKALA_MAX_PLATZHALTER = 100;

/**
 * Was ein Kriterium höchstens beiträgt. Die Summe ergibt genau
 * `SKALA_MAX_PLATZHALTER`, damit „100" auch „alles trifft zu" heisst und
 * nicht ein zufälliger Zwischenstand ist.
 */
export const GEWICHTE_PLATZHALTER = {
  /** Die Branche sagt, ob wir die Leistung überhaupt anbieten. Schärfstes Merkmal. */
  branche: 40,
  /** Berlin und Umland: fährt eine Kolonne hin, ohne dass die Fahrt den Auftrag frisst? */
  entfernung: 25,
  /** Ein Stichwort im Firmennamen fängt, was die Branche nicht trennt. */
  stichwort: 20,
  /** Steht überhaupt ein Weg offen — Website, allgemeine Adresse, Telefon? */
  erreichbar: 15,
} as const;

/**
 * Die Postleitzahlenräume, die als „Berlin und Umland" gelten.
 *
 * TODO(client, O-15): Bis wohin fährt eine Kolonne? 10xxx–14xxx ist Berlin,
 * 15xxx/16xxx ist Brandenburg um Berlin herum. Ob ein Objekt in Potsdam
 * dieselbe Punktzahl verdient wie eines in Mitte, ist eine
 * Wirtschaftlichkeitsfrage und keine technische.
 */
export const NAHBEREICH_PLZ_PLATZHALTER = ['10', '11', '12', '13', '14'] as const;
export const UMLAND_PLZ_PLATZHALTER = ['15', '16'] as const;

/**
 * Welche Branchenwörter auf welchen Bereich zeigen.
 *
 * **Das ist eine Zuordnung und keine Erkennung.** Sie trifft, was im
 * Firmennamen oder in der Branchenangabe steht — nicht, was die Firma
 * wirklich braucht. Genau deshalb steht neben jedem Treffer die Begründung,
 * und ein Mensch sieht sie an, bevor daraus ein Vorgang wird.
 *
 * TODO(client, O-15): Welche Branchen sind für welchen Bereich wirklich
 * interessant — und gibt es welche, die ausdrücklich NICHT angesprochen
 * werden sollen (bestehende Kunden eines Wettbewerbers, eigene Lieferanten)?
 */
export const BRANCHE_JE_BEREICH_PLATZHALTER: Readonly<Record<string, readonly string[]>> = {
  reinigung: [
    'hausverwaltung', 'immobilien', 'facility', 'hotel', 'klinik', 'praxis',
    'buero', 'büro', 'verwaltung', 'wohnungsbau', 'gebaeudemanagement',
    'gebäudemanagement', 'pflegeheim', 'schule', 'kita',
  ],
  security: [
    'veranstaltung', 'event', 'messe', 'logistik', 'lager', 'werttransport',
    'einkaufszentrum', 'baustelle', 'objektschutz', 'stadion', 'konzert',
  ],
  bau: [
    'bautraeger', 'bauträger', 'architekt', 'projektentwickl', 'sanierung',
    'immobilienentwickl', 'wohnungsbau', 'generalunternehm', 'hochbau',
  ],
  operations: [],
} as const;
