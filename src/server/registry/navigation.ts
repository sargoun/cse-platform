/**
 * Das Navigationsregister — die Sidebar aus einer Liste, nicht aus JSX.
 *
 * Ein Eintrag nennt sein Recht. Was der Benutzer nicht darf, erscheint gar
 * nicht: ein Menüpunkt, der auf einen 404 führt, ist schlechter als keiner,
 * weil er die Existenz dessen verrät, was er nicht zeigen darf (AUT-06).
 *
 * **Es gibt DREI Listen, nicht eine mit Schaltern.** `NAVIGATION` ist die
 * Mandantensicht, `GRUPPEN_NAVIGATION` die Gruppensicht, `KUNDEN_NAVIGATION`
 * das Kundenportal. Hier stand einmal ein Feld `gruppe: boolean`, aus dem die
 * Gruppenliste gefiltert wurde — eine Gruppenseite fasst aber vier
 * Gesellschaften zusammen und ist deshalb eine ANDERE Seite mit einem anderen
 * Recht, nicht dieselbe mit mehr Zeilen (D-561). Das Feld ist weg; einzelne
 * Kommentare unten nennen es noch, weil sie die damalige Entscheidung
 * festhalten.
 */
import type { IconName } from '@/lib/design/icons';

export interface NaviEintrag {
  readonly schluessel: string;
  /** Deutsches Label. Die Sidebar ist intern; Arbeiterportale übersetzen. */
  readonly label: string;
  readonly pfad: string;
  /** Der Rechteschlüssel, ohne den der Punkt nicht erscheint. */
  readonly recht: string;
  /**
   * Ein ZWEITER Rechteschluessel, wenn die Zielroute zwei Leserechte fuehrt.
   *
   * `pruefeZugang` verknuepft die Leserechte einer Route mit UND. Ein
   * Menuepunkt, der nur eines prueft, ist der 404 aus AUT-06 mit Ansage.
   */
  readonly zusatzRecht?: string;
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
  /**
   * `leistungskatalog` (OPS-06, CLN-05) — er fehlte, und ohne diesen Eintrag
   * waeren beide Katalogseiten gebaut und aus keinem Menue erreichbar.
   *
   * Recht `katalog.lesen` und nicht `katalog.schreiben`: eine Leitung darf den
   * Katalog SEHEN (Preise, Zeitwerte, Platzhalteranteil) und nicht aendern —
   * `katalog.schreiben` halten nur `admin` und `super_admin`. Ein Punkt am
   * Schreibrecht haette der Leitung die Seite verborgen, die sie im
   * Preisgespraech braucht.
   *
   * Er steht direkt nach `angebote`: der Katalog ist die Quelle, aus der
   * Angebotszeilen entstehen. KEIN Eintrag in `GRUPPEN_NAVIGATION` — der
   * Katalog ist je Gesellschaft geschnitten (`leistungskatalog_aktiv_uk` ist
   * unique auf `(mandant_id, schluessel)`), und eine Gruppenansicht darueber
   * waere eine Liste aus vier Katalogen, die einander nicht entsprechen.
   */
  { schluessel: 'leistungskatalog', label: 'Leistungskatalog', pfad: 'leistungskatalog', recht: 'katalog.lesen', icon: 'buch' },
  { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', icon: 'auftrag' },
  /**
   * `aufgaben` — die offene Pflicht (OPS-11, DSH-01, SPEC §14).
   *
   * **Ohne diesen Punkt waere die Liste aus dem Portal heraus mit keinem Klick
   * erreichbar** — man kaeme nur hin, indem man die Adresse eintippt.
   *
   * Das Recht ist `aufgabe.lesen`, dasselbe, das die Route im Manifest traegt.
   * Das Icon ist `ok` aus dem geschlossenen Satz (DESIGN §5).
   *
   * **Nicht in `GRUPPEN_NAVIGATION`**, obwohl `gruppe.aufgabe.lesen` im
   * Katalog steht und `t_aufgabe_gruppe` (0230) es freigibt: die Seitenkarte
   * fuehrt in §6 keine `/portal/gruppe/aufgaben`, und ein Punkt auf eine
   * Seite, die es nicht gibt, ist der Fehler aus D-561.
   */
  { schluessel: 'aufgaben', label: 'Aufgaben', pfad: 'aufgaben', recht: 'aufgabe.lesen', icon: 'ok' },
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
   * `nachrichten` — der Fadenposteingang (EMP-11, CRM-03, SEITENKARTE §5.17).
   *
   * **Nicht zu verwechseln mit `/portal/mein/nachrichten`**: das ist der
   * Meldungs-Posteingang ueber `benachrichtigung` (NOT-01) an der
   * Arbeiterleiste. Hier geht es um `nachricht` — den Schriftverkehr in einem
   * Vorgang.
   *
   * **Nicht in `GRUPPEN_NAVIGATION`.** `gruppe.nachricht.lesen` steht im
   * Katalog und `t_nachricht_gruppe` (0011) gibt es frei — aber
   * `06-RADAR-KI-INHALT.md` §1.4 verlangt fuer `nachricht` das Gegenteil, und
   * die Seitenkarte fuehrt keine `/portal/gruppe/nachrichten`. Der Widerspruch
   * ist gemeldet und nicht entschieden: O-651.
   */
  { schluessel: 'nachrichten', label: 'Nachrichten', pfad: 'nachrichten', recht: 'nachricht.lesen', icon: 'mail' },
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
   * **Das Recht ist `referenz.schreiben`** — das, was ZEHN der dreizehn
   * website-Routen im Manifest tragen (profil, seiten, seiten/[id],
   * leistungen, leistungen/[id], referenzen, referenzen/[id], news, news/[id],
   * galerie). Die drei anderen tragen ihr eigenes:
   * `website/formulare` und `website/formulare/[id]` verlangen
   * `formular.schreiben`, `website/referenzen/[id]/veroeffentlichen` verlangt
   * `referenz.veroeffentlichen`. Jede traegt ihr Recht selbst, und die
   * Sprungzeile in `app/portal/[mandant]/website/spruenge.tsx` zeigt nur, was
   * diese Sitzung oeffnen darf (AUT-06, D-567) — sie liest die Bedingung dort,
   * wo die Route sie auch wirklich prueft, statt sie abzuschreiben.
   *
   * **`profil` ist unter den zehn der Sonderfall:** die Route fuehrt ZWEI
   * Leserechte, `referenz.schreiben` UND `system.identitaet_verwalten`, und
   * `pruefeZugang` verknuepft sie mit UND. Das zweite haelt nur
   * `super_admin` — fuer `admin` und `leitung` ist das Unternehmensprofil
   * damit ein 404, und die Sprungzeile blendet es (richtigerweise) aus. Der
   * Menuepunkt trifft das nicht, weil er auf `website/seiten` zeigt; dass die
   * Seite nur Texte je Sprachfassung pflegt und das Recht deshalb an den noch
   * fehlenden Bildupload gehoert (O-13), ist eine Aenderung der Seitenkarte
   * und steht dort in der Warteschlange — nicht hier.
   *
   * **Was dieser Punkt nicht leisten kann:** `leitung` haelt
   * `referenz.schreiben` nur, wo eine Gesellschaft es ihr bindet, und sieht
   * den Tab sonst gar nicht — auch nicht die Neuigkeitenansicht, obwohl sie
   * dieselben Beitraege unter Social Media pflegt. Das ist eine Entscheidung
   * ueber die Rollenmatrix und steht als O-683 im Register.
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
   * `bau`, nicht mehr `bau/projekte`: die Modulübersicht der Seitenkarte
   * (§5.9, Zeile 1) ist gebaut und trägt die drei Punkte, auf die sie zeigt —
   * offene Nachträge (BAU-04), laufende Behinderungen (BAU-06) und den Stand
   * des Bautagebuchs (BAU-07). Der Punkt zeigte bewusst auf die Projektliste,
   * solange die Übersicht leer gewesen wäre; jetzt wäre der Umweg die Lücke.
   */
  { schluessel: 'bau', label: 'Bau', pfad: 'bau', recht: 'bau.lesen', icon: 'aufmass' },
  /**
   * `security`, nicht mehr `security/posten`: die Modulübersicht (§5.8,
   * Zeile 1) ist gebaut. Sie trägt drei Kacheln — unterbesetzte Posten,
   * abgelaufene oder ablaufende Nachweise und die Vorkommnisse der letzten
   * sieben Tage — und darunter die Wege ins Modul (Posten, Wachbuch,
   * Veranstaltungen, Dienstanweisungen, Schlüssel, Bewacherregister), jeder
   * unter dem Recht SEINES Ziels. Der Punkt zeigte bewusst auf die
   * Postenliste, solange die Übersicht nicht gebaut war; jetzt wäre der
   * Umweg die Lücke.
   *
   * **Die mittlere Kachel heisst „Nachweise abgelaufen oder ablaufend" und
   * ist NICHT auf § 34a GewO eingegrenzt** — sie zählt alle Qualifikationen
   * mit Frist (O-706). Hier stand „§ 34a-Nachweise" und beschrieb damit eine
   * engere Zahl, als die Seite zeigt.
   *
   * Kein Eintrag in `GRUPPEN_NAVIGATION`: `/portal/gruppe/security` gibt es
   * nicht, und das Wachbuch hat ohnehin KEINEN Gruppenlesepfad (§1.7) — eine
   * Gruppenleitung liest keine Vorkommnismeldungen einer anderen
   * Gesellschaft.
   */
  { schluessel: 'security', label: 'Security', pfad: 'security', recht: 'security.lesen', icon: 'security' },
  /**
   * `reinigung`, nicht mehr `reinigung/reviere`: die Modulübersicht (§5.7,
   * Zeile 1) ist gebaut und hat einen Inhalt — Reviere, Schichten heute,
   * offene Nachweise und das Gesundheitsblatt des Turnus („Generator steht",
   * PR 42). Der Punkt zeigte bewusst auf die Revierliste, solange die
   * Übersicht leer gewesen wäre; jetzt wäre der Umweg die Lücke.
   *
   * Das Icon ist `reinigung` aus dem geschlossenen Satz (DESIGN §5). Hier
   * stand einmal `objekt` mit der Begründung, ein Revier SEI eine Zone in
   * einem Gebäude — der Satz führt seit DESIGN §5 ein eigenes Bild, und der
   * Eintrag benutzte es längst.
   */
  { schluessel: 'reinigung', label: 'Reinigung', pfad: 'reinigung', recht: 'reinigung.lesen', icon: 'reinigung' },
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
   * Nicht weil das Modul zwei Sidebar-Zeilen braucht, sondern weil ein
   * Register, das nur ueber die Adresszeile erreichbar ist, eines ist, das
   * niemand pflegt — und ein ungepflegter Schluesselbestand beantwortet die
   * Frage „wer hatte Zutritt" nicht.
   *
   * **Die zweite Haelfte der urspruenglichen Begruendung ist ueberholt.** Sie
   * lautete: der `security`-Punkt zeige auf `security/posten`, und dort stehe
   * nichts, was zu den Dienstanweisungen oder zum Schluesselbestand fuehre.
   * Seit der Punkt auf die Moduluebersicht zeigt, fuehren von dort Wege zu
   * beiden — jeder unter dem Recht SEINES Ziels. Die zwei Sidebar-Punkte sind
   * damit der ZWEITE Weg. Sie bleiben, weil eine Umstellung nichts entfernt,
   * was funktioniert; ob die Sidebar beide auf Dauer fuehrt, entscheidet die
   * Gestaltung und nicht dieses Register.
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
 * **`radar` und `kalender` stehen jetzt darin.** Hier stand, sie haetten noch
 * keine Seite und fehlten deshalb; beide sind inzwischen gebaut
 * (`src/app/portal/gruppe/radar/page.tsx`, `…/kalender/page.tsx`), fuehren
 * eine Manifestzeile mit ihrem Gruppenrecht und tragen damit durch
 * `tests/kern/gruppen-navigation.test.ts` — der Test verlangt Registereintrag
 * UND `page.tsx`.
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
  /**
   * `radar` — die Vergabepipeline ueber alle vier Gesellschaften (RAD-07,
   * REP-06).
   *
   * `radar` steht seit laengerem in der GRUPPENLEISTE (`tableiste.ts`) und
   * fuehrte bis zur gebauten Seite auf die Auffangseite — D-549 nennt genau
   * diesen Fall. Der Tab traegt jetzt; dieser Punkt ist der zweite Weg, und
   * er ist der, ueber den man die Seite auch am Rechner findet.
   *
   * **Die Seite fasst zusammen, sie bewertet nicht.** Jede Punktzahl stammt
   * aus dem Suchprofil GENAU EINER Gesellschaft; es gibt keinen Mittelwert
   * und keine Gruppenrangfolge. Was zwei Gesellschaften tun sollen, die
   * dieselbe Bekanntmachung hoch bewerten, ist eine Regel des Hauses und
   * vergaberechtlich nicht gleichgueltig (§ 124 GWB) — die Seite zaehlt
   * „Mehrfach im Blick", markiert die Zeile und schlaegt nichts vor (O-870).
   */
  { schluessel: 'radar', label: 'Radar', pfad: 'radar', recht: 'gruppe.radar.lesen', icon: 'ausschreibung' },
  { schluessel: 'dokumente', label: 'Dokumente', pfad: 'dokumente', recht: 'gruppe.dokument.lesen', icon: 'dokument' },
  /**
   * `kalender` — der zusammengefuehrte Kalender ueber sechs Quellen (CAL-01,
   * CAL-02): Termin, Einsatz, Projekt, Vergabe, Freigabe, Lead.
   *
   * **Ohne Personenbezug in der Voreinstellung.** Eine Schicht steht dort
   * ohne die Menschen, die sie besetzen, und die Bewerberquellen sind gar
   * nicht erst angeschlossen; `p_gruppe_kein_personenbezug` (0370) haelt die
   * zweite Linie, nachdem `t_bewerbung_gruppe` (0166) die Bewerberzeilen der
   * Schwestergesellschaften bis dahin herausgab. Der Personenfilter ist ein
   * ausdruecklicher Suchweg und erscheint nur mit `gruppe.personal.lesen`;
   * ob er ein eigenes Recht braucht, ist offen (O-872).
   *
   * Der Teamfilter greift heute nur auf Schichten, weil `kalender_eintrag`
   * kein `team_id` traegt — die Seite sagt das (O-871).
   */
  { schluessel: 'kalender', label: 'Kalender', pfad: 'kalender', recht: 'gruppe.kalender.lesen', icon: 'kalender' },
  { schluessel: 'freigaben', label: 'Freigaben', pfad: 'freigaben', recht: 'gruppe.freigabe.lesen', icon: 'freigabe' },
  { schluessel: 'agenten', label: 'Agenten', pfad: 'agenten', recht: 'gruppe.agent.lesen', icon: 'ki' },
  { schluessel: 'berichte', label: 'Berichte', pfad: 'berichte', recht: 'gruppe.bericht.lesen', icon: 'uebersicht' },
  { schluessel: 'protokoll', label: 'Protokoll', pfad: 'protokoll', recht: 'gruppe.system.audit_lesen', icon: 'auge' },
];

/**
 * Der Navigationsbaum des KUNDENPORTALS — das, was hinter `Mehr` steht.
 *
 * **Warum es ihn braucht.** Die Kundenleiste fuehrt fuenf Ziele; gebaut sind
 * inzwischen ZEHN Listen samt Blaettern (19 Adressen). `angebote`, `objekte`,
 * `projekte`, `zahlungen`, `dokumente` und `reklamationen` sind damit gebaut
 * und aus KEINER Leiste erreichbar — die Sprungkarten der Uebersicht
 * (seit dem Kundenportal-Stapel zehn statt sechs) reichen einen Schritt weit,
 * und von `/portal/kunde/rechnungen/[id]` kommt man ohne Adresszeile gar
 * nicht zu den Zahlungen.
 *
 * **`recht` ist EIN Schluessel, zwei Routen verlangen zwei.**
 * `/portal/kunde/rechnungen` fuehrt im Manifest
 * `["finanzen.lesen","finanzen.herunterladen"]`, `/portal/kunde/nachweise`
 * fuehrt `["nachweis.lesen","bau.lesen"]`, und `pruefeZugang` verknuepft sie
 * mit UND. Ein Punkt, der nur das erste prueft, fuehrte auf 404 und verriete
 * die Existenz dessen, was er nicht zeigen darf (AUT-06, D-581). Deshalb das
 * optionale `zusatzRecht` oben — und nicht, weil ein zweites Feld huebscher
 * waere.
 *
 * **`angebote`, `objekte` und `dokumente` stehen jetzt darin.** Hier stand,
 * sie gehoerten anderen Stapeln und seien heute Platzhalter (`[...rest]`) —
 * das stimmt seit dem Kundenportal-Stapel nicht mehr: alle drei Listen und
 * ihre Blaetter sind gebaut. Jede der drei Routen fuehrt im Manifest GENAU
 * EIN Leserecht (`angebot.lesen`, `objekt.lesen`, `dokument.lesen`), sie
 * brauchen also kein `zusatzRecht` — anders als `rechnungen` und `nachweise`.
 *
 * **`dokumente` traegt eine Besonderheit, die kein Registerfeld abbildet:**
 * `dokument` hat im Kunden-Scope keine permissive Policy (zwei restriktive
 * Decken, 0009 und 0297, und `t_mandant` greift nicht, weil
 * `app.aktiver_mandant()` dort NULL ist) — die Liste kommt heute leer
 * zurueck, bis O-671 beantwortet ist. Das ist kein Grund, den Punkt
 * wegzulassen: Recht und Route stimmen, die Seite ist vollstaendig gebaut,
 * und ihr Leertext sagt ausdruecklich, dass sie NICHT leer ist, weil keine
 * Unterlagen vorliegen (K-18).
 *
 * `auftraege` steht darin, weil es schon in der Tableiste steht — der Punkt
 * wird also nicht schlechter, er wandert nur.
 *
 * **Dieser Baum wird heute von NICHTS gerendert, und das ist Absicht.** Das
 * Blatt hinter `Mehr` (`components/portal/TabLeiste.tsx`), die Schiene
 * (`components/portal/PortalRahmen.tsx`) und die Rechtekarte
 * (`app/portal/zugang.ts`) kennen genau zwei Baeume; sie muessen den dritten
 * erst lesen lernen. Bis dahin traegt die Kundenleiste KEIN `Mehr` — ein
 * `Mehr`, das den INTERNEN Baum unter `/portal/kunde` ausgibt, waere ein
 * Blatt voller 404 und verriete die Existenz dessen, was es nicht zeigen
 * darf (AUT-06). Die drei Aenderungen gehoeren zusammen eingespielt.
 */
export const KUNDEN_NAVIGATION: readonly NaviEintrag[] = [
  { schluessel: 'uebersicht', label: 'Übersicht', pfad: '', recht: 'bericht.dashboard_lesen', icon: 'uebersicht' },
  { schluessel: 'auftraege', label: 'Aufträge', pfad: 'auftraege', recht: 'auftrag.lesen', icon: 'auftrag' },
  /**
   * `angebote` (OPS-08, OPS-09) — nur VERSENDETE, nie ein Entwurf; das
   * schneidet die Policy, nicht die Seite.
   *
   * Annehmen und Ablehnen gibt es im Portal nicht (O-74): statt eines
   * ausgegrauten Knopfes steht der offene Punkt als Satz auf Liste und Blatt.
   */
  { schluessel: 'angebote', label: 'Angebote', pfad: 'angebote', recht: 'angebot.lesen', icon: 'angebot' },
  /**
   * `objekte` (OPS-01, OPS-02) — die eigenen Liegenschaften mit lesendem
   * Raumbuch. `objekt.kunde_id` ist nullbar, ein Veranstaltungsort ohne
   * Kundenstamm faellt also heraus; Belagsart und Reinigungsklasse fehlen
   * ganz, weil sie im Kunden-Scope null Zeilen liefern und ein „—" je Raum
   * sich wie „nicht erfasst" laese.
   */
  { schluessel: 'objekte', label: 'Objekte', pfad: 'objekte', recht: 'objekt.lesen', icon: 'objekt' },
  { schluessel: 'projekte', label: 'Bauprojekte', pfad: 'projekte', recht: 'bau.lesen', icon: 'aufmass' },
  { schluessel: 'rechnungen', label: 'Rechnungen', pfad: 'rechnungen', recht: 'finanzen.lesen', zusatzRecht: 'finanzen.herunterladen', icon: 'rechnung' },
  { schluessel: 'zahlungen', label: 'Zahlungen', pfad: 'zahlungen', recht: 'zahlung.lesen', icon: 'euro' },
  { schluessel: 'nachweise', label: 'Nachweise', pfad: 'nachweise', recht: 'nachweis.lesen', zusatzRecht: 'bau.lesen', icon: 'dokument' },
  { schluessel: 'reklamationen', label: 'Reklamationen', pfad: 'reklamationen', recht: 'qualitaet.lesen', icon: 'qualitaet' },
  /**
   * `dokumente` (DOC-01, DOC-03, DOC-04) — gebaut, und heute leer: `dokument`
   * traegt im Kunden-Scope keine permissive Policy (O-671). Der Punkt steht
   * trotzdem, weil Recht und Route stimmen und die Seite selbst sagt, warum
   * nichts dasteht. Ein Abrufweg fehlt zusaetzlich aus einem zweiten Grund:
   * die von DOC-03/SEC-A6 verlangte Abrufspur ist aus dem Kunden-Scope nicht
   * schreibbar (O-843) — beides gehoert in DIESELBE Migration.
   */
  { schluessel: 'dokumente', label: 'Dokumente', pfad: 'dokumente', recht: 'dokument.lesen', icon: 'dokument' },
  { schluessel: 'nachrichten', label: 'Nachrichten', pfad: 'nachrichten', recht: 'nachricht.lesen', icon: 'mail' },
];

