/**
 * Wie das Ziel eines Rückwegs heisst — in beiden Sprachen (DESIGN §5 „The way
 * back", D-613, V-108).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, der diese Datei gebracht hat.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gemessen am 22.09.2026: von **311** Seiten unter `/portal/[mandant]` trugen
 * **2** einen Rückweg. Der Mandant hat es an zwei Stellen von selbst gefunden:
 * er klickte in der Beschäftigungsliste auf „Amir Haddad" und stand auf einem
 * Blatt ohne Ausgang; er öffnete „Stundenkonto" und fand keinen Weg zurück.
 *
 * **283 Dateien von Hand zu ändern wäre die falsche Antwort.** Es wäre
 * einmalig richtig und beim nächsten neuen Bildschirm wieder falsch. Der
 * Rückweg wird deshalb ABGELEITET: aus der Adresse, gegen das Routenregister,
 * einmal in der Hülle — und damit trägt ihn jede Seite, auch die, die es
 * morgen gibt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier steht und warum es Wörter sind und keine Ableitung.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DESIGN §5: „Was dort steht, aus Sicht des ZIELS: „Alle Anstellungen", nicht
 * „Zurück"." Ein Pfeil mit dem Wort „Zurück" sagt nur, dass es zurückgeht;
 * ein Pfeil mit dem Namen des Ziels sagt, WOHIN — und das ist der
 * Unterschied zwischen einem Knopf, den man drückt, und einem, den man
 * ausprobiert.
 *
 * Den Namen aus dem Adresssegment zu bilden geht nicht: `lv` ist das
 * Leistungsverzeichnis, `oz` die Ordnungszahl, `mappe` die Vergabemappe.
 * Deshalb eine Tabelle — 81 Einträge, gemessen mit
 * `scripts/messung/eltern-segmente.ts`, nicht geraten.
 *
 * **Die deutschen Fachbegriffe bleiben auch im Englischen stehen**
 * (`Leistungsnachweise`, `Aufmass`, `Nachträge`, `Wachbuch`, `Dienstplan`):
 * sie tragen Rechtsbedeutung (VOB, GoBD, GewO), und eine erfundene englische
 * Entsprechung verliert sie. Wo ein Begriff stehen bleibt, steht die
 * Erklärung daneben.
 */
import type { InternSprache } from '../intern.js';

/**
 * Das Ziel ist ein DATENSATZ, keine Liste — `…/kunden/[id]/steuer` führt
 * zurück auf den Kunden, nicht auf die Kundenliste.
 *
 * Wie der Datensatz HEISST, weiss die Hülle nicht: sein Name steht in der
 * Datenbank, und ihn dafür zu laden hiesse, jede Seite um eine Abfrage teurer
 * zu machen. „Übersicht" ist deshalb die ehrliche Beschriftung — es ist genau
 * die Seite, auf die es geht: die Übersicht dieses einen Datensatzes.
 */
const DATENSATZ: Readonly<Record<InternSprache, string>> = {
  de: 'Übersicht',
  en: 'Overview',
};

/**
 * Die Rückfallbeschriftung.
 *
 * Sie steht hier, damit ein Segment, das morgen dazukommt, einen Rückweg
 * bekommt statt keinen — und `tests/kern/rueckweg.test.ts` verlangt
 * zugleich, dass sie NIE gebraucht wird. Beides zusammen: die Seite
 * funktioniert sofort, und der fehlende Eintrag wird trotzdem gemeldet.
 */
const RUECKFALL: Readonly<Record<InternSprache, string>> = {
  de: 'Zurück',
  en: 'Back',
};

const SEGMENTE: Readonly<Record<string, Readonly<Record<InternSprache, string>>>> = {
  abwesenheiten: { de: 'Abwesenheiten', en: 'Absences' },
  agenten: { de: 'Agenten', en: 'Agents' },
  akquise: { de: 'Akquise', en: 'Prospecting' },
  angebote: { de: 'Angebote', en: 'Quotes' },
  anstellungen: { de: 'Beschäftigungen', en: 'Anstellungen (employments)' },
  antraege: { de: 'Anträge', en: 'Requests' },
  aufgaben: { de: 'Aufgaben', en: 'Tasks' },
  aufmass: { de: 'Aufmass', en: 'Aufmass (VOB measurement)' },
  auftraege: { de: 'Aufträge', en: 'Orders' },
  ausgaben: { de: 'Ausgaben', en: 'Expenses' },
  bank: { de: 'Bank', en: 'Bank' },
  bau: { de: 'Bau', en: 'Construction' },
  bautagebuch: { de: 'Bautagebuch', en: 'Bautagebuch (site diary)' },
  behinderungen: { de: 'Behinderungen', en: 'Behinderungen (VOB obstructions)' },
  belege: { de: 'Belege', en: 'Receipts' },
  benutzer: { de: 'Benutzer', en: 'Users' },
  berichte: { de: 'Berichte', en: 'Reports' },
  bewerbungen: { de: 'Bewerbungen', en: 'Applications' },
  buchhaltung: { de: 'Buchhaltung', en: 'Accounting' },
  buchungen: { de: 'Buchungen', en: 'Journal entries' },
  crm: { de: 'CRM', en: 'CRM' },
  datenschutz: { de: 'Datenschutz', en: 'Datenschutz (data protection)' },
  datev: { de: 'DATEV', en: 'DATEV' },
  dienstanweisungen: { de: 'Dienstanweisungen', en: 'Standing instructions' },
  dienstplan: { de: 'Dienstplan', en: 'Dienstplan (roster)' },
  dokumente: { de: 'Dokumente', en: 'Documents' },
  eingangsrechnungen: { de: 'Eingangsrechnungen', en: 'Incoming invoices' },
  einstellungen: { de: 'Einstellungen', en: 'Settings' },
  einwaende: { de: 'Einwände', en: 'Objections' },
  finanzen: { de: 'Finanzen', en: 'Finance' },
  formulare: { de: 'Formulare', en: 'Forms' },
  freigaben: { de: 'Freigaben', en: 'Approvals' },
  gespraeche: { de: 'Gespräche', en: 'Interviews' },
  kalender: { de: 'Kalender', en: 'Calendar' },
  kandidaten: { de: 'Kandidaten', en: 'Candidates' },
  konflikte: { de: 'Konflikte', en: 'Conflicts' },
  kontakte: { de: 'Kontakte', en: 'Contacts' },
  kunden: { de: 'Kunden', en: 'Customers' },
  leads: { de: 'Leads', en: 'Leads' },
  leistungen: { de: 'Leistungen', en: 'Services' },
  leistungskatalog: { de: 'Leistungskatalog', en: 'Service catalogue' },
  leistungsnachweise: {
    de: 'Leistungsnachweise', en: 'Leistungsnachweise (countersigned records)',
  },
  lv: { de: 'Leistungsverzeichnis', en: 'Leistungsverzeichnis (bill of quantities)' },
  /*
   * `Lieferanten` bleibt auch im englischen Text stehen (V-006): im
   * Rechnungswesen ist der Begriff an den Kreditor gebunden, und
   * `lieferantennummer` und `kreditorennummer` sind zwei verschiedene
   * Dinge — „suppliers" fuer beides verwischt genau das.
   */
  lieferanten: { de: 'Lieferanten', en: 'Lieferanten' },
  mahnungen: { de: 'Mahnungen', en: 'Dunning' },
  mappe: { de: 'Vergabemappe', en: 'Vergabemappe (tender folder)' },
  nachrichten: { de: 'Nachrichten', en: 'Messages' },
  nachtraege: { de: 'Nachträge', en: 'Nachträge (VOB variations)' },
  nachweise: { de: 'Nachweise', en: 'Certificates' },
  news: { de: 'News', en: 'News' },
  objekte: { de: 'Objekte', en: 'Objekte (sites)' },
  personal: { de: 'Personal', en: 'People' },
  personen: { de: 'Personen', en: 'People' },
  posten: { de: 'Posten', en: 'Guard posts' },
  posts: { de: 'Beiträge', en: 'Posts' },
  profile: { de: 'Profile', en: 'Profiles' },
  projekte: { de: 'Projekte', en: 'Projects' },
  protokoll: { de: 'Protokoll', en: 'Audit log' },
  pruefungen: { de: 'Prüfungen', en: 'Inspections' },
  qualitaet: { de: 'Qualität', en: 'Quality' },
  radar: { de: 'Radar', en: 'Radar' },
  raumbuch: { de: 'Raumbuch', en: 'Raumbuch (room schedule)' },
  rechnungen: { de: 'Rechnungen', en: 'Invoices' },
  recruiting: { de: 'Recruiting', en: 'Recruiting' },
  referenzen: { de: 'Referenzen', en: 'References' },
  reinigung: { de: 'Reinigung', en: 'Cleaning' },
  reklamationen: { de: 'Reklamationen', en: 'Complaints' },
  reviere: { de: 'Reviere', en: 'Reviere (cleaning areas)' },
  richtlinien: { de: 'Richtlinien', en: 'Policies' },
  rollen: { de: 'Rollen', en: 'Roles' },
  schluessel: { de: 'Schlüssel', en: 'Keys' },
  security: { de: 'Security', en: 'Security' },
  seiten: { de: 'Seiten', en: 'Pages' },
  serien: { de: 'Serien', en: 'Series' },
  social: { de: 'Social Media', en: 'Social media' },
  stammdaten: { de: 'Stammdaten', en: 'Master data' },
  stellen: { de: 'Stellen', en: 'Vacancies' },
  stundenkonten: { de: 'Stundenkonten', en: 'Hour accounts' },
  turnus: { de: 'Turnus', en: 'Turnus (cleaning cycle)' },
  veranstaltungen: { de: 'Veranstaltungen', en: 'Events' },
  wachbuch: { de: 'Wachbuch', en: 'Wachbuch (guard log, § 34a GewO)' },
  website: { de: 'Website', en: 'Website' },
  zahlungen: { de: 'Zahlungen', en: 'Payments' },
  zeiten: { de: 'Zeiten', en: 'Time' },
};

/** Die Segmente, für die es einen Namen gibt — für die Vollständigkeitsprüfung. */
export const BEKANNTE_RUECKZIELE: ReadonlySet<string> = new Set(Object.keys(SEGMENTE));

/**
 * Wie das Ziel heisst, dessen Adresse auf `segment` endet.
 *
 * Ein dynamisches Segment (`[id]`, `[aufmassId]`, `[agent]`) ist ein
 * DATENSATZ — dorthin führt „Übersicht".
 */
export function rueckzielName(segment: string, sprache: InternSprache): string {
  if (segment.startsWith('[')) return DATENSATZ[sprache];
  return (SEGMENTE[segment] ?? RUECKFALL)[sprache];
}
