/**
 * Ein Rechteschlüssel als SATZ — `kalkulation.lesen` → „Kalkulationen lesen".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund (Nutzerbericht).**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Über vierhundert Stellen im Portal zeigen einem Menschen den rohen
 * Schlüssel:
 *
 *     Ihnen fehlt `kalkulation.lesen`; die Spalte bleibt leer.
 *     Bestätigen darf, wer `bau.schreiben` hält.
 *     Das Anlegen verlangt `eingang.schreiben`.
 *
 * Für die Objektleitung, die das liest, ist `kalkulation.lesen` Quelltext.
 * Sie erfährt, dass ihr etwas fehlt, aber nicht WAS — und kann deshalb auch
 * nicht danach fragen. Ein Hinweis, den der Adressat nicht in eine Bitte
 * übersetzen kann, ist kein Hinweis.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum zwei kleine Tabellen und keine grosse.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Katalog führt 243 Schlüssel, und jeder besteht aus `objekt` und
 * `aktion` (`katalog.generiert.ts`). 243 Sätze in zwei Sprachen von Hand
 * wären 486 Zeilen, die beim 244. Schlüssel unvollständig sind — und der
 * Katalog wächst mit jedem Modul.
 *
 * Zusammengesetzt wird deshalb aus 112 Hauptwörtern und 41 Tätigkeitswörtern.
 * Ein neuer Schlüssel aus bekannten Teilen ergibt von selbst einen Satz; ein
 * unbekanntes Teil wird lesbar gemacht (`crm_entgelt` → „Crm Entgelt") statt
 * versteckt, damit es hier nachgetragen wird, statt unbemerkt roh
 * dazustehen.
 *
 * **Der technische Schlüssel verschwindet nicht.** Er steht im `title` des
 * Elements: wer ein Recht tatsächlich vergeben muss — die Administration —
 * braucht ihn wortwörtlich, und die Rechtematrix kennt nur ihn.
 */
import { KATALOG } from '../../server/auth/katalog.generiert.js';

export type RechtSprache = 'de' | 'en';

interface Wort { readonly de: string; readonly en: string }

/**
 * Die Hauptwörter — in der Form, in der sie im Satz stehen.
 *
 * Gespeichert wird die ANZEIGEFORM und nicht der Grundform-Schlüssel: „Preise
 * lesen" verlangt den Plural, „Zwei-Faktor einrichten" den Bindestrich. Eine
 * Regel, die beides aus `preis` und `zwei_faktor` herleitet, gäbe es nicht —
 * sie hiesse deutsche Grammatik.
 */
const OBJEKT: Readonly<Record<string, Wort>> = {
  abrechnung: { de: 'Abrechnungen', en: 'billing' },
  abwesenheit: { de: 'Abwesenheiten', en: 'absences' },
  abwesenheit_grund: { de: 'Abwesenheitsgründe', en: 'absence reasons' },
  agent: { de: 'Agenten', en: 'agents' },
  alle: { de: 'alles', en: 'everything' },
  angebot: { de: 'Angebote', en: 'quotes' },
  annahme: { de: 'Annahmen', en: 'assumptions' },
  anstellung: { de: 'Anstellungen', en: 'Anstellungen (employments)' },
  antrag: { de: 'Anträge', en: 'requests' },
  arbzg: { de: 'Arbeitszeitgrenzen', en: 'working-time limits' },
  audit: { de: 'das Protokoll', en: 'the audit log' },
  audit_sensitiv: { de: 'das vertrauliche Protokoll', en: 'the confidential audit log' },
  aufbewahrung: { de: 'Aufbewahrungsregeln', en: 'retention rules' },
  aufgabe: { de: 'Aufgaben', en: 'tasks' },
  aufmass: { de: 'Aufmasse', en: 'Aufmasse (site measurements)' },
  auftrag: { de: 'Aufträge', en: 'Aufträge (orders)' },
  auskunft: { de: 'Auskünfte', en: 'access requests' },
  autonomie: { de: 'die Selbständigkeit der Agenten', en: 'agent autonomy' },
  bau: { de: 'den Bau', en: 'construction' },
  behinderung: { de: 'Behinderungsanzeigen', en: 'obstruction notices' },
  benutzer: { de: 'Benutzerkonten', en: 'user accounts' },
  bericht: { de: 'Berichte', en: 'reports' },
  berichtigung: { de: 'Berichtigungen', en: 'rectifications' },
  betrieb: { de: 'den Betrieb', en: 'operations' },
  bewacher: { de: 'das Bewacherregister', en: 'the guard register' },
  bewerbung: { de: 'Bewerbungen', en: 'applications' },
  buchhaltung: { de: 'die Buchhaltung', en: 'accounting' },
  buchhaltung_konfiguration: { de: 'die Buchhaltungseinstellungen', en: 'accounting settings' },
  budget: { de: 'Budgets', en: 'budgets' },
  buendel: { de: 'Bündel', en: 'bundles' },
  checkin: { de: 'den Check-in', en: 'check-in' },
  crm: { de: 'Kundendaten', en: 'customer data' },
  crm_entgelt: { de: 'Kundenkonditionen', en: 'customer terms' },
  dashboard: { de: 'die Übersicht', en: 'the dashboard' },
  daten: { de: 'Daten', en: 'data' },
  datenschutz: { de: 'den Datenschutz', en: 'data protection' },
  dienstanweisung: { de: 'Dienstanweisungen', en: 'standing orders' },
  dienstplan: { de: 'den Dienstplan', en: 'the duty roster' },
  dienstplan_arbzg: { de: 'Arbeitszeitgrenzen im Dienstplan', en: 'roster working-time limits' },
  dokument: { de: 'Dokumente', en: 'documents' },
  eingang: { de: 'den Rechnungseingang', en: 'incoming invoices' },
  einreichung: { de: 'Einreichungen', en: 'submissions' },
  einspruch: { de: 'Einsprüche', en: 'objections' },
  einstellung: { de: 'Einstellungen', en: 'settings' },
  einwand: { de: 'Einwände', en: 'objections' },
  entgelt: { de: 'Entgelte', en: 'pay' },
  entwurf: { de: 'Entwürfe', en: 'drafts' },
  erstattung: { de: 'Erstattungen', en: 'reimbursements' },
  feed_token: { de: 'den Kalenderschlüssel', en: 'the calendar key' },
  finanzen: { de: 'die Finanzen', en: 'finance' },
  formular: { de: 'Formulare', en: 'forms' },
  freigabe: { de: 'Freigaben', en: 'approvals' },
  freistellung: { de: 'Freistellungen', en: 'exemptions' },
  identitaet: { de: 'die Identität', en: 'identity' },
  kalender: { de: 'den Kalender', en: 'the calendar' },
  kalkulation: { de: 'Kalkulationen', en: 'costings' },
  kanal: { de: 'Kanäle', en: 'channels' },
  katalog: { de: 'den Leistungskatalog', en: 'the service catalogue' },
  kommunikation: { de: 'die Kommunikation', en: 'communication' },
  konflikt: { de: 'Konflikte', en: 'conflicts' },
  konto: { de: 'das Konto', en: 'the account' },
  kunde: { de: 'Kunden', en: 'customers' },
  kundenfreigabe: { de: 'Kundenfreigaben', en: 'customer approvals' },
  loeschung: { de: 'Löschungen', en: 'erasures' },
  mahnung: { de: 'Mahnungen', en: 'dunning notices' },
  mandant: { de: 'Gesellschaften', en: 'Gesellschaften (legal entities)' },
  module: { de: 'Module', en: 'modules' },
  nacherfassung: { de: 'Nacherfassungen', en: 'retrospective entries' },
  nachricht: { de: 'Nachrichten', en: 'messages' },
  nachtrag: { de: 'Nachträge', en: 'Nachträge (variation orders)' },
  nachweis: { de: 'Nachweise', en: 'certificates' },
  nummernkreis: { de: 'Nummernkreise', en: 'number ranges' },
  objekt: { de: 'Objekte', en: 'Objekte (sites)' },
  objekt_import: { de: 'den Objektimport', en: 'site import' },
  oeffentlich: { de: 'die Website', en: 'the website' },
  personal: { de: 'Personaldaten', en: 'personnel data' },
  plattform: { de: 'die Plattform', en: 'the platform' },
  preis: { de: 'Preise', en: 'prices' },
  profil: { de: 'das Profil', en: 'the profile' },
  protokoll: { de: 'das Protokoll', en: 'the log' },
  pruefdauer: { de: 'die Prüffrist', en: 'the review window' },
  qualitaet: { de: 'die Qualität', en: 'quality' },
  radar: { de: 'den Ausschreibungsradar', en: 'the tender radar' },
  rechtsgrundlage: { de: 'Rechtsgrundlagen', en: 'legal bases' },
  recruiting: { de: 'das Recruiting', en: 'recruiting' },
  referenz: { de: 'Referenzen', en: 'references' },
  referenzdaten: { de: 'Referenzdaten', en: 'reference data' },
  reinigung: { de: 'die Reinigung', en: 'cleaning' },
  richtlinie: { de: 'Richtlinien', en: 'policies' },
  rolle: { de: 'Rollen', en: 'roles' },
  schluessel: { de: 'Schlüssel', en: 'keys' },
  security: { de: 'die Security', en: 'security' },
  sitzung: { de: 'Anmeldungen', en: 'sessions' },
  social: { de: 'Social Media', en: 'social media' },
  stammdaten: { de: 'Stammdaten', en: 'master data' },
  stapel: { de: 'Stapel', en: 'batches' },
  status: { de: 'den Status', en: 'status' },
  stelle: { de: 'Stellen', en: 'job openings' },
  steuerfall: { de: 'den Steuerfall', en: 'the tax case' },
  system: { de: 'das System', en: 'the system' },
  system_audit: { de: 'das Systemprotokoll', en: 'the system log' },
  vergabe: { de: 'Vergaben', en: 'procurement' },
  versand: { de: 'den Versand', en: 'dispatch' },
  vertraulich: { de: 'Vertrauliches', en: 'confidential content' },
  verwaltungskonto: { de: 'Verwaltungskonten', en: 'administrative accounts' },
  wachbuch: { de: 'das Wachbuch', en: 'the Wachbuch (guard log)' },
  werkzeug: { de: 'Werkzeuge', en: 'tools' },
  wissen: { de: 'Wissensquellen', en: 'knowledge sources' },
  zahlung: { de: 'Zahlungen', en: 'payments' },
  zeit: { de: 'Zeiten', en: 'time records' },
  zugang: { de: 'den Zugang', en: 'access' },
  zwei_faktor: { de: 'den zweiten Faktor', en: 'the second factor' },
};

/** Die Tätigkeitswörter — im Infinitiv, wie sie hinter dem Hauptwort stehen. */
const AKTION: Readonly<Record<string, Wort>> = {
  abschliessen: { de: 'abschliessen', en: 'close' },
  aendern: { de: 'ändern', en: 'change' },
  anmelden: { de: 'anmelden', en: 'sign in to' },
  archivieren: { de: 'archivieren', en: 'archive' },
  bearbeiten: { de: 'bearbeiten', en: 'work on' },
  beenden: { de: 'beenden', en: 'end' },
  bewerten: { de: 'bewerten', en: 'assess' },
  einreichen: { de: 'einreichen', en: 'submit' },
  entscheiden: { de: 'entscheiden', en: 'decide' },
  erfassen: { de: 'erfassen', en: 'record' },
  erheben: { de: 'erheben', en: 'raise' },
  erstellen: { de: 'erstellen', en: 'create' },
  exportieren: { de: 'exportieren', en: 'export' },
  festschreiben: { de: 'festschreiben', en: 'finalise' },
  freigeben: { de: 'freigeben', en: 'approve' },
  genehmigen: { de: 'genehmigen', en: 'authorise' },
  herunterladen: { de: 'herunterladen', en: 'download' },
  korrigieren: { de: 'korrigieren', en: 'correct' },
  lesen: { de: 'lesen', en: 'read' },
  loeschen: { de: 'löschen', en: 'delete' },
  melden: { de: 'melden', en: 'report' },
  pflegen: { de: 'pflegen', en: 'maintain' },
  planen: { de: 'planen', en: 'plan' },
  pruefen: { de: 'prüfen', en: 'check' },
  quittieren: { de: 'quittieren', en: 'acknowledge' },
  rueckgaengig: { de: 'zurücknehmen', en: 'undo' },
  schreiben: { de: 'bearbeiten', en: 'edit' },
  setzen: { de: 'setzen', en: 'set' },
  starten: { de: 'starten', en: 'start' },
  stornieren: { de: 'stornieren', en: 'reverse' },
  uebersteuern: { de: 'übersteuern', en: 'override' },
  verbinden: { de: 'verbinden', en: 'connect' },
  veroeffentlichen: { de: 'veröffentlichen', en: 'publish' },
  versenden: { de: 'versenden', en: 'send' },
  verwalten: { de: 'verwalten', en: 'administer' },
  verwerfen: { de: 'verwerfen', en: 'discard' },
  widerrufen: { de: 'widerrufen', en: 'revoke' },
  ziehen: { de: 'ziehen', en: 'draw' },
  zuruecksetzen: { de: 'zurücksetzen', en: 'reset' },
  zusammenfuehren: { de: 'zusammenführen', en: 'merge' },
  zuweisen: { de: 'zuweisen', en: 'assign' },
};

/** `liefer_datum` → „Liefer Datum". Der Rückfall, wenn ein Teil fehlt. */
function lesbar(teil: string): string {
  return teil
    .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .replace(/^./u, (z) => z.toUpperCase())
    .trim();
}

const NACH_SCHLUESSEL = new Map(KATALOG.map((e) => [e.schluessel, e]));

/**
 * Der Satz zu einem Schlüssel — `kalkulation.lesen` → „Kalkulationen lesen".
 *
 * **Ein unbekannter Schlüssel wird nicht verschwiegen.** Er wird aus seinen
 * Teilen lesbar gemacht; steht er überhaupt nicht im Katalog, kommt er
 * unverändert zurück. Ein leerer String wäre hier das Schlimmste: der Satz
 * sagte dann gar nichts mehr, und niemand merkte es.
 */
export function rechtName(schluessel: string, sprache: RechtSprache = 'de'): string {
  const eintrag = NACH_SCHLUESSEL.get(schluessel);
  const [modulTeil, restTeil] = schluessel.split('.');
  const objektTeil = eintrag?.objekt ?? restTeil ?? modulTeil ?? schluessel;
  const aktionTeil = eintrag?.aktion
    ?? (restTeil === undefined ? '' : restTeil.split('_').slice(-1)[0] ?? '');

  const hauptwort = OBJEKT[objektTeil]?.[sprache] ?? lesbar(objektTeil);
  const taetigkeit = AKTION[aktionTeil]?.[sprache];
  if (taetigkeit === undefined) return `${hauptwort} — ${lesbar(aktionTeil)}`.trim();

  /*
   * Im Deutschen steht das Taetigkeitswort hinten („Kalkulationen lesen"), im
   * Englischen vorn („read costings"). Eine gemeinsame Reihenfolge gaebe in
   * einer der beiden Sprachen Unsinn.
   */
  return sprache === 'en'
    ? `${taetigkeit} ${hauptwort}`
    : `${hauptwort} ${taetigkeit}`;
}

/** Alle Schlüssel des Katalogs — für die Sperrklinke. */
export function alleRechteschluessel(): readonly string[] {
  return KATALOG.map((e) => e.schluessel);
}
