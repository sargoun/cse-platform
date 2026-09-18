# Registereintraege: aufgaben-nachrichten-oeffentlich

Diese Eintraege hat der bauende Agent geliefert; sie sind **noch nicht** eingefuegt.
Die gemeinsamen Dateien pflegt EINE Hand, weil acht Agenten gleichzeitig im Baum
arbeiten und sich sonst in dieselbe Zeile schreiben. Ist ein Eintrag eingefuegt,
verschwindet er hier — diese Datei ist eine Warteschlange, kein Archiv.

## Migrationen (alle gegen eine eigene Datenbank gefahren: True)

- drizzle/0230_kern_team_aufgabe.sql — Enums aufgabe_status, prioritaet, bezug_typ; Tabellen team, team_mitglied, aufgabe; Indizes inkl. aufgabe_job_uk UNIQUE NULLS NOT DISTINCT; RLS (t_*_lesen/schreiben/gruppe/eigene, restriktiv p_zustaendig, p_aufgabe_kunde_decke, p_tm_ma_decke, p_*_kunde_decke, t_job_*); Loeschsperre fuer team und aufgabe im erzeugten Block
- drizzle/0231_nachricht_faden.sql — Enums nachricht_richtung, nachricht_kanal, nachricht_empfaenger_typ, empfaenger_art, zustell_status; nachricht additiv auf die §7.9-Form (thread_id, antwortet_auf_id, richtung, kanal, akteur_art, absender_agent_id/extern, bezug_typ/bezug_id, rechtsgrundlage(+kontakt_id), zweck, freigabe_id, zustell_status/zustell_fehler, geschlossen_am/von, S2/S3/S4) plus Umbenennung absender_id->absender_benutzer_id und text->koerper; nachricht_empfaenger polymorph (person_id entfaellt samt Policy); nachricht_anhang neu; kern.nachricht_thread_wurzel (Definer, cse_definer, Spalten-Grant auf drei Spalten), kern.setze_thread_id, kern.nachricht_sendetor; die vier CHECKs; RLS inkl. restriktivem p_beteiligt je Empfaengerart; Loeschsperre fuer nachricht, nachricht_empfaenger, nachricht_anhang im erzeugten Block

## Gebaute Routen

- `/portal/[mandant]/aufgaben` — fertig — Liste nach FRIST sortiert, offene zuerst (wie der Lead-Posteingang). Filter: nur meine / nur offene / je Bezugsart / auch erledigte. Kopfzeile zaehlt offene und ueberfaellige. Anlegeformular (Titel, Beschreibung, Prioritaet, Faelligkeitstag). Bezug als Link auf Auftrag, Objekt oder Lead — und nur dann, wenn RLS die Zeile hergibt (sonst Art ohne Verweis, AUT-06). Herkunft je Zeile: mensch/Waechter plus quelle_job. Leerzustand als Hinweis, nicht als leere Tabelle.
- `/portal/[mandant]/aufgaben/[id]` — fertig — Kopf mit Status-Pille, Ueberfaellig-Pille, Frist (UTC gespeichert, Europe/Berlin gezeigt), Prioritaet, Zustaendige(r)/Team, aufgeloester Bezug. Abschnitt Herkunft mit quelle/quelle_job/job_lauf_id und Erledigungs- bzw. Abbruchbeleg. Aktionen als POST an /api/aufgaben: Status setzen, zuweisen (nur mit aufgabe.zuweisen, sonst sichtbarer Hinweis statt Formular), erledigen (now() + Sitzungsbenutzer serverseitig), abbrechen mit Pflichtgrund. Unbekannte oder fremde id: 404, nie 403.
- `/portal/[mandant]/nachrichten` — fertig — Fadenposteingang: EIN Kopf je thread_id mit Betreff der Wurzel, Auszug, letzter Absender, Richtung/Kanal/Zustellstand, Zeilenzahl, letzte Aktivitaet und eigener Ungelesen-Zahl. Filter: Richtung, nur ungelesen. Formular fuer einen neuen INTERNEN Faden. Oben steht der wahre Anbindungsstand aus registry/integrationen (E-Mail und SMS nicht verbunden, O-36) — kein simulierter Versand.
- `/portal/[mandant]/nachrichten/[id]` — fertig — [id] IST die thread_id (festgelegt, nicht offen). Faden in Zeitfolge mit Absender (Benutzer/Agent/extern), Richtung, Kanal, Zeitpunkt in Europe/Berlin, Anhaengen und Empfaengern. An jeder AUSGEHENDEN Zeile der UWG-Beleg: rechtsgrundlage, zweck, Freigabelink, Zustellstand. Anhang- und Freigabelink nur mit dokument.lesen bzw. freigabe.entscheiden (sonst Name ohne Verweis, D-567). Gelesen-Stempel per POST, nie GET (D-504). Antwortfeld; Faden schliessen und wieder oeffnen statt loeschen.
- `/.well-known/security.txt` — fertig — Handler mit text/plain, force-dynamic. Der Dienst liest plattform_einstellung['sicherheit.kontakt'] (optional 'sicherheit.richtlinie'); ohne gesetztes Postfach gibt er null zurueck und der Handler antwortet 404 — SEITENKARTE §2.5 verbietet die Veroeffentlichung ohne gelesenes Postfach (O-35). Mit Postfach: Contact (RFC-9116-URI, eine nackte Mailadresse wird abgewiesen), Expires = Serveruhr + 12 Monate, Preferred-Languages: de, en, Canonical aus derselben Hostquelle wie sitemap/robots. Nebenbei korrigiert: scripts/seitenkarte/extrahiere.ts stufte die Route wegen des Wortes 'route handler' als sitzungspflichtig ein — jetzt 'infrastruktur'; routen.generiert.ts neu erzeugt, genau eine Zeile geaendert.
- `/leistungen/[slug] (+ /en/leistungen/[slug])` — teilweise — Seite duenn wie [seite]/page.tsx: Slugform pruefen, unbekannt -> 404 (nie leere Seite), sonst OeffentlicheSeite. Kanonisch ist die EIGENE Adresse (eigene seite-Zeile je Sprache), Metadaten ueber metadatenFuer samt hreflang. Der Service-JSON-LD-Block entsteht in seiten-daten.ts (nicht in der Seite) ueber die neue Funktion seitenService(); provider bleibt WEG, solange niemand entschieden hat, welche Gesellschaft welche Leistungsseite verantwortet — Platzhalter nach Regel 1 (O-652). Sitemap braucht keine Ergaenzung: sitemapEintraege liest jede veroeffentlichte seite-Zeile. NACHGEZOGEN (war der Grund fuer 'teilweise'): es gab keine seite-Zeile unter /leistungen/, die Route antwortete also fuer jeden Slug 404 — und damit lief weder istLeistungsseite() noch die besitzer-Abfrage noch seitenService() jemals. Jetzt legt der Inhaltsimport je Sprache eine als Demonstrationsbestand BENANNTE Zeile an (`/leistungen/unterhaltsreinigung`, de + en, mandant_id NULL, ein Abschnitt 'Vorlaeufige Seite' mit Verweis auf O-652): LEISTUNGSSEITEN in seed/inhalt.ts, LEISTUNGSSEITEN_EN in seed/inhalt-en.ts, angehaengt in scripts/content-import.ts. NICHT in OEFFENTLICHE_ROUTEN — das ist die Liste der FESTEN Seiten, und welche Leistung eine eigene Seite bekommt, ist Redaktion. Gemessen gegen echtes Postgres: 118 angelegt, zweiter Lauf 0 angelegt / 118 unveraendert. Damit fertig.
- `/news/[slug] (+ /en/news/[slug])` — fertig — Gesellschaft fest operations (§2.2), oeffentlicherBeitragNachSlug, null -> notFound (Entwurf und nicht vorhanden sehen gleich aus). BeitragDetail in einer eigenen Gruppenhuelle statt ProfilRahmen (auf Gruppenebene gibt es keinen Gesellschaftsdeckel). rel=canonical auf /unternehmen/operations/news/<slug>, auch sichtbar als Satz unter dem Text. Nicht in der Sitemap — dort steht die kanonische Adresse.
- `/projekte/[slug] (+ /en/projekte/[slug])` — fertig — ReferenzAusTabelle.nachSlug(operationsId, slug), null -> notFound (eine Referenz ohne Kundenfreigabe und eine nicht vorhandene sehen von aussen gleich aus, PRO-05). ProjektDetail zeigt Titel, Kunde soweit freigegeben, Jahr, Beschreibung, freigegebene Bilder — nie Auftragswert, kunde_id oder Anschrift. rel=canonical auf /unternehmen/operations/projekte/<slug>.
- `/werbewiderspruch/[token]` — fertig — Die Seite; Tabellen, Definer und der POST-Handler kommen von der Domaene datenschutz (0222, services/datenschutz/werbewiderspruch.ts, api/werbewiderspruch) — ich habe meine eigene Fassung des Dienstes und des Handlers wieder entfernt, damit es nicht zwei Umsetzungen derselben Rechtsfrage gibt. Die Seite: metadata robots noindex/nofollow, POST-Knopf (kein GET — ein Mailscanner loeste sonst fremde Widersprueche aus), GET verraet fuer JEDEN formgueltigen Token dasselbe (kein Existenzorakel), drei Ergebnislagen erfasst/bereits/unbekannt, Hinweis dass vertragliche Post weiterlaeuft, und der § 7 Abs. 3 Nr. 4 UWG-Satz als sichtbar VORLAEUFIGER Platzhalter mit TODO(client, O-34). Zusaetzlich: /werbewiderspruch in AUSGESCHLOSSEN aufgenommen (robots + Sitemap) — die Sperre fehlte, obwohl die Karte sie fuehrt, und die Tokenadressen lagen in einer Flaeche, die als gesperrt beschrieben war.
- `Zusatz: Sitemap-Luecke PUB-10` — teilweise — Die Sitemap fuehrte ausschliesslich seite-Zeilen; kein veroeffentlichter beitrag und keine freigegebene referenz stand darin, obwohl §2.5 es verlangt. Neu: detailEintraege() liefert die KANONISCHEN Adressen /unternehmen/<bereich>/news/<slug>, /unternehmen/<bereich>/beitraege/<slug> und /unternehmen/<bereich>/projekte/<slug>. KORREKTUR: die erste Fassung filterte `and b.art::text in ('neuigkeit','aktualisierung')` und liess damit zwei der vier Beitragsarten sitemaplos — ein veroeffentlichter `beitrag` oder eine `projektschau` ist ueber /unternehmen/<b>/beitraege/<slug> oeffentlich erreichbar (oeffentlicherBeitragNachSlug kennt keinen Artenfilter), stand aber nirgends. Jetzt wird das SEGMENT aus der Art abgeleitet, ueber die neue Funktion beitragSegment(art) in services/social/dienst.ts (dieselbe Grenze wie NEUIGKEITS_ARTEN, O-548), und keine Art faellt weg. Dazu der zweite Teil desselben Befundes: /unternehmen/<b>/news/<slug> und /unternehmen/<b>/beitraege/<slug> liefern DIESELBE Zeile und setzten beide gar kein canonical (ihr generateMetadata gab nur `{ title: daten.name }`). Neu: src/app/(public)/unternehmen/[bereich]/_profil/kanonik.ts mit beitragsMetadaten(bereich, slug, sprache) — Titel des Beitrags, alternates.canonical auf das Segment, das beitragSegment() nennt, und hreflang; benutzt von allen VIER Seiten (de/en x news/beitraege). Sitemap und Seite fragen damit dieselbe Funktion, statt zwei Adressen zur einen zu erklaeren. Ohne alternates, weil beitrag und referenz keine sprache tragen — ein hreflang='en' auf denselben deutschen Text behauptete eine Uebersetzung, die es nicht gibt. Ohne lastModified, wo kein Zeitstempel da ist (kein 'heute' als Ersatz, R-11). Teilweise: stelle (Karriere) fehlt weiter — das gehoert dem Recruiting-Modul und O-512.
- `Zusatz: Seed` — fertig — seedKern(sql): je Gesellschaft (alle VIER) ein Team mit bis zu drei Mitgliedschaften (anstellung_id + festgenagelte person_id), drei Aufgaben (eine ueberfaellig, eine heute faellig, eine ohne Frist und ohne Bezug — der Waechterfall) an vorhandenen auftrag-/lead-Zeilen, und ein interner Faden mit Antwort. KORREKTUR: die erste Fassung suchte nur `admin`/`leitung`-Mitgliedschaften, und `operations` hat keine (nur zwei Dienstkonten) — dort entstanden weder Team noch Aufgabe noch Faden, also stand `/portal/operations/**` leer, bei genau der Gesellschaft, die nach §2.2 die oeffentlichen Gruppenseiten traegt. Jetzt drei Stufen: admin/leitung, sonst irgendein aktives Nicht-Dienstkonto des Bereichs, sonst die globale super_admin-Anmeldung. Gemessen: 4 Teams, 9 Mitglieder, 12 Aufgaben, 4 Faeden (vorher 3/9/9/3). Hat eine Gesellschaft keine Beschaeftigung, geht die Empfaengerzeile des Fadens an das Konto (`empfaenger_typ='benutzer'`) statt zu fehlen. Idempotent geprueft (zweiter Lauf: 0/0/0/0) gegen echtes Postgres. Nichts behauptet 'gesendet'.

## src/server/registry/dienste.ts

// src/server/registry/dienste.ts — am Ende von DIENSTE, vor dem `] as const;`
  /**
   * **Aufgaben und Nachrichtenfaeden (OPS-11, EMP-11, 0230/0231).**
   *
   * `kern/aufgabe` schreibt vier Uebergaenge — anlegen, Stand setzen,
   * erledigen, abbrechen — alle unter `aufgabe.schreiben`. Das ZUWEISEN
   * verlangt zusaetzlich `aufgabe.zuweisen`, und das prueft die Route
   * (`api/aufgaben`), nicht dieses Register: wer eine Aufgabe bearbeiten darf,
   * darf sie nicht schon deswegen jemand anderem aufhalsen.
   *
   * `kern/nachricht` schreibt unter `nachricht.versenden`. Der Weg nach
   * draussen (`sendeNachAussen`) laeuft zusaetzlich durch
   * `kern.nachricht_sendetor()` und die Freigabekette (Invariante 7) — und
   * heute gegen keinen verbundenen Versender (O-36), weshalb er wirft, statt
   * einen Erfolg zu behaupten. Der Gelesen-Stempel (`markiereGelesen`) traegt
   * bewusst KEIN Recht: `t_empfaenger_eigene_stempeln` (0231) bindet ihn an
   * `app.aktueller_benutzer()` bzw. `app.aktuelle_person()`.
   */
  {
    modul: 'aufgabe', pfad: 'kern/aufgabe',
    schreibend: true, schreibRecht: 'aufgabe.schreiben',
  },
  {
    modul: 'nachricht', pfad: 'kern/nachricht',
    schreibend: true, schreibRecht: 'nachricht.versenden',
  },
  /*
   * `inhalt/sicherheit-txt` ist reine Formatierung: eine Kontaktadresse hinein,
   * RFC-9116-Text heraus, oder `null`. Kein Schreibpfad, keine Abfrage, kein
   * Mandant — sie liest nicht einmal selbst, das tut der Handler.
   */
  { modul: 'inhalt', pfad: 'inhalt/sicherheit-txt', schreibend: false },

## src/server/auth/route-manifest.ts

// src/server/auth/route-manifest.ts — drei Eintraege in ROUTEN
  {
    pfad: '.well-known/security.txt',
    recht: null,
    grund:
      'RFC 9116, neben SEC-A7. Eine `.well-known`-Datei hinter einer Anmeldung erfüllt '
      + 'ihren Zweck nicht: sie wird von Prüfwerkzeugen und Sicherheitsforschenden ohne '
      + 'Sitzung abgeholt, und wer eine Lücke findet, soll sie melden können, ohne ein '
      + 'Konto zu haben. Sie enthält nur, was ohnehin veröffentlicht werden soll — eine '
      + 'Kontaktadresse, ein Ablaufdatum, zwei Sprachen. Und sie antwortet 404, solange '
      + 'kein Postfach benannt ist (O-35): eine Adresse, die niemand liest, ist '
      + 'schlechter als keine Datei (SEITENKARTE §2.5).',
  },
  {
    /**
     * Anlegen, Stand setzen, zuweisen, erledigen, abbrechen (OPS-11).
     *
     * `aufgabe.schreiben` traegt alle fuenf; das Zuweisen prueft der Handler
     * zusaetzlich gegen `aufgabe.zuweisen` — die Seite entscheidet, was sie
     * ZEIGT, der Handler, was er TUT (AUT-04). Es gibt KEINEN
     * `loeschen`-Vorgang: `aufgabe` traegt die Loeschsperre aus 0230, und
     * Abbrechen mit Pflichtgrund ist die Antwort auf „nicht mehr noetig".
     */
    pfad: 'api/aufgaben',
    recht: 'aufgabe.schreiben',
  },
  {
    /**
     * Faden eroeffnen, antworten, schliessen, wieder oeffnen — und den EIGENEN
     * Gelesen-Stempel setzen (EMP-11, NOT-03).
     *
     * `nachricht.versenden` fuer alles Schreibende. Der Gelesen-Stempel laeuft
     * durch denselben Handler OHNE Recht: `t_empfaenger_eigene_stempeln`
     * (0231) bindet ihn an `app.aktueller_benutzer()` bzw.
     * `app.aktuelle_person()`, und ein Recht davor hiesse, dass jemand eine
     * Nachricht bekommen kann, die er nicht als gelesen markieren darf.
     * Geschuetzt ist der Weg durch die Methode (nur POST — ein GET, das
     * stempelt, leert den Posteingang von allein, D-504) und das Ursprungstor.
     *
     * Nach draussen geht hier nichts: das laeuft ueber `sendeNachAussen`,
     * `kern.nachricht_sendetor()` und die Freigabekette (Invariante 7).
     */
    pfad: 'api/nachrichten',
    recht: 'nachricht.versenden',
  },

## src/server/db/schema/rls.ts

// ============================================================================
// 1) src/server/db/schema/rls.ts — FUENF Eintraege, bitte am ENDE von
//    KEIN_HARD_DELETE anfuegen (die Reihenfolge entscheidet SOFT_DELETE, siehe
//    Punkt 3). Die `grund`-Texte sind WORTWOERTLICH die, die ich in die
//    erzeugten Bloecke von 0230/0231 geschrieben habe — `pnpm db:triggers`
//    vergleicht sie zeichengenau (nach `\s+ -> ' '`).
// ============================================================================
  {
    tabelle: 'team',
    art: 'soft',
    migration: '0230',
    grund:
      '§7.5. Ein aufgeloestes Team ist die Antwort auf die Frage, wer eine '
      + 'Aufgabe oder einen Termin damals bekommen hat. Geloescht waere es ein '
      + 'Verweis ins Leere in jeder Zeile, die darauf zeigt — und '
      + '`aufgabe.zugewiesen_team_id` zeigt darauf. `geloescht_am` loest es auf.',
  },
  {
    tabelle: 'aufgabe',
    art: 'soft',
    migration: '0230',
    grund:
      'OPS-11, SPEC §14. Eine Aufgabe ist die Aufzeichnung einer Pflicht: wer '
      + 'sie wann bekam, wer sie schloss, und mit welcher Begruendung sie '
      + 'abgebrochen wurde. Sie zu loeschen hiesse, den Nachweis zu entfernen, '
      + 'dass ein Waechterbefund je offen war. Beendet wird mit `status`, '
      + 'entfernt mit `geloescht_am`.',
  },
  {
    tabelle: 'nachricht',
    art: 'soft',
    migration: '0231',
    grund:
      '§ 7 UWG, LEG-08, CRM-08. Die ausgehende Nachricht IST der Nachweis, auf '
      + 'welcher Rechtsgrundlage jemand kontaktiert wurde — und bei einem '
      + 'Agentenentwurf zusaetzlich, wer ihn freigegeben hat. Eine geloeschte '
      + 'Zeile ist gegenueber einer Abmahnung kein Nachweis. Ein Faden wird mit '
      + '`geschlossen_am` beendet, eine Zeile mit `geloescht_am` aus der Liste '
      + 'genommen.',
  },
  {
    tabelle: 'nachricht_empfaenger',
    art: 'append',
    migration: '0231',
    grund:
      '§ 7 UWG. WEM etwas geschickt wurde, ist die Haelfte des Nachweises; die '
      + 'andere steht in `nachricht`. Eine Empfaengerzeile zu loeschen hiesse, '
      + 'die Werbemail zu behalten und den Empfaenger zu vergessen. Anfuegend, '
      + 'ausser `zugestellt_am` und `gelesen_am`.',
  },
  {
    tabelle: 'nachricht_anhang',
    art: 'append',
    migration: '0231',
    grund:
      'DOC-03, § 7 UWG. Ein Anhang ist der klassische Fehlversandweg; welche '
      + 'Datei mit welcher Nachricht hinausgegangen ist, muss belegbar bleiben. '
      + 'Die Datei selbst haengt an `dokument` und hat dort ihre eigene '
      + 'Aufbewahrung.',
  }

// Nicht in KEIN_HARD_DELETE — und das ist eine Entscheidung, keine
// Auslassung: `team_mitglied` ist loeschbar. Eine Mitgliedschaft endet, wenn
// jemand das Team verlaesst; die Zeile traegt keinen Nachweis, nur eine
// Zuordnung, und §7.5 gibt ihr bewusst kein S4. Der Grant lautet deshalb
// `select, insert, update, delete`.

// GEAENDERT_AM bleibt UNVERAENDERT: `trg_team_geaendert`, `trg_aufgabe_geaendert`
// und `trg_nachricht_geaendert` stehen von Hand in 0230/0231, genau wie
// `trg_ke_geaendert` in 0160. Ein Eintrag in GEAENDERT_AM erzeugte einen
// ZWEITEN Ausloeser mit anderem Namen auf derselben Tabelle.
// AUDITIERT ebenfalls unveraendert.

// ============================================================================
// 2) scripts/generate-triggers.ts — die zwei Zeilen in MIGRATIONS_DATEIEN habe
//    ich bereits eingetragen (sie sind harmlos, solange rls.ts die Tabellen
//    noch nicht kennt: `erzeuge()` wird fuer eine Migration ausserhalb von
//    MIGRATIONEN nie gerufen):
//      '0230': join(WURZEL, 'drizzle/0230_kern_team_aufgabe.sql'),
//      '0231': join(WURZEL, 'drizzle/0231_nachricht_faden.sql'),

// ============================================================================
// 3) tests/isolation/unveraenderbarkeit.test.ts:146 — die eingefrorene Liste
//    muss mitwachsen, sonst faellt sie. SOFT_DELETE ist ABGELEITET aus
//    KEIN_HARD_DELETE in DEKLARATIONSREIHENFOLGE; bei Anfuegen am Ende (wie
//    oben) lautet sie:
//      expect(SOFT_DELETE).toEqual(
//        ['dokument', 'person', 'anstellung', 'vergabemappe', 'team', 'aufgabe', 'nachricht']);
//    Werden die Eintraege woanders eingefuegt, aendert sich die Reihenfolge —
//    bitte dann entsprechend anpassen.

## src/server/registry/navigation.ts

// src/server/registry/navigation.ts — zwei Eintraege in NAVIGATION
// (Rechte stimmen mit routen.generiert.ts:111 und :277 ueberein, also mit
//  `gruppen-navigation.test.ts` — beides `lesen`, nicht `schreiben`.)
  /**
   * `aufgaben` — die offene Pflicht (OPS-11, DSH-01, SPEC §14).
   *
   * **Ohne diesen Punkt waere die Liste aus dem Portal heraus mit keinem Klick
   * erreichbar** — man kaeme nur hin, indem man die Adresse eintippt. Genau
   * dieser Befund hat `website` und `recruiting` in dieses Register gebracht;
   * `aufgabe` gibt es erst seit 0230, also fehlt der Punkt noch.
   *
   * Das Recht ist `aufgabe.lesen`, dasselbe, das die Route im Manifest traegt.
   * Das Icon ist `ok` aus dem geschlossenen Satz (DESIGN §5) — ein eigenes
   * Bild gaebe der Satz nicht her, und eines zu zeichnen hiesse zuerst
   * DESIGN.md zu aendern.
   *
   * **Nicht in `GRUPPEN_NAVIGATION`**, obwohl `gruppe.aufgabe.lesen` im
   * Katalog steht und die Policy `t_aufgabe_gruppe` (0230) es freigibt: die
   * Seitenkarte fuehrt in §6 keine `/portal/gruppe/aufgaben`, und ein Punkt
   * auf eine Seite, die es nicht gibt, ist der Fehler aus D-561.
   */
  { schluessel: 'aufgaben', label: 'Aufgaben', pfad: 'aufgaben', recht: 'aufgabe.lesen', icon: 'ok' },
  /**
   * `nachrichten` — der Fadenposteingang (EMP-11, CRM-03, SEITENKARTE §5.17).
   *
   * **Nicht zu verwechseln mit `/portal/mein/nachrichten`**: das ist der
   * Meldungs-Posteingang ueber `benachrichtigung` (NOT-01) und haengt an der
   * Arbeiterleiste. Hier geht es um `nachricht` — den Schriftverkehr in einem
   * Vorgang.
   *
   * **Nicht in `GRUPPEN_NAVIGATION`.** `gruppe.nachricht.lesen` steht im
   * Katalog und `t_nachricht_gruppe` (0011) gibt es frei — aber
   * `06-RADAR-KI-INHALT.md` §1.4 verlangt fuer `nachricht` das Gegenteil (die
   * Gruppenansicht soll dort null Zeilen sehen), und die Seitenkarte fuehrt
   * keine `/portal/gruppe/nachrichten`. Der Widerspruch ist gemeldet und nicht
   * entschieden: O-651.
   */
  { schluessel: 'nachrichten', label: 'Nachrichten', pfad: 'nachrichten', recht: 'nachricht.lesen', icon: 'mail' },

## Sonstiges

// ============================================================================
// A) docs/architecture/04-SEITENKARTE.md — EINE Korrektur, die einen
//    Extraktionsfehler an der Quelle behebt (ich habe stattdessen den
//    Extraktor korrigiert, siehe B; die Karte selbst ist unangetastet).
// ============================================================================
// Zeile 586 traegt in der Implementierungsspalte nur „route handler". Das Wort
// traf in `scripts/seitenkarte/extrahiere.ts` die Regex
// `/sitzung|authenticated|otp|route handler/iu` und stufte
// `/.well-known/security.txt` als `{"art":"sitzung"}` ein — eine
// `.well-known`-Datei hinter einer Anmeldung erfuellt ihren Zweck nicht.
// `/llms.txt` kam nur richtig heraus, weil daneben `text/plain` stand und der
// Schraegstrich wie ein Dateiname aussah, also aus dem falschen Grund.
// GETAN: der Extraktor deutet „route handler" ohne Rechteschluessel jetzt als
// `infrastruktur`, `pnpm seitenkarte` neu gelaufen, genau EINE Zeile in
// `src/server/registry/routen.generiert.ts` geaendert (Zeile 55). Keine weitere
// Zeile der Karte traegt „route handler" in der Bewachungsspalte (nachgezaehlt:
// 679/680 tragen es im PFADfeld).

// ============================================================================
// B) Was ich in zentralen Dateien SELBST geaendert habe — zur Kenntnis
// ============================================================================
// · scripts/seitenkarte/extrahiere.ts  — die Korrektur aus A
// · src/server/registry/routen.generiert.ts — neu erzeugt (1 Zeile Delta)
// · src/server/services/inhalt/sitemap.ts — `/werbewiderspruch` in
//   AUSGESCHLOSSEN (die Sperre fehlte, obwohl §2.5 sie fuehrt) und die neue
//   Funktion `detailEintraege()` fuer die kanonischen Detailadressen (PUB-10)
// · src/app/sitemap.ts — `detailEintraege()` eingehaengt
// · src/server/services/inhalt/jsonld.ts — neue Funktion `seitenService()`
// · src/server/inhalt/seiten-daten.ts — `istLeistungsseite()`, die
//   Besitzerabfrage NUR fuer `/leistungen/<slug>` und der `Service`-Block
// · src/lib/sprache.ts — `/werbewiderspruch` in NUR_DEUTSCH (sonst faellt
//   `sprachpfade.test.ts`: ein Sprachumschalter auf eine Seite, die es auf
//   Englisch nicht gibt, ist ein 404). Begruendung im Kommentar: der § 7
//   Abs. 3 Nr. 4 UWG-Hinweis ist deutsches Recht (wie D-84 fuer Impressum und
//   Datenschutz), und eine zweite Formulierung eines ungepruefen Rechtstextes
//   waere zweimal ungeprueft.
// · tests/kern/routen-manifest.test.ts — die eingefrorene „offen"-Liste ist um
//   `/leistungen/[slug]`, `/news/[slug]` und `/projekte/[slug]` GESCHRUMPFT
//   (mit Begruendung im Kommentar). Die Liste darf nur schrumpfen.
// · src/server/db/seed/index.ts — ein Import und ein Aufruf `seedKern(sql)`
//   nach `seedBenachrichtigungen`, mit Ausgabezeile
// · scripts/generate-triggers.ts — zwei Zeilen in MIGRATIONS_DATEIEN

// ============================================================================
// C) Zwei Punkte, die NICHT meine sind, die ich aber beim Bauen gemessen habe
// ============================================================================
// 1. `drizzle/0222_werbewiderspruch.sql` (Domaene datenschutz) traegt
//    `nachricht_id uuid references nachricht(id)` — ein EINSPALTIGER
//    Fremdschluessel auf eine Tabelle mit `mandant_id`. K-16/§1.11 nennt das
//    ein Pruefungsfehler und begruendet es mit dem Existenzorakel: die
//    Integritaetspruefung laeuft an RLS vorbei, eine geratene uuid gelingt,
//    wenn die Zeile IRGENDEINER Gesellschaft gehoert. Richtig waere
//    `foreign key (mandant_id, nachricht_id) references nachricht (mandant_id, id)`;
//    `nachricht_mandant_id_uk` existiert seit 0011.
// 2. `tests/kern/verweis-rechte.test.ts` faellt noch mit fuenf Befunden — alle
//    fuenf in `[mandant]/datenschutz/**`. Meine zwei (`nachrichten/[id]` ->
//    `dokumente/[x]` und `-> freigaben/[x]`) sind behoben: die Seite fragt
//    `dokument.lesen` und `freigabe.entscheiden` in derselben gebundenen
//    Transaktion und zeigt den Namen ohne Verweis, wenn das Recht fehlt.

// ============================================================================
// D) Testlage nach meinem Stand
// ============================================================================
// · `npx tsc --noEmit` ueber das GANZE Projekt: 0 Fehler
// · eslint ueber alle meine Pfade und die geaenderten zentralen Dateien: sauber
// · tests/kern/{aufgabe-frist,sicherheit-txt,gruppen-kanonik,
//   oeffentliche-detailwege,routen-manifest,sprachpfade,seo,jsonld,annahmen,
//   wachen,zustandsseiten,tableiste-ziele,portal-shell(9/10),quelltext,
//   rumpf-form,api-verdrahtung,weiterleitung-ziel,rueckweg} und tests/design/*:
//   gruen
// · tests/isolation/{aufgabe,nachricht-faden}: 45/45 gruen, gegen echtes
//   Postgres 16 als `cse_app` mit FORCE RLS (eigene Datenbank `w_aufg`, Klon
//   `w_aufg_w1`, ohne `pnpm test:isolation` und ohne `cse_test` zu beruehren)
// · ROT, bis Du die Register pflegst — beides ist genau die Zusage, die diese
//   Tests tragen sollen:
//     - tests/kern/routen.test.ts „keine Route fehlt im Manifest": es fehlen
//       `.well-known/security.txt`, `api/aufgaben`, `api/nachrichten` (meine)
//       und fuenf `api/datenschutz/*` (andere Domaene)
//     - tests/kern/portal-shell.test.ts „das Register kennt jeden Dienst":
//       `kern/aufgabe`, `kern/nachricht`, `inhalt/sicherheit-txt` (meine) und
//       vier `datenschutz/*` (andere Domaene)
//     - scripts/guards `todo-client-nicht-im-register`: O-650, O-651, O-652
//       (meine) und O-640…O-647 (andere Domaene)
//     - tests/isolation/unveraenderbarkeit.test.ts, sobald rls.ts die fuenf
//       Tabellen kennt: die eingefrorene SOFT_DELETE-Liste (siehe registry_rls
//       Punkt 3)

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-650 | **Welche Rollen gibt es in einem Team — Leitung, Stellvertretung, Mitglied, Springer?** `team_mitglied.rolle` ist Freitext, weil niemand die Liste bestätigt hat. Ein Aufzählungstyp wäre eine erfundene Organisationsstruktur, und ein falscher Wert darin fällt erst auf, wenn ein Filter danach fragt und Teilmengen liefert. **Heute ehrlich gemacht:** die Spalte ist nullbar, der Seed setzt sie nicht, und keine Abfrage wertet sie aus — sie wird erfasst, nicht benutzt. Sobald die Liste steht, ist es ein Enum plus eine Migration. | CAL-02, OPS-11, `06-RADAR-KI-INHALT.md` §7.5, `drizzle/0230` |
| O-651 | **Darf die Gruppenleitung Nachrichtenfäden der vier Gesellschaften lesen?** Zwei Dokumente sagen Gegenteiliges, und beide sind normativ. `0011` legte `t_nachricht_gruppe` an (Gruppenansicht mit `gruppe.nachricht.lesen`), der Schlüssel steht im Rechtekatalog, und die Tab-Leiste des Kundenportals verweist darauf. `06-RADAR-KI-INHALT.md` §1.4 führt `nachricht`, `nachricht_anhang` und `nachricht_empfaenger` dagegen in der Liste der Tabellen mit `p_gruppe_kein_personenbezug` — dort sieht die Gruppenansicht NULL Zeilen, weil TEN-05 ihr aggregierte Zahlen gibt und nicht den Vertragstext einer Schwestergesellschaft. **Heute gebaut: der Bestand bleibt.** `0231` setzt die restriktive Decke NICHT, weil sie eine vorhandene Policy und einen vorhandenen Katalogschlüssel still wirkungslos gemacht hätte („Do not break what works"), und sie auch nicht nachträglich, weil eine Entscheidung über den Zugriff einer Gesellschaft auf die Kommunikation einer anderen dem Auftraggeber gehört. `/portal/[mandant]/nachrichten` verlangt ohnehin genau einen aktiven Mandanten, und `/portal/gruppe/nachrichten` gibt es nicht — die Frage wirkt heute nur auf die Policy, nicht auf einen Bildschirm. | EMP-11, CRM-03, TEN-05, `06-RADAR-KI-INHALT.md` §1.4, `drizzle/0011`, `drizzle/0231` |
| O-652 | **Welche Leistungen bekommen eine eigene Seite unter `/leistungen/<slug>`, und welche Gesellschaft verantwortet sie?** Zwei Fragen, und die zweite ist die teurere. (a) Welche Leistungen eine eigene Adresse tragen und wie sie heissen, ist Redaktion: `seite.pfad` erlaubt mehrsegmentige Pfade seit `0014`, es fehlen die ZEILEN, nicht die Spalten. (b) `Service.provider` braucht eine Gesellschaft, und die dreizehn vorhandenen `seite`-Zeilen der Gruppenebene tragen alle `mandant_id = NULL`. `04-SEITENKARTE.md` §2.2 sagt, die Gruppenadresse trage nur, was `operations` gehört, und alles andere sei unter `/unternehmen/<bereich>/leistungen` kanonisch — eine Reinigungsleistung unter `/leistungen/` wäre damit entweder falsch zugeordnet oder eine zweite Fassung. **Heute ehrlich gemacht:** die Route ist vollständig gebaut (Slugprüfung, 404 statt leerer Seite, eigene Kanonik samt `hreflang`, englischer Zwilling), der `Service`-Block entsteht zentral in `seiten-daten.ts` — und `provider` bleibt WEG, solange die Zuordnung fehlt. Ein Block ohne `provider` ist gültiges Schema.org und sagt weniger; ein erfundener sähe vollständig aus und wäre eine falsche Aussage über die Firmenstruktur. **Bestand:** der Inhaltsimport legt je Sprache EINE als Demonstrationsbestand benannte Zeile an (`/leistungen/unterhaltsreinigung`, `mandant_id = NULL`, ein Abschnitt „Vorläufige Seite“ mit Verweis auf diese Frage) — ohne sie liefe die ganze Kette nie, und fertig gemeldeter, zur Laufzeit ungesehener Code ist der schlechteste Zustand, den Code haben kann. Welche Leistungen wirklich eine eigene Seite bekommen, entscheidet die Redaktion; jede andere Adresse antwortet weiter 404. | PUB-01, PUB-07, PUB-11, `04-SEITENKARTE.md` §2.2, `services/inhalt/jsonld.ts`, `server/inhalt/seiten-daten.ts` |

## Tests

- tests/kern/aufgabe-frist.test.ts — 16 Faelle fuer fristlage(): Zeitpunkt gegen Tag, Berliner Kalendertag statt UTC-Tag, beide Umstellungsnaechte (29.03. verkuerzt, 25.10. verlaengert), Grenze 'jetzt' = ueberfaellig, widerspruechliche Eingabe ohne Absturz, OFFENE_ZUSTAENDE/istOffen
- tests/kern/sicherheit-txt.test.ts — ohne Postfach kein Text (also 404), nackte Mailadresse abgewiesen, http abgewiesen, Contact/Expires(+12 Monate aus der Serveruhr)/Canonical/Preferred-Languages, Policy nur wenn hinterlegt, keine leere Feldzeile, Abschluss-Zeilenumbruch
- tests/kern/gruppen-kanonik.test.ts — kanonischerDetailpfad de/en, zeigt nie auf sich selbst, GRUPPEN_GESELLSCHAFT an EINER Stelle; Quelltextpruefung, dass alle vier news/projekte-Seiten gruppenDetailMetadaten rufen und die beiden leistungen-Seiten bewusst metadatenFuer (eigene Kanonik); findeRoute fuer die drei Muster
- tests/kern/oeffentliche-detailwege.test.ts — leistungsPfad nimmt nur Slugs, die eine seite-Zeile treffen koennen (neun Gegenbeispiele inkl. ../datenschutz); AUSGESCHLOSSEN fuehrt alle fuenf Praefixe der Karte; /werbewiderspruch und /werbewiderspruch/<token> gesperrt, /werbewiderspruch-info nicht
- tests/isolation/aufgabe.test.ts — 25 Faelle gegen echtes Postgres als cse_app (21 waren es im Bericht; tatsaechlich 23, und die Pruefung hat zwei schreibende Mitarbeiterfaelle ergaenzt): Mandantengrenze; 'aufgabe.schreiben oeffnet das Lesen mit' ausdruecklich festgehalten, ohne beide Rechte leer, eigene Aufgabe bleibt sichtbar; Mitarbeiterportal sieht eigene und Teamaufgabe, nicht die fremde; p_tm_ma_decke; ein Mitarbeiterkonto ERLEDIGT seine zugewiesene Aufgabe (schreibend, readonly:false) und erledigt eine fremde NICHT; Kundenportal leer; Doppelungssperre NULLS NOT DISTINCT (zweiter Waechterlauf legt nichts nach, je Gesellschaft eine Zeile, nach dem Erledigen wieder moeglich); die vier CHECKs; delete und truncate abgewiesen; Gruppenansicht liest und kann nicht anlegen; Team- und Anstellungs-FKs inkl. festgenagelter person_id
- tests/isolation/nachricht-faden.test.ts — 22 Faelle: trg_thread_id (Wurzel ist ihr eigener Faden, Antwort und Antwort-auf-Antwort im selben Faden, fremde Gesellschaft abgewiesen); § 7 UWG als Datenbankbedingung (ausgehend ohne Grundlage und mit 'keine' abgewiesen, intern erlaubt); Agent ohne Freigabe abgewiesen, Agent ohne Namen abgewiesen; Sendetor: ohne Ansprechpartner, Zweck 'intern' und fehlende Kanaleinwilligung abgewiesen, und die Rechtsgrundlage wird GEZOGEN (Aufrufer gab 'anfrage', gespeichert ist 'einwilligung'), zustell_status bleibt 'ausstehend'; p_beteiligt je Art (person gegen person_id, fremde Person nicht, eigener Stempel trifft nur die eigene Zeile); extern ohne Adresse und Nicht-extern ohne Id abgewiesen; schliessen nur an der Wurzel; delete/truncate auf allen drei Tabellen abgewiesen; Anhang-FK ueber Gesellschaftsgrenze abgewiesen

## NICHT gebaut

- /werbewiderspruch (tokenlos) — nicht in meiner Routenliste und NICHTS zu bauen. KORREKTUR einer falschen Zeile in dieser Datei: die Seite `src/app/(public)/werbewiderspruch/page.tsx` existiert (derselbe Commit 1662c3c), und ihre drei Rueckmeldezustaende sind genau die drei, mit denen `api/werbewiderspruch` den tokenlosen Weg zurueckleitet (`entgegengenommen`, `email_ungueltig`, `ohne_gesellschaft`) — nicht die drei der Tokenseite (`erfasst|bereits|unbekannt`), das sind zwei verschiedene Mengen und jede passt zu ihrem Weg. Der tokenlose Weg endet also NICHT auf 404. Gehoert weiterhin zur Domaene datenschutz.
- /portal/gruppe/nachrichten und /portal/gruppe/aufgaben — die Seitenkarte fuehrt sie in §6 nicht; die Lesepolicies (gruppe.aufgabe.lesen, gruppe.nachricht.lesen) stehen und sind geprueft, aber ein Menuepunkt auf eine Seite, die es nicht gibt, ist D-561.
- /portal/[mandant]/team — es gibt keine Routenzeile dafuer. team und team_mitglied sind angelegt, geseedet und im Mitarbeiterportal sichtbar; eine Pflegeoberflaeche fehlt und gehoert zur Kalender-/Stammdatendomaene.
- kalender_eintrag / kalender_teilnehmer nach §7.3/§7.4 — nicht meine Tabellen (0160 fuehrt eine eigene, einfachere Fassung). team/team_mitglied sind so gebaut, dass kalender_eintrag.team_id sie per zusammengesetztem FK nutzen kann.
- Aussenversand von Nachrichten — kein Versender verbunden (O-36). sendeNachAussen() ist vollstaendig gebaut, wirft aber VersandNichtVerbundenFehler BEVOR es schreibt; die Oberflaeche sagt 'nicht verbunden'.
- Sitemap-Eintraege fuer offene stelle-Zeilen (Karriere) — gehoert dem Recruiting-Modul und haengt an O-512.
- benachrichtigung / benachrichtigung_praeferenz nach §7.8 — 0011 fuehrt eine aeltere, funktionierende Fassung; anzufassen haette den gebauten Posteingang gebrochen (Do not break what works).

## Notizen des Bauenden

ABWEICHUNGEN VOM PLAN, jeweils mit Grund.

1. `/werbewiderspruch/[token]`: Der Plan gab mir Seite UND Dienst. Waehrend ich baute, hat die Domaene `datenschutz` `drizzle/0222_werbewiderspruch.sql`, `src/server/services/datenschutz/werbewiderspruch.ts` und `src/app/api/werbewiderspruch/route.ts` geliefert — mit `app.werbewiderspruch_einloesen`, `app.werbewiderspruch_token_mandant` und dem tokenlosen Weg. Ich habe meine eigene Fassung (services/crm/werbewiderspruch.ts + mein api-Handler) geloescht und nur die SEITE behalten. Zwei Umsetzungen derselben Rechtsfrage sind zwei Gelegenheiten, eine davon zu lockern. WICHTIG: ihr Token ist base64url (32 Byte), nicht 64 Hex — meine erste Formpruefung haette jeden echten Link mit 404 abgewiesen; korrigiert auf `^[A-Za-z0-9_-]{20,200}$`.

2. Der Plan verlangte fuer `/werbewiderspruch/[token]`: „Ein unbekannter Token gibt dieselbe neutrale Antwort wie ein bereits benutzter". Ich habe es ANDERS geloest und halte das fuer richtiger: der GET verraet fuer jeden formgueltigen Token dasselbe (also auch fuer einen erfundenen — dort liegt das Orakel, und es ist geschlossen), und erst nach dem POST unterscheiden sich `bereits` und `unbekannt`. Zu sagen „Ihr Widerspruch ist bereits erfasst", wo nichts erfasst ist, waere eine falsche Aussage auf einem gesetzlichen Pflichtweg — teurer als ein Unterschied, den nur der Inhaber eines 32-Byte-Zufallswertes sehen kann.

3. Der Plan wollte `sichtbare Aufgaben-/Nachrichten-Seiten mit „offen (O-NN)"`. Bei diesen vier Routen gab es nichts zu sperren: keine offene Geschaeftsfrage blockiert sie (das sagt der Plan selbst fuer `aufgaben`). Die Platzhalter sitzen dort, wo wirklich etwas offen ist: O-650 (Teamrolle, Freitext statt Enum), O-651 (Gruppenlesung Nachrichten, Policy bewusst NICHT gesetzt), O-652 (Service.provider bleibt weg), O-34 (UWG-Wortlaut, sichtbar „vorlaeufig" auf der Seite), O-36 (kein Versender: „nicht verbunden" im Posteingang und im Faden), O-35 (security.txt antwortet 404).

BEFUNDE, die beim Bauen entstanden sind und die ich fuer wichtig halte.

4. `t_aufgabe_schreiben` ist `for all`, und die `USING`-Bedingung einer `for all`-Policy gilt AUCH fuer `select`. `aufgabe.schreiben` oeffnet damit das Lesen mit. Das ist die Bauart von `kalender_eintrag` (0160) und meines Erachtens richtig (wer einen Zustand setzen darf, muss ihn sehen), aber es ist eine Eigenschaft, die man leicht uebersieht: `tests/isolation/aufgabe.test.ts` haelt sie jetzt ausdruecklich fest, in beide Richtungen. Wirkung ist keine, weil ein `mitarbeiter` (der `schreiben` ohne `lesen` haelt) `app.portal() = 'mitarbeiter'` traegt und damit unter `p_zustaendig` nur Eigenes sieht.

5. `nachricht_empfaenger` hatte kein `erstellt_am` — S1 verlangt es auf jeder Tabelle, und hier kostete das Fehlen konkret die Reihenfolge der Empfaenger. Nachgetragen in 0231.

6. Der Definer `kern.nachricht_thread_wurzel` bekommt einen SPALTEN-Grant auf `(mandant_id, id, thread_id)` und nicht die Tabelle. Beim ersten Lauf scheiterte er an „permission denied for table nachricht" — die Reparatur waere ein `grant select on nachricht to cse_definer` gewesen, also ein zweiter Lesepfad auf Nachrichtentexte neben RLS. Mit dem Spaltengrant kommt selbst eine kuenftige Definer-Funktion mit derselben Eigentuemerschaft an `koerper`, `betreff` und `rechtsgrundlage` nicht heran (K-05).

7. Der Bezugslink in der Aufgabenliste entsteht aus den JOINS und nicht aus `a.auftrag_id`: fehlt der Sitzung `auftrag.lesen`, kommt `auf.id` als NULL zurueck und die Zeile zeigt die Art ohne Verweis. Damit entscheidet RLS ueber den Link, nicht eine zweite Rechteabfrage, die auseinanderlaufen koennte — und `verweis-rechte.test.ts` hat keinen Befund, weil es gar keinen gibt.

8. `p_gruppe_kein_personenbezug` auf `nachricht*` habe ich NICHT gesetzt (siehe O-651). Das ist die einzige Stelle, an der ich bewusst von `06-RADAR-KI-INHALT.md` abweiche, und sie steht als Widerspruch in DECISIONS statt als still gesetzte Regel.

9. `0222` (fremde Domaene) traegt einen einspaltigen FK `nachricht_id -> nachricht(id)`. Siehe registry_sonstiges C.1 — das ist ein K-16-Befund mit Existenzorakel, aber nicht meine Datei.

DESIGN: keine neuen Werte. Benutzt sind ausschliesslich vorhandene Tokens (`s1`…`s7`, `text`/`text-muted`/`text-subtle`, `surface`/`surface-2`/`surface-3`, `line`/`line-strong`, `brand`/`brand-hover`, `danger`/`warning`/`success`, `rounded-md`/`rounded-lg`, `text-h1`/`text-h2`/`text-sm`/`text-xs`/`text-micro`, `min-h-11`, `duration-fast`, `ease-brand`, `max-w-content`, `max-w-prose`) und die vorhandenen Bauteile `PortalRahmen`, `DataTable`, `StatusPill`, `Hinweis`, `Button`. Die Prioritaetsfarben kommen aus dem semantischen Satz (`text-warning` fuer hoch, `text-danger` fuer dringend); ein eigener Ton dafuer stand nicht zur Wahl. Icons aus dem geschlossenen Satz: `ok` fuer Aufgaben, `mail` fuer Nachrichten — `tests/design/*` (58 Faelle) laeuft gruen.

MIGRATIONSNUMMERN: nur 0230 und 0231 aus 0230–0244; 0232–0244 bleiben frei. Keine vorhandene `drizzle/*.sql` angefasst. Gepruefte Reihenfolge: voller Neuaufbau von `w_aufg` (0000 → 0231, inklusive 0220–0222 der Domaene datenschutz) bis „Migrationen angewendet.", danach 45 Isolationstests gegen denselben Bestand.
