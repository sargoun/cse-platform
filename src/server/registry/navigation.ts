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
import type { IconName } from '@/lib/design/icons';

export interface NaviEintrag {
  readonly schluessel: string;
  /** Deutsches Label. Die Sidebar ist intern; Arbeiterportale übersetzen. */
  readonly label: string;
  readonly pfad: string;
  /** Der Rechteschlüssel, ohne den der Punkt nicht erscheint. */
  readonly recht: string;
  /** Erscheint der Punkt in der Gruppenansicht (lesend)? */
  readonly gruppe: boolean;
  /** Das Icon aus dem geschlossenen Satz (DESIGN §5). */
  readonly icon: IconName;
}

export const NAVIGATION: readonly NaviEintrag[] = [
  { schluessel: 'dashboard', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', gruppe: true, icon: 'uebersicht' },
  { schluessel: 'crm', label: 'CRM', pfad: 'crm', recht: 'crm.lesen', gruppe: false, icon: 'crm' },
  { schluessel: 'objekte', label: 'Objekte', pfad: 'objekte', recht: 'objekt.lesen', gruppe: true, icon: 'objekt' },
  { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan', recht: 'dienstplan.lesen', gruppe: true, icon: 'dienstplan' },
  { schluessel: 'zeiten', label: 'Zeiten', pfad: 'zeiten', recht: 'zeit.lesen', gruppe: true, icon: 'zeit' },
  { schluessel: 'personal', label: 'Personal', pfad: 'personal', recht: 'personal.lesen', gruppe: true, icon: 'personal' },
  { schluessel: 'angebote', label: 'Angebote', pfad: 'angebote', recht: 'angebot.lesen', gruppe: true, icon: 'angebot' },
  { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', gruppe: true, icon: 'auftrag' },
  { schluessel: 'rechnungen', label: 'Rechnungen', pfad: 'rechnungen', recht: 'finanzen.lesen', gruppe: true, icon: 'rechnung' },
  { schluessel: 'dokumente', label: 'Dokumente', pfad: 'dokumente', recht: 'dokument.lesen', gruppe: true, icon: 'dokument' },
  { schluessel: 'einstellungen', label: 'Einstellungen', pfad: 'einstellungen', recht: 'system.einstellung_lesen', gruppe: false, icon: 'einstellungen' },
] as const;

/** Die Punkte, die in der Gruppenansicht überhaupt erscheinen dürfen. */
export const GRUPPEN_NAVIGATION: readonly NaviEintrag[] =
  NAVIGATION.filter((n) => n.gruppe);
