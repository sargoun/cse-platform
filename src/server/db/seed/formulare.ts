/**
 * Die Angebotsanfrage-Formulare je Bereich (REQ-01 … REQ-04).
 *
 * **Die Feldmengen sind die Substanz von REQ-02/03/04** und stehen genau so in
 * `02-CRM-OPERATIONS.md` §4. Was dort nicht steht, steht auch hier nicht:
 *
 *  - Die Auswahllisten fuer `gebaeudetyp`, `frequenz` und `gewerk` sind
 *    PLATZHALTER. Ein erfundener Gebaeudetyp landet in der Auswertung und
 *    spaeter in einem Angebot, und niemand findet ihn wieder. (O-62)
 *  - Das Formular fuer CSE Operations ist VORLAEUFIG: REQ-02/03/04 definieren
 *    nur drei Feldmengen, die vierte ist aus dem Auftrag des Bereichs
 *    abgeleitet (Ablaeufe aufnehmen, digitalisieren, auswertbar machen) und
 *    steht als Annahme im Register. (O-61)
 *
 * // TODO(client): O-62 — Auswahllisten für gebaeudetyp, frequenz und gewerk:
 * // bitte die tatsächlich verwendeten Werte bestätigen oder ersetzen.
 * // TODO(client): O-61 — Welche Felder braucht CSE Operations wirklich, um
 * // ein Angebot rechnen zu können?
 */
import type { FormularFeld } from '../../../lib/formular/schema.js';
import { FORMULAR_SCHLUESSEL } from '../../../lib/formular/bereiche.js';

/** Der Datenschutztext, dessen Bestaetigung auf jeder Einsendung gespeichert wird. */
export const DATENSCHUTZ_VERSION = '2026-09-01';

/**
 * Die Auswahllisten — branchenüblich, VORLÄUFIG, und im Register (O-62).
 *
 * Sie tragen keinen "(vorläufig)"-Zusatz mehr im Label: der Mandant soll das
 * Formular sehen, wie ein Kunde es sieht. Dass die Listen noch nicht bestätigt
 * sind, steht in `docs/ANNAHMEN.md` und in `src/lib/annahmen.ts` — an einer
 * Stelle, statt in jedem einzelnen Eintrag.
 *
 * Was hier NICHT steht, kann ein Kunde nicht anfragen. Das ist der Grund, die
 * Liste durchzugehen.
 */
const optionen = (paare: readonly (readonly [string, string])[]) =>
  paare.map(([wert, label]) => ({ wert, label }));

function gemeinsam(ab: number): FormularFeld[] {
  return [
    { typ: 'text', schluessel: 'firma', label: 'Firma', pflicht: true,
      autocomplete: 'organization', sortierung: ab,
      fehlermeldung: 'Bitte geben Sie den Namen Ihrer Firma an.' },
    { typ: 'text', schluessel: 'name', label: 'Ihr Name', pflicht: true,
      autocomplete: 'name', sortierung: ab + 1,
      fehlermeldung: 'Bitte geben Sie Ihren Namen an.' },
    { typ: 'email', schluessel: 'email', label: 'E-Mail', pflicht: true,
      autocomplete: 'email', sortierung: ab + 2,
      fehlermeldung: 'Bitte geben Sie eine E-Mail-Adresse an, unter der wir Sie erreichen.' },
    { typ: 'telefon', schluessel: 'telefon', label: 'Telefon', pflicht: true,
      autocomplete: 'tel', sortierung: ab + 3,
      fehlermeldung: 'Bitte geben Sie eine Telefonnummer an.' },
    { typ: 'textarea', schluessel: 'nachricht', label: 'Ihre Nachricht', pflicht: false,
      maxLaenge: 4000, sortierung: ab + 4,
      hilfetext: 'Alles, was uns hilft, Ihnen ein passendes Angebot zu machen.',
      fehlermeldung: 'Bitte kürzen Sie Ihre Nachricht.' },
    // LEG-09: eine BESTAETIGUNG, dass der Hinweis gezeigt wurde — keine
    // Einwilligung. Eine Einwilligung, die man nicht verweigern kann, ist keine.
    { typ: 'checkbox', schluessel: 'datenschutz_hinweis', pflicht: true,
      label: 'Ich habe die Datenschutzhinweise gelesen.', sortierung: ab + 5,
      fehlermeldung: 'Bitte bestätigen Sie, dass Sie die Datenschutzhinweise gelesen haben.' },
    // CRM-08 / LEG-08: freiwillig, und das Einzige, was `einwilligung` begründet.
    { typ: 'checkbox', schluessel: 'einwilligung_werbung', pflicht: false,
      label: 'Ich möchte Informationen zu weiteren Leistungen erhalten.',
      sortierung: ab + 6,
      fehlermeldung: 'Bitte prüfen Sie diese Angabe.' },
  ];
}

export interface FormularVorlage {
  readonly slug: string;
  readonly schluessel: string;
  readonly titel: string;
  readonly felder: readonly FormularFeld[];
}

export const FORMULARE: readonly FormularVorlage[] = [
  {
    slug: 'reinigung',
    schluessel: FORMULAR_SCHLUESSEL['reinigung']!,
    titel: 'Angebot für Gebäudereinigung anfragen',
    felder: [
      { typ: 'auswahl', schluessel: 'gebaeudetyp', label: 'Gebäudetyp', pflicht: true,
        sortierung: 1, optionen: optionen([
          ['buero', 'Bürogebäude'],
          ['wohnanlage', 'Wohnanlage'],
          ['praxis', 'Praxis oder Klinik'],
          ['einzelhandel', 'Einzelhandel'],
          ['industrie', 'Industrie oder Lager'],
          ['bildung', 'Schule oder Kita'],
          ['hotel', 'Hotel oder Gastronomie'],
        ]),
        fehlermeldung: 'Bitte wählen Sie den Gebäudetyp.' },
      { typ: 'dezimal', schluessel: 'flaeche_qm', label: 'Fläche in m²', pflicht: true,
        sortierung: 2, min: 1, nachkommastellen: 2,
        fehlermeldung: 'Bitte geben Sie die Fläche in Quadratmetern an.' },
      { typ: 'zahl', schluessel: 'anzahl_objekte', label: 'Anzahl Objekte', pflicht: true,
        sortierung: 3, min: 1,
        fehlermeldung: 'Bitte geben Sie an, um wie viele Objekte es geht.' },
      { typ: 'auswahl', schluessel: 'frequenz', label: 'Reinigungsfrequenz', pflicht: true,
        sortierung: 4, optionen: optionen([
          ['taeglich', 'Täglich'],
          ['fuenf_woechentlich', 'Fünfmal wöchentlich'],
          ['drei_woechentlich', 'Dreimal wöchentlich'],
          ['zwei_woechentlich', 'Zweimal wöchentlich'],
          ['woechentlich', 'Wöchentlich'],
          ['vierzehntaegig', 'Alle zwei Wochen'],
          ['monatlich', 'Monatlich'],
          ['einmalig', 'Einmalig'],
        ]),
        fehlermeldung: 'Bitte wählen Sie, wie oft gereinigt werden soll.' },
      { typ: 'datum', schluessel: 'wunsch_start', label: 'Gewünschter Start', pflicht: true,
        sortierung: 5, fehlermeldung: 'Bitte geben Sie ein Startdatum an (JJJJ-MM-TT).' },
      ...gemeinsam(10),
    ],
  },
  {
    slug: 'security',
    schluessel: FORMULAR_SCHLUESSEL['security']!,
    titel: 'Angebot für Sicherheitsdienste anfragen',
    felder: [
      { typ: 'text', schluessel: 'anlass', label: 'Anlass', pflicht: true, sortierung: 1,
        fehlermeldung: 'Bitte beschreiben Sie den Anlass kurz.' },
      { typ: 'datum_zeit', schluessel: 'einsatz_von', label: 'Einsatz von', pflicht: true,
        sortierung: 2, fehlermeldung: 'Bitte geben Sie Beginn mit Datum und Uhrzeit an.' },
      { typ: 'datum_zeit', schluessel: 'einsatz_bis', label: 'Einsatz bis', pflicht: true,
        sortierung: 3, fehlermeldung: 'Bitte geben Sie Ende mit Datum und Uhrzeit an.' },
      { typ: 'zahl', schluessel: 'erwartete_besucher', label: 'Erwartete Besucher',
        pflicht: true, sortierung: 4, min: 0,
        fehlermeldung: 'Bitte schätzen Sie die Besucherzahl.' },
      { typ: 'zahl', schluessel: 'anzahl_kraefte', label: 'Benötigte Kräfte', pflicht: true,
        sortierung: 5, min: 1,
        fehlermeldung: 'Bitte geben Sie an, wie viele Kräfte Sie benötigen.' },
      { typ: 'text', schluessel: 'veranstaltungsort', label: 'Veranstaltungsort',
        pflicht: true, sortierung: 6, autocomplete: 'street-address',
        fehlermeldung: 'Bitte geben Sie den Veranstaltungsort an.' },
      ...gemeinsam(10),
    ],
  },
  {
    slug: 'bau',
    schluessel: FORMULAR_SCHLUESSEL['bau']!,
    titel: 'Angebot für Bauleistungen anfragen',
    felder: [
      { typ: 'auswahl', schluessel: 'gewerk', label: 'Gewerk', pflicht: true, sortierung: 1,
        optionen: optionen([
          ['hochbau', 'Hochbau'],
          ['ausbau', 'Ausbau und Trockenbau'],
          ['rueckbau', 'Rückbau und Entkernung'],
          ['sanierung', 'Sanierung im Bestand'],
          ['maler', 'Malerarbeiten'],
          ['boden', 'Bodenbeläge'],
        ]),
        fehlermeldung: 'Bitte wählen Sie das Gewerk.' },
      { typ: 'text', schluessel: 'volumen', label: 'Volumen', pflicht: true, sortierung: 2,
        hilfetext: 'Grössenordnung, Umfang oder geschätzte Bausumme.',
        fehlermeldung: 'Bitte beschreiben Sie den Umfang.' },
      { typ: 'datum', schluessel: 'fertigstellung_bis', label: 'Fertigstellung bis',
        pflicht: true, sortierung: 3,
        fehlermeldung: 'Bitte geben Sie den gewünschten Fertigstellungstermin an.' },
      // REQ-04: das Leistungsverzeichnis. Optional — wer noch keines hat, soll
      // trotzdem anfragen können.
      { typ: 'datei', schluessel: 'lv_datei', label: 'Leistungsverzeichnis', pflicht: false,
        sortierung: 4,
        mime: ['application/pdf',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        maxBytes: 20 * 1024 * 1024,
        hilfetext: 'PDF oder XLSX, bis 20 MB.',
        fehlermeldung: 'Bitte laden Sie das Leistungsverzeichnis als PDF oder XLSX hoch.' },
      ...gemeinsam(10),
    ],
  },
  {
    slug: 'operations',
    schluessel: FORMULAR_SCHLUESSEL['operations']!,
    titel: 'Digitale Abläufe anfragen',
    felder: [
      { typ: 'auswahl', schluessel: 'anliegen', label: 'Ihr Anliegen', pflicht: true,
        sortierung: 1, optionen: optionen([
          ['prozessanalyse', 'Abläufe aufnehmen und analysieren'],
          ['software', 'Software einführen oder ablösen'],
          ['automatisierung', 'Wiederkehrende Arbeit automatisieren'],
          ['migration', 'Daten aus einem Altsystem übernehmen'],
          ['schulung', 'Schulung für ein bestehendes System'],
        ]),
        fehlermeldung: 'Bitte wählen Sie aus, worum es geht.' },
      { typ: 'zahl', schluessel: 'anzahl_mitarbeitende', label: 'Betroffene Mitarbeitende',
        pflicht: true, sortierung: 2, min: 1,
        hilfetext: 'Wie viele Personen arbeiten mit dem Ablauf?',
        fehlermeldung: 'Bitte geben Sie an, wie viele Personen betroffen sind.' },
      { typ: 'textarea', schluessel: 'systeme', label: 'Eingesetzte Systeme',
        pflicht: false, sortierung: 3, maxLaenge: 1000,
        hilfetext: 'Welche Programme nutzen Sie heute dafür?',
        fehlermeldung: 'Bitte kürzen Sie diese Angabe.' },
      { typ: 'auswahl', schluessel: 'zeitrahmen', label: 'Gewünschter Zeitrahmen',
        pflicht: true, sortierung: 4, optionen: optionen([
          ['sofort', 'So bald wie möglich'],
          ['quartal', 'Im laufenden Quartal'],
          ['halbjahr', 'Im nächsten Halbjahr'],
          ['offen', 'Noch offen'],
        ]),
        fehlermeldung: 'Bitte wählen Sie einen Zeitrahmen.' },
      ...gemeinsam(10),
    ],
  },
];
