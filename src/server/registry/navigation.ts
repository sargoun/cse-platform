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
  /**
   * `finanzen/zahlungen` — offene Forderungen, Guthaben und erfasste
   * Eingaenge (FIN-14). Eigenes Recht: wer Rechnungen schreiben darf, darf
   * nicht schon deswegen Zahlungseingaenge sehen, und umgekehrt.
   *
   * In der Gruppenansicht lesend sinnvoll: was die vier Gesellschaften
   * zusammen offen haben, ist genau die Frage, fuer die es sie gibt
   * (Invariante 10 — lesend, ohne Erfassungsformular).
   */
  { schluessel: 'zahlungen', label: 'Zahlungen', pfad: 'finanzen/zahlungen', recht: 'zahlung.lesen', gruppe: true, icon: 'euro' },
  /**
   * `finanzen/eingangsrechnungen` — die Kreditorenseite (FIN-14, ACC-05).
   * Modul `eingang`: wer fakturiert, prueft nicht schon deswegen
   * Lieferantenrechnungen.
   */
  { schluessel: 'eingangsrechnungen', label: 'Eingangsrechnungen', pfad: 'finanzen/eingangsrechnungen', recht: 'eingang.lesen', gruppe: true, icon: 'rechnung' },
  /**
   * `finanzen/ausgangsbuch` — die Folge der ausgestellten Rechnungen (FIN-16).
   * Recht `nummernkreis.lesen` und nicht `finanzen.lesen`: das Buch ist die
   * Sicht auf den KREIS, und wer es liest, prueft die Lueckenlosigkeit.
   */
  { schluessel: 'ausgangsbuch', label: 'Ausgangsbuch', pfad: 'finanzen/ausgangsbuch', recht: 'nummernkreis.lesen', gruppe: true, icon: 'export' },
  /**
   * `finanzen/mahnungen` — die Mahnungen (FIN-15). Eigenes Recht
   * `mahnung.lesen`: eine Mahnung ist eine Aussage ueber die Zahlungsmoral
   * eines Kunden, und wer Rechnungen schreibt, sieht sie nicht schon deshalb.
   *
   * In der Gruppenansicht lesend: was die Gruppe zusammen anmahnt, ist eine
   * Leitungsfrage — ohne Freigabeknopf, denn dafuer braucht es genau einen
   * aktiven Mandanten (Invariante 10).
   */
  { schluessel: 'mahnungen', label: 'Mahnungen', pfad: 'finanzen/mahnungen', recht: 'mahnung.lesen', gruppe: true, icon: 'warnung' },
  { schluessel: 'dokumente', label: 'Dokumente', pfad: 'dokumente', recht: 'dokument.lesen', gruppe: true, icon: 'dokument' },
  /**
   * `agenten` — das Agenten-Zentrum (AGT-01, SPEC §22).
   *
   * `gruppe: false`, obwohl die Seitenkarte `/portal/gruppe/agenten` fuehrt:
   * die Gruppenseite ist eine ANDERE Seite mit einem anderen Recht
   * (`gruppe.agent.lesen`) und einer Auswertung ueber Gesellschaften hinweg.
   * Sie kommt, wenn sie gebaut ist; bis dahin zeigte der Punkt in der
   * Gruppenansicht auf einen 404 — derselbe Befund wie damals bei
   * `dienstplan`.
   */
  { schluessel: 'agenten', label: 'Agenten', pfad: 'agenten', recht: 'agent.lesen', gruppe: false, icon: 'ki' },
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
  /**
   * PR 42 — die beiden Security-Register bekommen eigene Punkte.
   *
   * Nicht weil das Modul zwei Sidebar-Zeilen braucht, sondern weil der eine
   * `security`-Punkt auf `security/posten` zeigt und dort nichts steht, was
   * zu den Dienstanweisungen oder zum Schluesselbestand fuehrt. Ein Register,
   * das nur ueber die Adresszeile erreichbar ist, ist eines, das niemand
   * pflegt — und ein ungepflegter Schluesselbestand beantwortet die Frage
   * „wer hatte Zutritt" nicht.
   *
   * `gruppe: false` fuer beide: `da_kenntnisnahme` traegt bewusst KEINE
   * Gruppenpolicy (0078 §12), und §1.7 schliesst das Gruppenlesen fuer
   * `schluessel` ausdruecklich aus. Ein Punkt, der in der Gruppenansicht auf
   * eine leere Seite fuehrt, ist schlechter als keiner.
   *
   * Die Icons kommen aus dem geschlossenen Satz (DESIGN §5): `dokument` fuer
   * die Anweisung, die gelesen und bestaetigt wird, `schloss` fuer den
   * Schluessel. Ein eigenes zu zeichnen hiesse zuerst DESIGN.md zu aendern.
   */
  { schluessel: 'dienstanweisungen', label: 'Dienstanweisungen', pfad: 'security/dienstanweisungen', recht: 'dienstanweisung.lesen', gruppe: false, icon: 'dokument' },
  { schluessel: 'schluessel', label: 'Schlüssel', pfad: 'security/schluessel', recht: 'schluessel.lesen', gruppe: false, icon: 'schloss' },
  { schluessel: 'einstellungen', label: 'Einstellungen', pfad: 'einstellungen', recht: 'system.einstellung_lesen', gruppe: false, icon: 'einstellungen' },
] as const;

/** Die Punkte, die in der Gruppenansicht überhaupt erscheinen dürfen. */
export const GRUPPEN_NAVIGATION: readonly NaviEintrag[] =
  NAVIGATION.filter((n) => n.gruppe);
