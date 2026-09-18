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
import type { IconName } from '@/lib/design/icons';
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
  /** Das Icon aus dem geschlossenen Satz (DESIGN §5). */
  readonly icon: IconName;
}

/** Fuer welches Publikum eine Leiste gilt. */
export type LeistenSchluessel =
  | 'intern_global' | 'intern_admin' | 'intern_leitung'
  | 'mitarbeiter' | 'kunde' | 'gruppe';

/**
 * Die Leisten des INTERNEN Publikums — die vier, die die zweisprachige Huelle
 * deckt (D-592).
 *
 * Sie steht hier und nicht in der Huelle, weil `LeistenSchluessel` hier steht:
 * kommt eine funfte interne Leiste dazu, faellt der Compiler ueber diese
 * Zeile, und nicht erst der Bildschirm ueber eine fehlende Uebersetzung.
 */
export const INTERNE_LEISTEN: readonly LeistenSchluessel[] = [
  'intern_global', 'intern_admin', 'intern_leitung', 'gruppe',
];

export function istInterneLeiste(schluessel: LeistenSchluessel): boolean {
  return INTERNE_LEISTEN.includes(schluessel);
}

export interface TabLeiste {
  readonly schluessel: LeistenSchluessel;
  readonly familie: Familie;
  readonly ziele: readonly TabZiel[];
}

const MEHR: TabZiel = {
  schluessel: 'mehr', label: 'Mehr', pfad: '', recht: null, icon: 'menue',
};

export const TABLEISTEN: readonly TabLeiste[] = [
  {
    schluessel: 'intern_global',
    familie: 'mandant',
    ziele: [
      { schluessel: 'dashboard', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', icon: 'uebersicht' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', icon: 'auftrag' },
      { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan/woche', recht: 'dienstplan.lesen', icon: 'dienstplan' },
      { schluessel: 'finanzen', label: 'Finanzen', pfad: 'finanzen', recht: 'finanzen.lesen', icon: 'euro' },
      MEHR,
    ],
  },
  {
    schluessel: 'intern_admin',
    familie: 'mandant',
    ziele: [
      { schluessel: 'dashboard', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', icon: 'uebersicht' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', icon: 'auftrag' },
      { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan/woche', recht: 'dienstplan.lesen', icon: 'dienstplan' },
      { schluessel: 'freigaben', label: 'Freigaben', pfad: 'freigaben', recht: 'freigabe.lesen', icon: 'freigabe' },
      MEHR,
    ],
  },
  {
    schluessel: 'intern_leitung',
    familie: 'mandant',
    ziele: [
      { schluessel: 'dashboard', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', icon: 'uebersicht' },
      { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan/woche', recht: 'dienstplan.lesen', icon: 'dienstplan' },
      { schluessel: 'zeiten', label: 'Zeiten', pfad: 'zeiten', recht: 'zeit.lesen', icon: 'zeit' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', icon: 'auftrag' },
      MEHR,
    ],
  },
  {
    schluessel: 'mitarbeiter',
    familie: 'mein',
    // Kein `Mehr`: die fuenf sind alles, was ein Einsatz braucht.
    ziele: [
      { schluessel: 'heute', label: 'Heute', pfad: '', recht: null, icon: 'heute' },
      { schluessel: 'schichten', label: 'Schichten', pfad: 'schichten', recht: null, icon: 'dienstplan' },
      { schluessel: 'stunden', label: 'Stunden', pfad: 'stundenkonto', recht: null, icon: 'zeit' },
      { schluessel: 'nachrichten', label: 'Nachrichten', pfad: 'nachrichten', recht: null, icon: 'mail' },
      { schluessel: 'profil', label: 'Profil', pfad: '/portal/konto/profil', recht: null, icon: 'person' },
    ],
  },
  {
    schluessel: 'kunde',
    familie: 'kunde',
    /*
     * **Noch OHNE `Mehr` — und das ist eine offene Luecke, keine Ruhe.**
     *
     * Das Kundenportal fuehrt inzwischen ZEHN gebaute Listen samt Blaettern
     * (19 Adressen) und diese Leiste vier plus Uebersicht; `angebote`,
     * `objekte`, `projekte`, `zahlungen`, `dokumente` und `reklamationen`
     * sind damit gebaut und aus KEINER Leiste erreichbar. Der Baum dafuer
     * steht vollstaendig als `KUNDEN_NAVIGATION` in `registry/navigation.ts`
     * — seit dem Kundenportal-Stapel mit allen elf Punkten. Einen Schritt
     * weit helfen die Sprungkarten von `/portal/kunde` (dort von sechs auf
     * zehn erweitert); eine Leiste ersetzen sie nicht.
     *
     * Was fehlt, liegt NICHT in diesem Register: `components/portal/
     * TabLeiste.tsx` (`MehrZelle` kennt genau zwei Baeume),
     * `components/portal/PortalRahmen.tsx` und `app/portal/zugang.ts` (die
     * Rechtekarte wird fuer `kunde` aus `NAVIGATION` gebaut, und
     * `zusatzRecht` wird dort gar nicht gefragt). Wuerde hier jetzt `MEHR`
     * stehen, gaebe das Blatt den INTERNEN Baum unter `/portal/kunde` aus —
     * `finanzen/rechnungen`, `qualitaet/reklamationen`, `bau/projekte` und
     * weitere, allesamt 404, und jeder davon verriete die Existenz dessen,
     * was er nicht zeigen darf (AUT-06). Die vier Aenderungen gehoeren
     * zusammen eingespielt; bis dahin bleibt die Leiste, wie sie ist. Der
     * ausformulierte Vorschlag fuer alle vier steht in der Warteschlange
     * (`docs/architecture/routenbau/register/kundenportal.md`, „Sonstiges")
     * und wartet auf eine Hand, die alle vier Dateien anfassen darf.
     */
    ziele: [
      { schluessel: 'uebersicht', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', icon: 'uebersicht' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', icon: 'auftrag' },
      { schluessel: 'rechnungen', label: 'Rechnungen', pfad: 'rechnungen', recht: 'finanzen.lesen', icon: 'rechnung' },
      { schluessel: 'nachweise', label: 'Nachweise', pfad: 'nachweise', recht: 'nachweis.lesen', icon: 'dokument' },
      { schluessel: 'nachrichten', label: 'Nachrichten', pfad: 'nachrichten', recht: 'nachricht.lesen', icon: 'mail' },
    ],
  },
  {
    schluessel: 'gruppe',
    familie: 'gruppe',
    // Ebenfalls kein `Mehr`: jede Gruppenseite ist lesend und von den fuenf
    // Knotenpunkten aus erreichbar.
    ziele: [
      { schluessel: 'uebersicht', label: 'Übersicht', pfad: '', recht: 'gruppe.bericht.lesen', icon: 'uebersicht' },
      { schluessel: 'finanzen', label: 'Finanzen', pfad: 'finanzen', recht: 'gruppe.finanzen.lesen', icon: 'euro' },
      { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'gruppe.auftrag.lesen', icon: 'auftrag' },
      { schluessel: 'radar', label: 'Radar', pfad: 'radar', recht: 'gruppe.radar.lesen', icon: 'ausschreibung' },
      { schluessel: 'berichte', label: 'Berichte', pfad: 'berichte', recht: 'gruppe.bericht.lesen', icon: 'uebersicht' },
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
