/**
 * Die Tab-Leisten der Portale (SEITENKARTE §11.2, DESIGN §5/§8).
 *
 * Unter 768 px ersetzt eine Leiste mit **genau fuenf Zielen** die Sidebar.
 * Fuenf, nicht "bis zu fuenf": eine Leiste mit drei Punkten sieht aus wie eine
 * halb geladene, eine mit sieben trifft auf einem Telefon niemand.
 *
 * **Das interne Portal hat als fuenftes `Mehr`**, weil es weit mehr als fuenf
 * Module hat; dahinter liegt der vollstaendige Sidebar-Baum. Die Arbeiter- und
 * die Gruppenleiste haben es NICHT: was eine Reinigungskraft im Treppenhaus
 * braucht, steht in den fuenf, und ein sechstes Ziel hinter einem Menue ist
 * eines, das sie nicht findet.
 */
import type { Familie } from './routen.js';

export interface TabZiel {
  readonly schluessel: string;
  readonly label: string;
  /**
   * Der Pfad relativ zur Portalwurzel; leer heisst die Wurzel selbst.
   *
   * Beginnt er mit `/`, ist er ABSOLUT — das braucht genau ein Ziel: `Profil`
   * fuehrt in jedem Portal auf `/portal/konto/profil` (§9, `USR`). Das Konto
   * liest die eigenen Zeilen ueber `benutzer_id` und loest sich in jedem Scope
   * gleich auf; es je Portal zu kopieren hiesse, dieselbe Seite viermal zu
   * haben, oder — schlimmer — einer Arbeiterin ihr eigenes Passwort
   * wegzunehmen.
   *
   * **`/portal/konto` ohne Unterseite ist KEINE Route.** Das Manifest kennt
   * `/portal/konto/profil`, `/sicherheit`, `/benachrichtigungen`,
   * `/kalender-feed` und `/zugriffe` — die Wurzel steht nicht darin, und
   * `findeRoute` liefert fuer sie `undefined`. Der Tab zeigte damit auf 404.
   */
  readonly pfad: string;
  /** Der Rechteschluessel, oder `null` fuer `Mehr` und den Selbstzugriff. */
  readonly recht: string | null;
  readonly symbol: string;
}

/** Fuer welches Publikum eine Leiste gilt. */
export type LeistenSchluessel =
  | 'intern_global' | 'intern_admin' | 'intern_leitung'
  | 'mitarbeiter' | 'kunde' | 'gruppe';

export interface TabLeiste {
  readonly schluessel: LeistenSchluessel;
  readonly familie: Familie;
  readonly ziele: readonly TabZiel[];
}

const MEHR: TabZiel = {
  schluessel: 'mehr', label: 'Mehr', pfad: '', recht: null, symbol: '⋯',
};

export const TABLEISTEN: readonly TabLeiste[] = [
  {
    schluessel: 'intern_global',
    familie: 'mandant',
    ziele: [
      { schluessel: 'dashboard', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', symbol: '▤' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', symbol: '⛓' },
      { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan/woche', recht: 'dienstplan.lesen', symbol: '▦' },
      { schluessel: 'finanzen', label: 'Finanzen', pfad: 'finanzen', recht: 'finanzen.lesen', symbol: '€' },
      MEHR,
    ],
  },
  {
    schluessel: 'intern_admin',
    familie: 'mandant',
    ziele: [
      { schluessel: 'dashboard', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', symbol: '▤' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', symbol: '⛓' },
      { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan/woche', recht: 'dienstplan.lesen', symbol: '▦' },
      { schluessel: 'freigaben', label: 'Freigaben', pfad: 'freigaben', recht: 'freigabe.lesen', symbol: '✓' },
      MEHR,
    ],
  },
  {
    schluessel: 'intern_leitung',
    familie: 'mandant',
    ziele: [
      { schluessel: 'dashboard', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', symbol: '▤' },
      { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan/woche', recht: 'dienstplan.lesen', symbol: '▦' },
      { schluessel: 'zeiten', label: 'Zeiten', pfad: 'zeiten', recht: 'zeit.lesen', symbol: '◷' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', symbol: '⛓' },
      MEHR,
    ],
  },
  {
    schluessel: 'mitarbeiter',
    familie: 'mein',
    // Kein `Mehr`: die fuenf sind alles, was ein Einsatz braucht.
    ziele: [
      { schluessel: 'heute', label: 'Heute', pfad: '', recht: null, symbol: '☀' },
      { schluessel: 'schichten', label: 'Schichten', pfad: 'schichten', recht: null, symbol: '▦' },
      { schluessel: 'stunden', label: 'Stunden', pfad: 'stundenkonto', recht: null, symbol: '◷' },
      { schluessel: 'nachrichten', label: 'Nachrichten', pfad: 'nachrichten', recht: null, symbol: '✉' },
      { schluessel: 'profil', label: 'Profil', pfad: '/portal/konto/profil', recht: null, symbol: '☺' },
    ],
  },
  {
    schluessel: 'kunde',
    familie: 'kunde',
    ziele: [
      { schluessel: 'uebersicht', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', symbol: '▤' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', symbol: '⛓' },
      { schluessel: 'rechnungen', label: 'Rechnungen', pfad: 'rechnungen', recht: 'finanzen.lesen', symbol: '€' },
      { schluessel: 'nachweise', label: 'Nachweise', pfad: 'nachweise', recht: 'nachweis.lesen', symbol: '▤' },
      { schluessel: 'nachrichten', label: 'Nachrichten', pfad: 'nachrichten', recht: 'nachricht.lesen', symbol: '✉' },
    ],
  },
  {
    schluessel: 'gruppe',
    familie: 'gruppe',
    // Ebenfalls kein `Mehr`: jede Gruppenseite ist lesend und von den fuenf
    // Knotenpunkten aus erreichbar.
    ziele: [
      { schluessel: 'uebersicht', label: 'Übersicht', pfad: '', recht: 'gruppe.bericht.lesen', symbol: '▤' },
      { schluessel: 'finanzen', label: 'Finanzen', pfad: 'finanzen', recht: 'gruppe.finanzen.lesen', symbol: '€' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'gruppe.auftrag.lesen', symbol: '⛓' },
      { schluessel: 'radar', label: 'Radar', pfad: 'radar', recht: 'gruppe.radar.lesen', symbol: '◎' },
      { schluessel: 'berichte', label: 'Berichte', pfad: 'berichte', recht: 'gruppe.bericht.lesen', symbol: '▥' },
    ],
  },
] as const;

/** Die Leisten OHNE `Mehr` — §11.2 nennt sie beim Namen. */
export const OHNE_MEHR: readonly LeistenSchluessel[] = ['mitarbeiter', 'gruppe'];

export function tableiste(schluessel: LeistenSchluessel): TabLeiste {
  const l = TABLEISTEN.find((t) => t.schluessel === schluessel);
  if (l === undefined) throw new Error(`Unbekannte Tab-Leiste: ${schluessel}`);
  return l;
}

/**
 * Welche Leiste eine Sitzung bekommt.
 *
 * Nach Portal UND Rolle: `intern` allein reicht nicht, weil sich `admin` und
 * `leitung` im vierten Ziel unterscheiden — Freigaben gegen Zeiterfassung.
 * Genau darin besteht der Unterschied der beiden Rollen im Alltag.
 */
export function leisteFuer(
  portal: 'intern' | 'mitarbeiter' | 'kunde',
  scope: 'mandant' | 'gruppe' | 'person' | 'kunde',
  rolle: string | null,
): LeistenSchluessel {
  if (scope === 'gruppe') return 'gruppe';
  if (portal === 'mitarbeiter') return 'mitarbeiter';
  if (portal === 'kunde') return 'kunde';
  if (rolle === 'admin') return 'intern_admin';
  if (rolle === 'leitung') return 'intern_leitung';
  return 'intern_global';
}

/** Das Ziel eines Tabs unter einer Portalwurzel. */
export function tabZiel(wurzel: string, z: TabZiel): string {
  if (z.pfad.startsWith('/')) return z.pfad;
  return z.pfad === '' ? wurzel : `${wurzel}/${z.pfad}`;
}
