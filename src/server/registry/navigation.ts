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
  /**
   * `dienstplan/woche`, nicht `dienstplan`.
   *
   * Den nackten Pfad gibt es nicht — die Seitenkarte kennt `woche`, `monat`,
   * `tag`, `serien`, `konflikte` und `einsatz/[id]`, aber keine Wurzel. Der
   * Eintrag zeigte darum auf einen 404, und zwar den einzigen im Portal, den
   * jeder Benutzer als erstes trifft: die Sidebar. Die Tab-Leiste zeigte
   * laengst auf `woche`; hier stand die zweite, falsche Fassung.
   */
  { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan/woche', recht: 'dienstplan.lesen', gruppe: true, icon: 'dienstplan' },
  { schluessel: 'zeiten', label: 'Zeiten', pfad: 'zeiten', recht: 'zeit.lesen', gruppe: true, icon: 'zeit' },
  // `personal/anstellungen`: den nackten Pfad kennt die Seitenkarte nicht.
  { schluessel: 'personal', label: 'Personal', pfad: 'personal/anstellungen', recht: 'personal.lesen', gruppe: true, icon: 'personal' },
  { schluessel: 'angebote', label: 'Angebote', pfad: 'angebote', recht: 'angebot.lesen', gruppe: true, icon: 'angebot' },
  { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', gruppe: true, icon: 'auftrag' },
  // `finanzen/rechnungen`: die Rechnungen liegen unter `finanzen`, und `rechnungen`
  // allein gibt es als Route nicht — der Punkt fuehrte auf einen 404.
  { schluessel: 'rechnungen', label: 'Rechnungen', pfad: 'finanzen/rechnungen', recht: 'finanzen.lesen', gruppe: true, icon: 'rechnung' },
  { schluessel: 'dokumente', label: 'Dokumente', pfad: 'dokumente', recht: 'dokument.lesen', gruppe: true, icon: 'dokument' },
  /**
   * `bau/projekte`, nicht `bau`: die Seitenkarte fuehrt zwar beides, aber die
   * Modulübersicht ist eine Phase-5-Seite ohne Inhalt, solange Nachträge,
   * Behinderungen und Bautagebuch fehlen (PR 44/45). Der Punkt zeigt deshalb
   * dorthin, wo etwas steht — ein Menüpunkt auf eine leere Seite ist die
   * teuerste Art, eine Lücke zu zeigen.
   */
  { schluessel: 'bau', label: 'Bau', pfad: 'bau/projekte', recht: 'bau.lesen', gruppe: true, icon: 'aufmass' },
  /**
   * `security/posten`, nicht `security`: die Modulübersicht der Seitenkarte
   * (§5.8, Zeile 1) ist noch nicht gebaut, und ein Menüpunkt auf eine Seite,
   * die es nicht gibt, ist der sichtbarste 404 im ganzen Portal.
   *
   * `gruppe: false` — und das ist eine Entscheidung, keine Auslassung. Posten
   * tragen zwar eine Gruppenlesepolicy (`gruppe.security.lesen`), aber der
   * Punkt führte in der Gruppenansicht auf `/portal/gruppe/security/posten`,
   * und diese Seite gibt es nicht. Das Wachbuch hat ohnehin KEINEN
   * Gruppenlesepfad (§1.7): eine Gruppenleitung liest keine
   * Vorkommnismeldungen einer anderen Gesellschaft.
   */
  { schluessel: 'security', label: 'Security', pfad: 'security/posten', recht: 'security.lesen', gruppe: false, icon: 'schloss' },
  /**
   * `reinigung/reviere`, nicht `reinigung`: die Modulübersicht steht zwar in
   * der Seitenkarte, hat aber erst mit dem Turnus-Gesundheitsblatt einen
   * Inhalt (PR 42). Der Punkt zeigt dorthin, wo etwas steht — ein Menüpunkt
   * auf eine leere Seite ist die teuerste Art, eine Lücke zu zeigen.
   *
   * Das Icon ist `objekt` und nicht ein eigenes: der geschlossene Satz aus
   * DESIGN §5 führt keines für die Reinigung, und ein neues zu zeichnen hiesse
   * zuerst DESIGN.md zu ändern. Ein Revier IST eine Zone in einem Gebäude,
   * also ist das Gebäude das nächstliegende Bild.
   */
  { schluessel: 'reinigung', label: 'Reinigung', pfad: 'reinigung/reviere', recht: 'reinigung.lesen', gruppe: true, icon: 'objekt' },
  /**
   * Qualität steht NEBEN den Gewerken, nicht darin: eine Beanstandung über
   * einen Wachmann ist dieselbe Zeile wie eine über eine Reinigungsrunde
   * (04-SEITENKARTE.md §5.6). `warnung` als Icon, weil der Punkt im Alltag
   * genau dafür angeklickt wird — die offenen Fälle.
   */
  { schluessel: 'qualitaet', label: 'Qualität', pfad: 'qualitaet/reklamationen', recht: 'qualitaet.lesen', gruppe: true, icon: 'warnung' },
  { schluessel: 'einstellungen', label: 'Einstellungen', pfad: 'einstellungen', recht: 'system.einstellung_lesen', gruppe: false, icon: 'einstellungen' },
] as const;

/** Die Punkte, die in der Gruppenansicht überhaupt erscheinen dürfen. */
export const GRUPPEN_NAVIGATION: readonly NaviEintrag[] =
  NAVIGATION.filter((n) => n.gruppe);
