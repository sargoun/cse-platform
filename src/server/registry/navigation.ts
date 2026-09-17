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
  /** Das Icon aus dem geschlossenen Satz (DESIGN §5). */
  readonly icon: IconName;
}

export const NAVIGATION: readonly NaviEintrag[] = [
  { schluessel: 'dashboard', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', icon: 'uebersicht' },
  { schluessel: 'crm', label: 'CRM', pfad: 'crm', recht: 'crm.lesen', icon: 'crm' },
  { schluessel: 'objekte', label: 'Objekte', pfad: 'objekte', recht: 'objekt.lesen', icon: 'objekt' },
  /**
   * `dienstplan/woche`, nicht `dienstplan`.
   *
   * Den nackten Pfad gibt es nicht — die Seitenkarte kennt `woche`, `monat`,
   * `tag`, `serien`, `konflikte` und `einsatz/[id]`, aber keine Wurzel. Der
   * Eintrag zeigte darum auf einen 404, und zwar den einzigen im Portal, den
   * jeder Benutzer als erstes trifft: die Sidebar. Die Tab-Leiste zeigte
   * laengst auf `woche`; hier stand die zweite, falsche Fassung.
   */
  { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan/woche', recht: 'dienstplan.lesen', icon: 'dienstplan' },
  { schluessel: 'zeiten', label: 'Zeiten', pfad: 'zeiten', recht: 'zeit.lesen', icon: 'zeit' },
  // `personal/anstellungen`: den nackten Pfad kennt die Seitenkarte nicht.
  { schluessel: 'personal', label: 'Personal', pfad: 'personal/anstellungen', recht: 'personal.lesen', icon: 'personal' },
  { schluessel: 'angebote', label: 'Angebote', pfad: 'angebote', recht: 'angebot.lesen', icon: 'angebot' },
  { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', icon: 'auftrag' },
  // `finanzen/rechnungen`: die Rechnungen liegen unter `finanzen`, und `rechnungen`
  // allein gibt es als Route nicht — der Punkt fuehrte auf einen 404.
  { schluessel: 'rechnungen', label: 'Rechnungen', pfad: 'finanzen/rechnungen', recht: 'finanzen.lesen', icon: 'rechnung' },
  /**
   * `finanzen/zahlungen` — offene Forderungen, Guthaben und erfasste
   * Eingaenge (FIN-14). Eigenes Recht: wer Rechnungen schreiben darf, darf
   * nicht schon deswegen Zahlungseingaenge sehen, und umgekehrt.
   *
   * In der Gruppenansicht lesend sinnvoll: was die vier Gesellschaften
   * zusammen offen haben, ist genau die Frage, fuer die es sie gibt
   * (Invariante 10 — lesend, ohne Erfassungsformular).
   */
  { schluessel: 'zahlungen', label: 'Zahlungen', pfad: 'finanzen/zahlungen', recht: 'zahlung.lesen', icon: 'euro' },
  /**
   * `finanzen/eingangsrechnungen` — die Kreditorenseite (FIN-14, ACC-05).
   * Modul `eingang`: wer fakturiert, prueft nicht schon deswegen
   * Lieferantenrechnungen.
   */
  { schluessel: 'eingangsrechnungen', label: 'Eingangsrechnungen', pfad: 'finanzen/eingangsrechnungen', recht: 'eingang.lesen', icon: 'eingang' },
  /**
   * `finanzen/ausgangsbuch` — die Folge der ausgestellten Rechnungen (FIN-16).
   * Recht `nummernkreis.lesen` und nicht `finanzen.lesen`: das Buch ist die
   * Sicht auf den KREIS, und wer es liest, prueft die Lueckenlosigkeit.
   */
  { schluessel: 'ausgangsbuch', label: 'Ausgangsbuch', pfad: 'finanzen/ausgangsbuch', recht: 'nummernkreis.lesen', icon: 'buch' },
  /**
   * `finanzen/mahnungen` — die Mahnungen (FIN-15). Eigenes Recht
   * `mahnung.lesen`: eine Mahnung ist eine Aussage ueber die Zahlungsmoral
   * eines Kunden, und wer Rechnungen schreibt, sieht sie nicht schon deshalb.
   *
   * In der Gruppenansicht lesend: was die Gruppe zusammen anmahnt, ist eine
   * Leitungsfrage — ohne Freigabeknopf, denn dafuer braucht es genau einen
   * aktiven Mandanten (Invariante 10).
   */
  { schluessel: 'mahnungen', label: 'Mahnungen', pfad: 'finanzen/mahnungen', recht: 'mahnung.lesen', icon: 'warnung' },
  /**
   * `buchhaltung/buchungen` — das Hauptbuch mit seinen Belegen (ACC-01,
   * ACC-03).
   *
   * Eigenes Modulrecht `buchhaltung.lesen` und NICHT `finanzen.lesen`: wer
   * Rechnungen schreibt, sieht damit nicht schon die Kontierung des Hauses.
   * Die Trennung steht so im Rechtekatalog und ist der Grund, warum es zwei
   * Rechte gibt.
   *
   * `gruppe: false`: eine Buchungszeile gehoert genau einer Gesellschaft, und
   * eine Liste ueber alle vier waere keine Buchhaltung, sondern eine
   * Vermischung — auch lesend.
   */
  { schluessel: 'buchungen', label: 'Buchungen', pfad: 'buchhaltung/buchungen', recht: 'buchhaltung.lesen', icon: 'buch' },
  /**
   * `buchhaltung/datev` — die erzeugten Buchungsstapel (ACC-02).
   *
   * `buchhaltung.exportieren` und nicht `buchhaltung.lesen`: wer das
   * Hauptbuch liest, erzeugt damit noch keine Datei, die das Haus verlaesst.
   * Der Katalog trennt die beiden seit 0008 genau dafuer.
   */
  /**
   * `buchhaltung/bank` — die eingelesenen Kontoauszuege (ACC-04).
   *
   * `buchhaltung.lesen` als Eintrittsrecht, wie die Policy auf
   * `kontoauszug`: wer das Hauptbuch liest, sieht auch, was die Bank
   * gemeldet hat. Das EINLESEN verlangt zusaetzlich `zahlung.schreiben` —
   * es legt Zahlungen an —, und das prueft die Route, nicht der Menuepunkt.
   */
  { schluessel: 'bank', label: 'Bank', pfad: 'buchhaltung/bank', recht: 'buchhaltung.lesen', icon: 'bank' },
  { schluessel: 'datev', label: 'DATEV', pfad: 'buchhaltung/datev', recht: 'buchhaltung.exportieren', icon: 'export' },
  { schluessel: 'dokumente', label: 'Dokumente', pfad: 'dokumente', recht: 'dokument.lesen', icon: 'dokument' },
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
  { schluessel: 'agenten', label: 'Agenten', pfad: 'agenten', recht: 'agent.lesen', icon: 'ki' },
  /**
   * `freigaben` — der Posteingang der Freigaben (APR-01, PR 62).
   *
   * `gruppe: false`: die Gruppenansicht bekommt ihren eigenen Posteingang
   * (`/portal/gruppe/freigaben`, Phase 8), der in die Gesellschaft verweist —
   * entschieden wird nur mit genau einem aktiven Mandanten (Invariante 10).
   */
  { schluessel: 'freigaben', label: 'Freigaben', pfad: 'freigaben', recht: 'freigabe.lesen', icon: 'freigabe' },
  /**
   * `social` — das Social Media Center (SOC-01, PR 78).
   *
   * **Das Recht ist `social.lesen` — und das war es nicht immer.**
   *
   * Hier und in der Seitenkarte stand `social.schreiben`, mit der Begruendung,
   * beide muessten uebereinstimmen. Sie stimmten ueberein — nur mit der
   * falschen Seite: die SELECT-Policies in `0163` (`beitrag`, `social_kanal`,
   * `beitrag_kanal`) verlangen `social.lesen`. Ein Konto mit `schreiben` und
   * ohne `lesen` kam damit durch das Tor und sah ueberall leere Listen; ein
   * Konto mit `lesen` und ohne `schreiben` bekam 404 auf einen Bildschirm,
   * den es lesen darf. Heute halten `super_admin`, `admin` und `leitung`
   * beide Rechte, die Wirkung war also null — aber sie sind je Gesellschaft
   * einzeln entziehbar, und dann faellt es auf. Gemeldet hat es die
   * Copilot-Runde auf PR 16, mehrfach.
   *
   * Das Schreiben bleibt getrennt bewacht: `/social/posts/neu` verlangt
   * `lesen` UND `schreiben`, `/planung` `lesen` UND `planen`, `/kanaele`
   * `lesen` UND `kanal_verbinden`.
   *
   * **Hier stand einmal `gruppe: true`** mit der Begruendung, die
   * Gruppenansicht lese mit (`gruppe.social.lesen`). Die Policies in 0163
   * lassen das Lesen tatsaechlich zu — nur gibt es `/portal/gruppe/social`
   * nicht, und das Flag trug diesen Pfad trotzdem in die Gruppenliste. Die
   * Gruppenziele stehen jetzt ausdruecklich in `GRUPPEN_NAVIGATION`, und
   * social ist nicht darunter, solange die Seite fehlt.
   *
   * // TODO(client, O-372): Soll die Gruppenansicht eine lesende
   * Social-Uebersicht ueber alle vier Gesellschaften bekommen? Die Daten
   * lassen es zu; die Seitenkarte fuehrt sie in §6 nicht.
   */
  { schluessel: 'social', label: 'Social Media', pfad: 'social', recht: 'social.lesen', icon: 'social' },
  /**
   * `website` — die Pflege des oeffentlichen Auftritts (PUB-07, PRO-01 … PRO-05).
   *
   * **Dieser Punkt hat gefehlt, und die Seiten dahinter gab es trotzdem.**
   * `website/seiten`, `website/galerie` und `website/referenzen` waren gebaut,
   * arbeiteten und waren aus dem Portal heraus mit keinem einzigen Klick
   * erreichbar — man kam nur hin, indem man die Adresse eintippte. Gefunden
   * hat das ein Abgleich gegen die Auftragsbeschreibung, nicht eine Pruefung:
   * kein Test fragt „fuehrt irgendein Weg dorthin", und drei Bildschirme, die
   * niemand oeffnen kann, sind genauso gut nicht gebaut.
   *
   * **Das Recht ist `referenz.schreiben`** — das, was zwoelf der dreizehn
   * website-Routen im Manifest tragen. `website/formulare` verlangt
   * `formular.schreiben` und `website/profil` zusaetzlich
   * `system.identitaet_verwalten`; beide tragen ihr Recht selbst, und die
   * Sprungzeile zeigt nur, was diese Sitzung oeffnen darf (AUT-06, D-567).
   *
   * Der Punkt zeigt auf `website/seiten` und nicht auf `website`: eine
   * Modulwurzel gibt es nicht, und ein Menuepunkt auf eine Seite, die es nicht
   * gibt, ist der sichtbarste 404 im ganzen Portal.
   */
  { schluessel: 'website', label: 'Website', pfad: 'website/seiten', recht: 'referenz.schreiben', icon: 'dokument' },
  /**
   * `recruiting` — Stellen, Bewerbungen, Kandidaten (REC-01 … REC-09, PR 79).
   *
   * **Das Recht ist `recruiting.bewerbung_lesen`**, das schmalste der sieben:
   * die Uebersicht zeigt offene Stellen und eingegangene Bewerbungen, und wer
   * Bewerbungen lesen darf, soll dorthin finden. Die Unterseiten tragen ihr
   * eigenes Recht (`stelle_schreiben`, `bewerbung_bewerten`, `entscheiden`,
   * `daten_loeschen`), und die Sprungzeile in `recruiting/rahmen.tsx` zeigt nur,
   * was diese Sitzung oeffnen darf — ein Menuepunkt auf einen 404 verraet die
   * Existenz dessen, was er nicht zeigen darf (AUT-06, D-567).
   *
   * Das Icon ist `person` und nicht `personal`: `personal` ist die
   * Belegschaft, `recruiting` sind die, die es noch nicht sind. Ein eigenes
   * Bild gaebe der geschlossene Satz aus DESIGN §5 nicht her, und eines zu
   * zeichnen hiesse zuerst DESIGN.md zu aendern.
   *
   * **Nicht in `GRUPPEN_NAVIGATION`**, obwohl `gruppe.recruiting.lesen` im
   * Katalog steht: die Seitenkarte fuehrt in §6 keine
   * `/portal/gruppe/recruiting`, und ein Punkt auf eine Seite, die es nicht
   * gibt, ist genau der Fehler aus D-561.
   */
  { schluessel: 'recruiting', label: 'Recruiting', pfad: 'recruiting', recht: 'recruiting.bewerbung_lesen', icon: 'person' },
  /**
   * `bau/projekte`, nicht `bau`: die Seitenkarte fuehrt zwar beides, aber die
   * Modulübersicht ist eine Phase-5-Seite ohne Inhalt, solange Nachträge,
   * Behinderungen und Bautagebuch fehlen (PR 44/45). Der Punkt zeigt deshalb
   * dorthin, wo etwas steht — ein Menüpunkt auf eine leere Seite ist die
   * teuerste Art, eine Lücke zu zeigen.
   */
  { schluessel: 'bau', label: 'Bau', pfad: 'bau/projekte', recht: 'bau.lesen', icon: 'aufmass' },
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
  { schluessel: 'security', label: 'Security', pfad: 'security/posten', recht: 'security.lesen', icon: 'security' },
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
  { schluessel: 'reinigung', label: 'Reinigung', pfad: 'reinigung/reviere', recht: 'reinigung.lesen', icon: 'reinigung' },
  /**
   * Qualität steht NEBEN den Gewerken, nicht darin: eine Beanstandung über
   * einen Wachmann ist dieselbe Zeile wie eine über eine Reinigungsrunde
   * (04-SEITENKARTE.md §5.6). `warnung` als Icon, weil der Punkt im Alltag
   * genau dafür angeklickt wird — die offenen Fälle.
   */
  { schluessel: 'qualitaet', label: 'Qualität', pfad: 'qualitaet/reklamationen', recht: 'qualitaet.lesen', icon: 'qualitaet' },
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
  { schluessel: 'dienstanweisungen', label: 'Dienstanweisungen', pfad: 'security/dienstanweisungen', recht: 'dienstanweisung.lesen', icon: 'dokument' },
  { schluessel: 'schluessel', label: 'Schlüssel', pfad: 'security/schluessel', recht: 'schluessel.lesen', icon: 'schloss' },
  /**
   * **`system.mandant_lesen` und nicht `system.einstellung_lesen`.**
   *
   * Der Punkt stand auf `system.einstellung_lesen` — einem Recht, das nach
   * `0008` NUR die Super-Administration hält. Die Seite dahinter öffnet aber
   * mit `system.mandant_lesen` (Seitenkarte §5.24), und das halten auch
   * `admin` und `leitung`. Ergebnis: **eine Administration sah den Menüpunkt
   * „Einstellungen" nie** — nicht 404, nicht leer, sondern gar nicht —,
   * während der Bildschirm für sie offen stand und ihre Karten (Benutzer,
   * Unternehmensdaten, Protokoll, Module …) für sie gefüllt gewesen wären.
   * Der ganze Einstellungsbereich war für die Rolle unerreichbar, die ihn am
   * häufigsten braucht.
   *
   * **Und die Karten darunter bleiben einzeln bewacht.** Die Seite fragt je
   * Karte die Leserechte ihrer Route (`findeRoute`) und zeigt nur, was diese
   * Sitzung öffnen darf — `einstellungen/integrationen` etwa verlangt
   * weiterhin `system.einstellung_lesen`. Das Tor steht also nicht weiter
   * offen; es steht nur nicht mehr vor der falschen Tür.
   *
   * Gefunden hat das `tests/kern/navigation-rechte.test.ts`, als es alle
   * Menüpunkte gegen das Manifest hielt — derselbe Vergleich, der bei Social
   * (D-573) und Recruiting (D-574) je einen Befund brachte.
   */
  { schluessel: 'einstellungen', label: 'Einstellungen', pfad: 'einstellungen', recht: 'system.mandant_lesen', icon: 'einstellungen' },
] as const;

/** Die Punkte, die in der Gruppenansicht überhaupt erscheinen dürfen. */
/**
 * Die Gruppenansicht hat EIGENE Ziele — sie ist keine gefilterte Mandantensicht.
 *
 * **Der Befund, der diese Liste gebracht hat.** Hier stand
 * `NAVIGATION.filter((n) => n.gruppe)`: die MANDANTEN-Module mit ihren
 * Mandantenpfaden, ausgegeben unter `/portal/gruppe`. Von vierzehn so
 * entstandenen Zielen fuehrten elf auf 404 — `dienstplan/woche`, `zeiten`,
 * `personal/anstellungen`, `angebote`, `finanzen/rechnungen`, `bau/projekte`,
 * `reinigung/reviere`, `qualitaet/reklamationen`, `social` und zwei weitere
 * Finanzpfade gibt es unter `/portal/gruppe` nicht. §6 der Seitenkarte fuehrt
 * dort `dienstplan`, `auslastung`, `personen`, `rechnungen`, `projekte` —
 * andere Namen fuer verwandte Sachen, und das ist kein Zufall: eine
 * Gruppenseite fasst vier Gesellschaften zusammen und ist deshalb eine andere
 * Seite, nicht dieselbe mit mehr Zeilen.
 *
 * **Und die Rechte waren die falschen.** Die Gruppenrouten verlangen
 * `gruppe.objekt.lesen` und Geschwister (0004/0009), nicht `objekt.lesen`.
 * `PortalRahmen` hat das fuer die Sidebar schon abgeraeumt; diese Liste war
 * die letzte Stelle, an der die alte Ableitung weiterlebte — sichtbar in der
 * Entwurfsflaeche `/dev/portal` und im `Mehr`-Blatt, sobald eine
 * Gruppenleiste je eines bekaeme.
 *
 * **Jeder Eintrag hier hat eine Seite**, und `tests/kern/gruppen-navigation.test.ts`
 * haelt das fest: Registereintrag UND `page.tsx`. Ein Punkt, der auf 404
 * fuehrt, ist schlechter als keiner — er verraet die Existenz dessen, was er
 * nicht zeigen darf (AUT-06).
 *
 * `radar` und `kalender` stehen im Register und haben noch keine Seite; sie
 * fehlen deshalb hier, statt schon einmal verlinkt zu werden.
 */
export const GRUPPEN_NAVIGATION: readonly NaviEintrag[] = [
  { schluessel: 'uebersicht', label: 'Übersicht', pfad: '', recht: 'gruppe.bericht.lesen', icon: 'uebersicht' },
  { schluessel: 'finanzen', label: 'Finanzen', pfad: 'finanzen', recht: 'gruppe.finanzen.lesen', icon: 'euro' },
  { schluessel: 'rechnungen', label: 'Rechnungen', pfad: 'rechnungen', recht: 'gruppe.finanzen.lesen', icon: 'rechnung' },
  { schluessel: 'offene-posten', label: 'Offene Posten', pfad: 'offene-posten', recht: 'gruppe.buchhaltung.lesen', icon: 'buch' },
  { schluessel: 'kunden', label: 'Kunden', pfad: 'kunden', recht: 'gruppe.crm.lesen', icon: 'crm' },
  { schluessel: 'leads', label: 'Leads', pfad: 'leads', recht: 'gruppe.crm.lesen', icon: 'angebot' },
  { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'gruppe.auftrag.lesen', icon: 'auftrag' },
  { schluessel: 'projekte', label: 'Projekte', pfad: 'projekte', recht: 'gruppe.bau.lesen', icon: 'aufmass' },
  { schluessel: 'objekte', label: 'Objekte', pfad: 'objekte', recht: 'gruppe.objekt.lesen', icon: 'objekt' },
  { schluessel: 'personen', label: 'Personen', pfad: 'personen', recht: 'gruppe.personal.lesen', icon: 'personal' },
  { schluessel: 'dienstplan', label: 'Dienstplan', pfad: 'dienstplan', recht: 'gruppe.dienstplan.lesen', icon: 'dienstplan' },
  { schluessel: 'auslastung', label: 'Auslastung', pfad: 'auslastung', recht: 'gruppe.zeit.lesen', icon: 'zeit' },
  { schluessel: 'dokumente', label: 'Dokumente', pfad: 'dokumente', recht: 'gruppe.dokument.lesen', icon: 'dokument' },
  { schluessel: 'freigaben', label: 'Freigaben', pfad: 'freigaben', recht: 'gruppe.freigabe.lesen', icon: 'freigabe' },
  { schluessel: 'agenten', label: 'Agenten', pfad: 'agenten', recht: 'gruppe.agent.lesen', icon: 'ki' },
  { schluessel: 'berichte', label: 'Berichte', pfad: 'berichte', recht: 'gruppe.bericht.lesen', icon: 'uebersicht' },
  { schluessel: 'protokoll', label: 'Protokoll', pfad: 'protokoll', recht: 'gruppe.system.audit_lesen', icon: 'auge' },
];
