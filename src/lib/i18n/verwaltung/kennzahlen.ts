/**
 * Die Wörter der Kennzahlen: Kachelnamen, Listenfilter, die neuen Spalten der
 * Gruppenübersicht — in beiden Sprachen (DSH-01, DSH-04, V-149, V-150, D-592).
 *
 * **Warum die Kachelnamen hier stehen und nicht nur im Register.**
 * `Kachel.label` ist der deutsche Name, mit dem das Register prüft und das
 * Entwicklungsblatt arbeitet. Das Dashboard liest den Namen dagegen aus DIESER
 * Tabelle, in der Sprache der Sitzung; ein Schlüssel ohne Eintrag fällt auf
 * das deutsche Label zurück, nie auf den Schlüssel. Ein Test hält fest, dass
 * jede registrierte Kachel hier in beiden Sprachen steht.
 */
import type { InternSprache } from '../intern.js';

export interface KennzahlTexte {
  readonly kacheln: Readonly<Record<string, string>>;

  readonly gefiltert: string;
  readonly alleZeigen: string;
  readonly keinTreffer: string;
  readonly auftragStatus: Readonly<Record<string, string>>;
  readonly projektStatus: Readonly<Record<string, string>>;
  readonly angebotStatus: Readonly<Record<string, string>>;
  readonly angebotOffen: string;

  readonly gruppeProjekte: string;
  readonly gruppeImEinsatz: string;
  readonly gruppeAufgaben: string;

  readonly imEinsatzTitel: string;
  readonly imEinsatzErklaerung: string;
  readonly imEinsatzLeer: string;
  readonly imEinsatzBeschriftung: string;
  readonly spalteGesellschaft: string;
  readonly spaltePerson: string;
  readonly spalteObjekt: string;
  readonly spalteSeit: string;

  readonly angeboteTitel: string;
  readonly angeboteBeschriftung: string;
  readonly angeboteLeer: string;
  readonly angeboteHinweis: string;
  readonly spalteAngebot: string;
  readonly spalteNummer: string;
  readonly spalteKunde: string;
  readonly spalteWert: string;
  readonly spalteGueltigBis: string;
  readonly spalteStatus: string;

  readonly aufgabenTitel: string;
  readonly aufgabenErklaerung: string;
  readonly aufgabenBeschriftung: string;
  readonly aufgabenLeer: string;
  readonly aufgabenHinweis: string;
  readonly spalteAufgabe: string;
  readonly spalteFaellig: string;
}

export const KENNZAHL_TEXTE: Readonly<Record<InternSprache, KennzahlTexte>> = {
  de: {
    kacheln: {
      neue_leads: 'Neue Anfragen',
      leads_ueber_sla: 'Frist überschritten',
      benutzer_aktiv: 'Aktive Benutzer',
      personen: 'Personen',
      anstellungen: 'Beschäftigungen',
      letzte_aktivitaet: 'Aktivität (7 Tage)',
      offene_wiedervorlagen: 'Offene Wiedervorlagen',
      schichten_unbesetzt: 'Unbesetzte Schichten',
      konflikte_offen: 'Offene Konflikte',
      antraege_offen: 'Offene Anträge',
      abwesend_heute: 'Heute abwesend',
      nachweise_abgelaufen: 'Abgelaufene Nachweise',
      aktuell_im_einsatz: 'Aktuell im Einsatz',
      auftraege_aktiv: 'Aktive Aufträge',
      projekte_in_arbeit: 'Bauprojekte in Arbeit',
      angebote_offen: 'Offene Angebote',
      forderungen_offen: 'Offene Forderungen',
      aufgaben_offen: 'Offene Aufgaben',
    },

    gefiltert: 'Gefiltert:',
    alleZeigen: 'Alle anzeigen',
    keinTreffer: 'Kein Eintrag in dieser Auswahl.',
    auftragStatus: {
      angelegt: 'angelegt', aktiv: 'aktiv', pausiert: 'pausiert',
      abgeschlossen: 'abgeschlossen', storniert: 'storniert',
    },
    projektStatus: {
      geplant: 'geplant', in_arbeit: 'in Arbeit', abgenommen: 'abgenommen',
      abgeschlossen: 'abgeschlossen', archiviert: 'archiviert',
    },
    angebotStatus: {
      entwurf: 'Entwurf', in_pruefung: 'in Prüfung', versendet: 'versendet',
      angenommen: 'angenommen', abgelehnt: 'abgelehnt', zurueckgezogen: 'zurückgezogen',
      abgelaufen: 'abgelaufen',
    },
    angebotOffen: 'offen — Entwurf, in Prüfung oder versendet',

    gruppeProjekte: 'Bauprojekte in Arbeit',
    gruppeImEinsatz: 'Im Einsatz',
    gruppeAufgaben: 'Offene Aufgaben',

    imEinsatzTitel: 'Aktuell im Einsatz',
    imEinsatzErklaerung:
      'Wer gerade eingestempelt ist, über alle Gesellschaften — aus den offenen '
      + 'Zeiteinträgen, live (DSH-05). Gehandelt wird im Bereich.',
    imEinsatzLeer: 'Gerade ist niemand eingestempelt.',
    imEinsatzBeschriftung: 'Offene Zeiteinträge über alle Gesellschaften',
    spalteGesellschaft: 'Gesellschaft',
    spaltePerson: 'Person',
    spalteObjekt: 'Objekt',
    spalteSeit: 'Seit',

    angeboteTitel: 'Angebote',
    angeboteBeschriftung: 'Angebote über alle Gesellschaften',
    angeboteLeer: 'Kein Angebot in dieser Auswahl.',
    angeboteHinweis:
      'Ein Kunde ohne Namen heißt: kein Leserecht auf die Kundendaten dieses Bereichs. Öffnen, '
      + 'ändern und versenden geschieht im Bereich — der Verweis führt über das Wechselblatt '
      + 'dorthin.',
    spalteAngebot: 'Angebot',
    spalteNummer: 'Nummer',
    spalteKunde: 'Kunde',
    spalteWert: 'Wert netto',
    spalteGueltigBis: 'Gültig bis',
    spalteStatus: 'Status',

    aufgabenTitel: 'Offene Aufgaben',
    aufgabenErklaerung:
      'Offen, in Arbeit oder wartend, über alle Gesellschaften — dieselbe Menge, die die '
      + 'Aufgabenliste im Bereich zeigt. Die früheste Frist steht oben.',
    aufgabenBeschriftung: 'Offene Aufgaben über alle Gesellschaften',
    aufgabenLeer: 'Keine offene Aufgabe in dieser Auswahl.',
    aufgabenHinweis:
      'Zuweisen, bearbeiten und erledigen geschieht im Bereich — der Verweis führt über das '
      + 'Wechselblatt dorthin.',
    spalteAufgabe: 'Aufgabe',
    spalteFaellig: 'Fällig',
  },
  en: {
    kacheln: {
      neue_leads: 'New enquiries',
      leads_ueber_sla: 'Response time exceeded',
      benutzer_aktiv: 'Active users',
      personen: 'People',
      anstellungen: 'Employments',
      letzte_aktivitaet: 'Activity (7 days)',
      offene_wiedervorlagen: 'Open Wiedervorlagen (follow-ups)',
      schichten_unbesetzt: 'Unfilled shifts',
      konflikte_offen: 'Open conflicts',
      antraege_offen: 'Open requests',
      abwesend_heute: 'Absent today',
      nachweise_abgelaufen: 'Expired certificates',
      aktuell_im_einsatz: 'Currently working',
      auftraege_aktiv: 'Active orders',
      projekte_in_arbeit: 'Construction projects in progress',
      angebote_offen: 'Open offers',
      forderungen_offen: 'Open receivables',
      aufgaben_offen: 'Open tasks',
    },

    gefiltert: 'Filtered:',
    alleZeigen: 'Show all',
    keinTreffer: 'No entry in this selection.',
    auftragStatus: {
      angelegt: 'created', aktiv: 'active', pausiert: 'paused',
      abgeschlossen: 'completed', storniert: 'cancelled',
    },
    projektStatus: {
      geplant: 'planned', in_arbeit: 'in progress', abgenommen: 'accepted',
      abgeschlossen: 'completed', archiviert: 'archived',
    },
    angebotStatus: {
      entwurf: 'draft', in_pruefung: 'in review', versendet: 'sent',
      angenommen: 'accepted', abgelehnt: 'rejected', zurueckgezogen: 'withdrawn',
      abgelaufen: 'expired',
    },
    angebotOffen: 'open — draft, in review or sent',

    gruppeProjekte: 'Construction projects in progress',
    gruppeImEinsatz: 'Working now',
    gruppeAufgaben: 'Open tasks',

    imEinsatzTitel: 'Currently working',
    imEinsatzErklaerung:
      'Who is clocked in right now, across all companies — from the open time entries, live '
      + '(DSH-05). Actions happen within the company area.',
    imEinsatzLeer: 'Nobody is clocked in right now.',
    imEinsatzBeschriftung: 'Open time entries across all companies',
    spalteGesellschaft: 'Company',
    spaltePerson: 'Person',
    spalteObjekt: 'Site',
    spalteSeit: 'Since',

    angeboteTitel: 'Offers',
    angeboteBeschriftung: 'Offers across all companies',
    angeboteLeer: 'No offer in this selection.',
    angeboteHinweis:
      'A customer without a name means: no right to read the customer data of this area. '
      + 'Opening, editing and sending happens within the area — the link leads there via the '
      + 'switch page.',
    spalteAngebot: 'Offer',
    spalteNummer: 'Number',
    spalteKunde: 'Customer',
    spalteWert: 'Net value',
    spalteGueltigBis: 'Valid until',
    spalteStatus: 'Status',

    aufgabenTitel: 'Open tasks',
    aufgabenErklaerung:
      'Open, in progress or waiting, across all companies — the same set the task list shows '
      + 'within the company area. The earliest deadline comes first.',
    aufgabenBeschriftung: 'Open tasks across all companies',
    aufgabenLeer: 'No open task in this selection.',
    aufgabenHinweis:
      'Assigning, editing and completing happens within the company area — the link leads '
      + 'there via the switch page.',
    spalteAufgabe: 'Task',
    spalteFaellig: 'Due',
  },
};
