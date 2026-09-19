/**
 * Die Woerter, die auf JEDEM Verwaltungsbildschirm stehen — in beiden
 * Sprachen (D-592, D-419).
 *
 * **Der Befund, aus dem diese Datei entstanden ist.** Der Mandant hat die
 * Sprache auf Englisch gestellt. Die Seitenleiste wurde englisch, der
 * Seiteninhalt blieb deutsch: „Zahlungen · Offene Forderungen ·
 * Zahlungseingang erfassen · Betrag in Euro · Buchungstag · Ueberweisung".
 * Das ist keine halbe Uebersetzung, sondern eine halbe UMSETZUNG — die
 * Navigation laeuft seit je ueber `INTERN_BESCHRIFTUNGEN`, die Seitenruempfe
 * tragen ihre deutschen Zeichenketten fest verdrahtet.
 *
 * **Hier steht nur das Gemeinsame, nie eine Domaene.** „Speichern",
 * „Abbrechen", „Betrag", „Keine Eintraege" kommen auf hunderten Seiten vor;
 * sie gehoeren an EINE Stelle. „Offene Forderungen" gehoert nach
 * `verwaltung/finanzen.ts`, „Wachbuch" nach `verwaltung/security.ts`. Eine
 * Datei, die beides traegt, waechst auf zehntausend Zeilen und wird von
 * niemandem mehr gelesen.
 *
 * **Ein `Record` ueber `InternSprache`, kein `t()` mit freiem Schluessel.**
 * Ein fehlender Eintrag ist damit ein Fehler zur BAUZEIT und nicht ein
 * deutsches Wort mitten auf dem Bildschirm, den jemand liest, WEIL er kein
 * Deutsch kann.
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** `Mandant`,
 * `Anstellung`, `Leistungsnachweis`, `Wachbuch`, `Aufmass`, `Nachtrag`,
 * `Storno` tragen Rechtsbedeutung (VOB, GoBD, UStG, GewO). Englisch ist die
 * Uebersetzung der OBERFLAECHE, nicht der Begriffe; wo ein Begriff stehen
 * bleibt, gehoert eine Erklaerung daneben und nicht eine erfundene
 * Entsprechung. Siehe den Kopf von `intern.ts`, der dieselbe Regel fuer die
 * Navigation traegt.
 */
import { internSprache, type InternSprache } from '../intern.js';
import type { PortalSprache } from '../texte.js';

export interface VerwaltungTexte {
  /* ── Handlungen ────────────────────────────────────────────────────── */
  readonly speichern: string;
  readonly abbrechen: string;
  readonly zurueck: string;
  readonly weiter: string;
  readonly anlegen: string;
  readonly neu: string;
  readonly bearbeiten: string;
  readonly oeffnen: string;
  readonly suchen: string;
  readonly filtern: string;
  readonly zuruecksetzen: string;
  readonly exportieren: string;
  readonly herunterladen: string;
  readonly hochladen: string;
  readonly senden: string;
  readonly drucken: string;
  readonly bestaetigen: string;
  readonly uebernehmen: string;
  readonly ablehnen: string;
  readonly freigeben: string;
  readonly archivieren: string;
  readonly hinzufuegen: string;
  readonly entfernen: string;

  /* ── Spaltenkoepfe und Feldnamen ───────────────────────────────────── */
  readonly nummer: string;
  readonly name: string;
  readonly bezeichnung: string;
  readonly beschreibung: string;
  readonly datum: string;
  readonly zeitraum: string;
  readonly von: string;
  readonly bis: string;
  readonly betrag: string;
  readonly summe: string;
  readonly menge: string;
  readonly einheit: string;
  readonly preis: string;
  readonly zustand: string;
  readonly status: string;
  readonly art: string;
  readonly kunde: string;
  readonly objekt: string;
  readonly person: string;
  readonly anschrift: string;
  readonly telefon: string;
  readonly email: string;
  readonly bemerkung: string;
  readonly angelegt: string;
  readonly geaendert: string;
  readonly faellig: string;
  readonly aktionen: string;
  readonly auswahl: string;

  /* ── Zustaende der Flaeche ─────────────────────────────────────────── */
  readonly keineEintraege: string;
  readonly keineAuswahl: string;
  readonly ladeFehler: string;
  readonly pflichtfeld: string;
  readonly optional: string;
  readonly nurLesen: string;
  readonly listeGekuerzt: string;

  /**
   * Das Schild an jeder Flaeche, die eine Zugangsdaten-Angabe braucht und
   * keine hat.
   *
   * CLAUDE.md: „Never simulate a successful external call." Der Text sagt
   * deshalb, dass nichts passiert ist — nicht, dass etwas gleich passiert.
   */
  readonly nichtVerbunden: string;
  readonly nichtVerbundenHinweis: string;

  /**
   * Der Hinweis auf einer Seite, die ein Mensch freigeben muss
   * (Invariante 7).
   */
  readonly freigabeNoetig: string;

  /** Der Hinweis in der Gruppenansicht (Invariante 10). */
  readonly gruppeNurLesen: string;

  /**
   * Die Ueberschrift ueber einer offenen Frage an den Mandanten
   * (CLAUDE.md „Never invent a business rule").
   */
  readonly offeneFrage: string;

  /**
   * Der Satz, der unter jeder Zahl steht, die aus der Datenbank kommt und
   * NICHT auf dem Bildschirm gerechnet wurde (Invariante 1, 6).
   */
  readonly betraegeInEuro: string;
  readonly zeitzoneBerlin: string;
}

const DE: VerwaltungTexte = {
  speichern: 'Speichern',
  abbrechen: 'Abbrechen',
  zurueck: 'Zurück',
  weiter: 'Weiter',
  anlegen: 'Anlegen',
  neu: 'Neu',
  bearbeiten: 'Bearbeiten',
  oeffnen: 'Öffnen',
  suchen: 'Suchen',
  filtern: 'Filtern',
  zuruecksetzen: 'Zurücksetzen',
  exportieren: 'Exportieren',
  herunterladen: 'Herunterladen',
  hochladen: 'Hochladen',
  senden: 'Senden',
  drucken: 'Drucken',
  bestaetigen: 'Bestätigen',
  uebernehmen: 'Übernehmen',
  ablehnen: 'Ablehnen',
  freigeben: 'Freigeben',
  archivieren: 'Archivieren',
  hinzufuegen: 'Hinzufügen',
  entfernen: 'Entfernen',

  nummer: 'Nummer',
  name: 'Name',
  bezeichnung: 'Bezeichnung',
  beschreibung: 'Beschreibung',
  datum: 'Datum',
  zeitraum: 'Zeitraum',
  von: 'Von',
  bis: 'Bis',
  betrag: 'Betrag',
  summe: 'Summe',
  menge: 'Menge',
  einheit: 'Einheit',
  preis: 'Preis',
  zustand: 'Zustand',
  status: 'Status',
  art: 'Art',
  kunde: 'Kunde',
  objekt: 'Objekt',
  person: 'Person',
  anschrift: 'Anschrift',
  telefon: 'Telefon',
  email: 'E-Mail',
  bemerkung: 'Bemerkung',
  angelegt: 'Angelegt',
  geaendert: 'Geändert',
  faellig: 'Fällig',
  aktionen: 'Aktionen',
  auswahl: 'Auswahl',

  keineEintraege: 'Keine Einträge.',
  keineAuswahl: '— keine Auswahl —',
  ladeFehler: 'Die Daten konnten nicht geladen werden.',
  pflichtfeld: 'Pflichtfeld',
  optional: 'optional',
  nurLesen: 'Nur Lesen',
  listeGekuerzt: 'Es werden nur die neuesten Einträge gezeigt. Grenzen Sie die Liste ein.',

  nichtVerbunden: 'Nicht verbunden',
  nichtVerbundenHinweis:
    'Für diesen Dienst sind keine Zugangsdaten hinterlegt. Es wurde nichts '
    + 'gesendet und nichts abgerufen.',

  freigabeNoetig: 'Freigabe durch einen Menschen nötig',

  gruppeNurLesen:
    'Die Gruppenansicht liest nur. Zum Ändern wechseln Sie in die betroffene '
    + 'Gesellschaft.',

  offeneFrage: 'Offene Frage an den Auftraggeber',

  betraegeInEuro: 'Alle Beträge in Euro.',
  zeitzoneBerlin: 'Alle Zeiten in Europe/Berlin.',
};

const EN: VerwaltungTexte = {
  speichern: 'Save',
  abbrechen: 'Cancel',
  zurueck: 'Back',
  weiter: 'Continue',
  anlegen: 'Create',
  neu: 'New',
  bearbeiten: 'Edit',
  oeffnen: 'Open',
  suchen: 'Search',
  filtern: 'Filter',
  zuruecksetzen: 'Reset',
  exportieren: 'Export',
  herunterladen: 'Download',
  hochladen: 'Upload',
  senden: 'Send',
  drucken: 'Print',
  bestaetigen: 'Confirm',
  uebernehmen: 'Apply',
  ablehnen: 'Reject',
  freigeben: 'Approve',
  archivieren: 'Archive',
  hinzufuegen: 'Add',
  entfernen: 'Remove',

  nummer: 'Number',
  name: 'Name',
  bezeichnung: 'Label',
  beschreibung: 'Description',
  datum: 'Date',
  zeitraum: 'Period',
  von: 'From',
  bis: 'To',
  betrag: 'Amount',
  summe: 'Total',
  menge: 'Quantity',
  einheit: 'Unit',
  preis: 'Price',
  zustand: 'State',
  status: 'Status',
  art: 'Type',
  kunde: 'Customer',
  objekt: 'Site',
  person: 'Person',
  anschrift: 'Address',
  telefon: 'Phone',
  email: 'E-mail',
  bemerkung: 'Note',
  angelegt: 'Created',
  geaendert: 'Changed',
  faellig: 'Due',
  aktionen: 'Actions',
  auswahl: 'Selection',

  keineEintraege: 'No entries.',
  keineAuswahl: '— no selection —',
  ladeFehler: 'The data could not be loaded.',
  pflichtfeld: 'Required',
  optional: 'optional',
  nurLesen: 'Read only',
  listeGekuerzt: 'Only the most recent entries are shown. Narrow the list down.',

  nichtVerbunden: 'Not connected',
  nichtVerbundenHinweis:
    'No credentials are configured for this service. Nothing was sent and '
    + 'nothing was retrieved.',

  freigabeNoetig: 'Human approval required',

  gruppeNurLesen:
    'The group view only reads. To make a change, switch into the company '
    + 'concerned.',

  offeneFrage: 'Open question for the client',

  betraegeInEuro: 'All amounts in Euro.',
  zeitzoneBerlin: 'All times in Europe/Berlin.',
};

export const VERWALTUNG_TEXTE: Readonly<Record<InternSprache, VerwaltungTexte>> = {
  de: DE, en: EN,
};

/**
 * Die gemeinsamen Woerter in der Sprache dieser Sitzung.
 *
 * **Das Argument ist die ROHE Sprache der Sitzung** (`zugang.sprache`:
 * `PortalSprache | null`), nicht die schon abgebildete `InternSprache`. Die
 * Abbildung — `ar`/`tr`/`null` → Deutsch, nur ausdrueckliches `en` → Englisch
 * (D-592) — passiert hier, an einer Stelle. Haette jede der 359 Seiten sie
 * selbst zu tun, waere sie irgendwo vergessen worden, und ein tuerkisch
 * eingestelltes Verwaltungskonto saehe Englisch, das es nie gewaehlt hat.
 */
export function verwaltungTexte(
  sprache: PortalSprache | InternSprache | null | undefined,
): VerwaltungTexte {
  return VERWALTUNG_TEXTE[internSprache(sprache as PortalSprache | null | undefined)];
}
