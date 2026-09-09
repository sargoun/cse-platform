/**
 * Das Navigationsregister — die Sidebar aus einer Liste, nicht aus JSX.
 *
 * Ein Eintrag nennt sein Recht. Was der Benutzer nicht darf, erscheint gar
 * nicht: ein Menüpunkt, der auf einen 404 führt, ist schlechter als keiner,
 * weil er die Existenz dessen verrät, was er nicht zeigen darf (AUT-06).
 *
 * `gruppe` sagt, ob der Punkt in der Gruppenansicht überhaupt sinnvoll ist.
 * Alles Schreibende steht dort auf `false` — nicht weil es ausgeblendet
 * werden soll, sondern weil es dort nichts zu tun gibt (Invariante 10).
 */

export interface NaviEintrag {
  readonly schluessel: string;
  /** Deutsches Label. Die Sidebar ist intern; Arbeiterportale übersetzen. */
  readonly label: string;
  readonly pfad: string;
  /** Der Rechteschlüssel, ohne den der Punkt nicht erscheint. */
  readonly recht: string;
  /** Erscheint der Punkt in der Gruppenansicht (lesend)? */
  readonly gruppe: boolean;
  /** Ein Emoji-Platzhalter, bis O-12 die Markensymbole klärt. */
  readonly symbol: string;
}

export const NAVIGATION: readonly NaviEintrag[] = [
  { schluessel: 'dashboard', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', gruppe: true, symbol: '▤' },
  { schluessel: 'objekte', label: 'Objekte', pfad: 'objekte', recht: 'objekt.lesen', gruppe: true, symbol: '⌂' },
  { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan', recht: 'dienstplan.lesen', gruppe: true, symbol: '▦' },
  { schluessel: 'zeiten', label: 'Zeiten', pfad: 'zeiten', recht: 'zeit.lesen', gruppe: true, symbol: '◷' },
  { schluessel: 'personal', label: 'Personal', pfad: 'personal', recht: 'personal.lesen', gruppe: true, symbol: '☺' },
  { schluessel: 'angebote', label: 'Angebote', pfad: 'angebote', recht: 'angebot.lesen', gruppe: true, symbol: '✎' },
  { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', gruppe: true, symbol: '⛓' },
  { schluessel: 'rechnungen', label: 'Rechnungen', pfad: 'rechnungen', recht: 'finanzen.lesen', gruppe: true, symbol: '€' },
  { schluessel: 'dokumente', label: 'Dokumente', pfad: 'dokumente', recht: 'dokument.lesen', gruppe: true, symbol: '▤' },
  { schluessel: 'einstellungen', label: 'Einstellungen', pfad: 'einstellungen', recht: 'system.einstellung_lesen', gruppe: false, symbol: '⚙' },
] as const;

/** Die Punkte, die in der Gruppenansicht überhaupt erscheinen dürfen. */
export const GRUPPEN_NAVIGATION: readonly NaviEintrag[] =
  NAVIGATION.filter((n) => n.gruppe);
