# Registereinträge: aufgaben-nachrichten-oeffentlich

**Warteschlange, kein Archiv.** Diese Einträge sind **noch nicht** im Baum. Die
gemeinsamen Dateien pflegt EINE Hand, weil mehrere Agenten gleichzeitig arbeiten
und sich sonst in dieselbe Zeile schreiben. Ist ein Abschnitt eingetragen, wird
er hier gelöscht — solange er hier steht, fehlt er dort.

**Die Einträge des Behebungsschritts gelten.** Er lief zuletzt und hatte den
Auftrag, die vollständige aktuelle Liste zu liefern — auch das, was sich seit
dem Bauschritt geändert hat.

## Stand

- Bau: fertig
- Kritik: 13 Befunde
- Behebung: 12 behoben, 1 widerlegt, 3 offen

## Migrationen (gegen eine eigene Datenbank gefahren: True)

- drizzle/0230_kern_team_aufgabe.sql — Enums aufgabe_status, prioritaet, bezug_typ; Tabellen team, team_mitglied, aufgabe; Indizes inkl. aufgabe_job_uk UNIQUE NULLS NOT DISTINCT; RLS (t_*_lesen/schreiben/gruppe/eigene, restriktiv p_zustaendig, p_aufgabe_kunde_decke, p_tm_ma_decke, p_*_kunde_decke, t_job_*); Loeschsperre fuer team und aufgabe im erzeugten Block
- drizzle/0231_nachricht_faden.sql — Enums nachricht_richtung, nachricht_kanal, nachricht_empfaenger_typ, empfaenger_art, zustell_status; nachricht additiv auf die §7.9-Form (thread_id, antwortet_auf_id, richtung, kanal, akteur_art, absender_agent_id/extern, bezug_typ/bezug_id, rechtsgrundlage(+kontakt_id), zweck, freigabe_id, zustell_status/zustell_fehler, geschlossen_am/von, S2/S3/S4) plus Umbenennung absender_id->absender_benutzer_id und text->koerper; nachricht_empfaenger polymorph (person_id entfaellt samt Policy); nachricht_anhang neu; kern.nachricht_thread_wurzel (Definer, cse_definer, Spalten-Grant auf drei Spalten), kern.setze_thread_id, kern.nachricht_sendetor; die vier CHECKs; RLS inkl. restriktivem p_beteiligt je Empfaengerart; Loeschsperre fuer nachricht, nachricht_empfaenger, nachricht_anhang im erzeugten Block
- (Behebung) drizzle/0230_kern_team_aufgabe.sql — GEÄNDERT: `p_aufgabe_kunde_decke` trägt jetzt `with check (app.portal() <> 'kunde')` statt `= 'intern'`, mit ausführlicher Begründung im Kommentar (warum die alte Form jedes Erledigen durch ein Mitarbeiterkonto abwies und warum die Verengung `p_zustaendig` leistet). Sonst unverändert; der erzeugte Löschsperrblock (Zeilen 492-515) ist unangetastet und stimmt weiter zeichengenau mit den rls.ts-Einträgen im Register überein.
- (Behebung) drizzle/0231_nachricht_faden.sql — unverändert (die Schwestermigration hatte den Fehler nicht: ein Mitarbeiterkonto schreibt dort über `t_nachricht_mandant` + `p_beteiligt` via `absender_benutzer_id`).

## Gebaute Adressen

- `/portal/[mandant]/aufgaben` — fertig
  - Liste nach FRIST sortiert, offene zuerst (wie der Lead-Posteingang). Filter: nur meine / nur offene / je Bezugsart / auch erledigte. Kopfzeile zaehlt offene und ueberfaellige. Anlegeformular (Titel, Beschreibung, Prioritaet, Faelligkeitstag). Bezug als Link auf Auftrag, Objekt oder Lead — und nur dann, wenn RLS die Zeile hergibt (sonst Art ohne Verweis, AUT-06). Herkunft je Zeile: mensch/Waechter plus quelle_job. Leerzustand als Hinweis, nicht als leere Tabelle.
- `/portal/[mandant]/aufgaben/[id]` — fertig
  - Kopf mit Status-Pille, Ueberfaellig-Pille, Frist (UTC gespeichert, Europe/Berlin gezeigt), Prioritaet, Zustaendige(r)/Team, aufgeloester Bezug. Abschnitt Herkunft mit quelle/quelle_job/job_lauf_id und Erledigungs- bzw. Abbruchbeleg. Aktionen als POST an /api/aufgaben: Status setzen, zuweisen (nur mit aufgabe.zuweisen, sonst sichtbarer Hinweis statt Formular), erledigen (now() + Sitzungsbenutzer serverseitig), abbrechen mit Pflichtgrund. Unbekannte oder fremde id: 404, nie 403.
- `/portal/[mandant]/nachrichten` — fertig
  - Fadenposteingang: EIN Kopf je thread_id mit Betreff der Wurzel, Auszug, letzter Absender, Richtung/Kanal/Zustellstand, Zeilenzahl, letzte Aktivitaet und eigener Ungelesen-Zahl. Filter: Richtung, nur ungelesen. Formular fuer einen neuen INTERNEN Faden. Oben steht der wahre Anbindungsstand aus registry/integrationen (E-Mail und SMS nicht verbunden, O-36) — kein simulierter Versand.
- `/portal/[mandant]/nachrichten/[id]` — fertig
  - [id] IST die thread_id (festgelegt, nicht offen). Faden in Zeitfolge mit Absender (Benutzer/Agent/extern), Richtung, Kanal, Zeitpunkt in Europe/Berlin, Anhaengen und Empfaengern. An jeder AUSGEHENDEN Zeile der UWG-Beleg: rechtsgrundlage, zweck, Freigabelink, Zustellstand. Anhang- und Freigabelink nur mit dokument.lesen bzw. freigabe.entscheiden (sonst Name ohne Verweis, D-567). Gelesen-Stempel per POST, nie GET (D-504). Antwortfeld; Faden schliessen und wieder oeffnen statt loeschen.
- `/.well-known/security.txt` — fertig
  - Handler mit text/plain, force-dynamic. Der Dienst liest plattform_einstellung['sicherheit.kontakt'] (optional 'sicherheit.richtlinie'); ohne gesetztes Postfach gibt er null zurueck und der Handler antwortet 404 — SEITENKARTE §2.5 verbietet die Veroeffentlichung ohne gelesenes Postfach (O-35). Mit Postfach: Contact (RFC-9116-URI, eine nackte Mailadresse wird abgewiesen), Expires = Serveruhr + 12 Monate, Preferred-Languages: de, en, Canonical aus derselben Hostquelle wie sitemap/robots. Nebenbei korrigiert: scripts/seitenkarte/extrahiere.ts stufte die Route wegen des Wortes 'route handler' als sitzungspflichtig ein — jetzt 'infrastruktur'; routen.generiert.ts neu erzeugt, genau eine Zeile geaendert.
- `/leistungen/[slug] (+ /en/leistungen/[slug])` — teilweise
  - Seite duenn wie [seite]/page.tsx: Slugform pruefen, unbekannt -> 404 (nie leere Seite), sonst OeffentlicheSeite. Kanonisch ist die EIGENE Adresse (eigene seite-Zeile je Sprache), Metadaten ueber metadatenFuer samt hreflang. Der Service-JSON-LD-Block entsteht in seiten-daten.ts (nicht in der Seite) ueber die neue Funktion seitenService(); provider bleibt WEG, solange niemand entschieden hat, welche Gesellschaft welche Leistungsseite verantwortet — Platzhalter nach Regel 1 (O-652). Sitemap braucht keine Ergaenzung: sitemapEintraege liest jede veroeffentlichte seite-Zeile. Teilweise, weil die ZEILEN Redaktion sind: es gibt heute keine seite-Zeile unter /leistungen/, die Route antwortet also 404 bis eine angelegt ist.
- `/news/[slug] (+ /en/news/[slug])` — fertig
  - Gesellschaft fest operations (§2.2), oeffentlicherBeitragNachSlug, null -> notFound (Entwurf und nicht vorhanden sehen gleich aus). BeitragDetail in einer eigenen Gruppenhuelle statt ProfilRahmen (auf Gruppenebene gibt es keinen Gesellschaftsdeckel). rel=canonical auf /unternehmen/operations/news/<slug>, auch sichtbar als Satz unter dem Text. Nicht in der Sitemap — dort steht die kanonische Adresse.
- `/projekte/[slug] (+ /en/projekte/[slug])` — fertig
  - ReferenzAusTabelle.nachSlug(operationsId, slug), null -> notFound (eine Referenz ohne Kundenfreigabe und eine nicht vorhandene sehen von aussen gleich aus, PRO-05). ProjektDetail zeigt Titel, Kunde soweit freigegeben, Jahr, Beschreibung, freigegebene Bilder — nie Auftragswert, kunde_id oder Anschrift. rel=canonical auf /unternehmen/operations/projekte/<slug>.
- `/werbewiderspruch/[token]` — fertig
  - Die Seite; Tabellen, Definer und der POST-Handler kommen von der Domaene datenschutz (0222, services/datenschutz/werbewiderspruch.ts, api/werbewiderspruch) — ich habe meine eigene Fassung des Dienstes und des Handlers wieder entfernt, damit es nicht zwei Umsetzungen derselben Rechtsfrage gibt. Die Seite: metadata robots noindex/nofollow, POST-Knopf (kein GET — ein Mailscanner loeste sonst fremde Widersprueche aus), GET verraet fuer JEDEN formgueltigen Token dasselbe (kein Existenzorakel), drei Ergebnislagen erfasst/bereits/unbekannt, Hinweis dass vertragliche Post weiterlaeuft, und der § 7 Abs. 3 Nr. 4 UWG-Satz als sichtbar VORLAEUFIGER Platzhalter mit TODO(client, O-34). Zusaetzlich: /werbewiderspruch in AUSGESCHLOSSEN aufgenommen (robots + Sitemap) — die Sperre fehlte, obwohl die Karte sie fuehrt, und die Tokenadressen lagen in einer Flaeche, die als gesperrt beschrieben war.
- `Zusatz: Sitemap-Luecke PUB-10` — teilweise
  - Die Sitemap fuehrte ausschliesslich seite-Zeilen; kein veroeffentlichter beitrag und keine freigegebene referenz stand darin, obwohl §2.5 es verlangt. Neu: detailEintraege() liefert die KANONISCHEN Adressen /unternehmen/<bereich>/news/<slug> und /unternehmen/<bereich>/projekte/<slug>. Ohne alternates, weil beitrag und referenz keine sprache tragen — ein hreflang='en' auf denselben deutschen Text behauptete eine Uebersetzung, die es nicht gibt. Ohne lastModified, wo kein Zeitstempel da ist (kein 'heute' als Ersatz, R-11). Teilweise: stelle (Karriere) fehlt weiter — das gehoert dem Recruiting-Modul und O-512.
- `Zusatz: Seed` — fertig
  - seedKern(sql): je Gesellschaft ein Team mit bis zu drei Mitgliedschaften (anstellung_id + festgenagelte person_id), drei Aufgaben (eine ueberfaellig, eine heute faellig, eine ohne Frist und ohne Bezug — der Waechterfall) an vorhandenen auftrag-/lead-Zeilen, und ein interner Faden mit Antwort. Idempotent geprueft (zweiter Lauf: 0/0/0/0) gegen echtes Postgres. Nichts behauptet 'gesendet'.

## Sonstiges

// ============================================================================
// A) Zentrale Dateien, die ich SELBST geaendert habe — zur Kenntnis
// ============================================================================
// Aus dem Bauschritt (unveraendert):
// · scripts/seitenkarte/extrahiere.ts — „route handler" ohne Rechteschluessel
//   ergibt jetzt `infrastruktur` statt `sitzung`; `/.well-known/security.txt`
//   hinter einer Anmeldung erfuellt seinen Zweck nicht
// · src/server/registry/routen.generiert.ts — neu erzeugt (1 Zeile Delta, 55)
// · src/server/services/inhalt/sitemap.ts — `/werbewiderspruch` in
//   AUSGESCHLOSSEN und die Funktion `detailEintraege()` (PUB-10)
// · src/app/sitemap.ts — `detailEintraege()` eingehaengt
// · src/server/services/inhalt/jsonld.ts — Funktion `seitenService()`
// · src/server/inhalt/seiten-daten.ts — `istLeistungsseite()`, die
//   Besitzerabfrage NUR fuer `/leistungen/<slug>`, der `Service`-Block
// · src/lib/sprache.ts — `/werbewiderspruch` in NUR_DEUTSCH
// · tests/kern/routen-manifest.test.ts — die eingefrorene „offen"-Liste ist um
//   `/leistungen/[slug]`, `/news/[slug]`, `/projekte/[slug]` GESCHRUMPFT
// · src/server/db/seed/index.ts — Import und Aufruf `seedKern(sql)`
// · scripts/generate-triggers.ts — zwei Zeilen in MIGRATIONS_DATEIEN
//
// NEU in diesem Behebungsschritt:
// · src/server/services/inhalt/sitemap.ts — `detailEintraege()` leitet das
//   Segment aus `beitrag.art` ab statt zwei Arten wegzufiltern, mit
//   `NEUIGKEITS_ARTEN` als SQL-Parameter (eine Liste, nicht zwei)
// · src/server/services/social/dienst.ts — neue Funktion `beitragSegment(art)`
//   neben `NEUIGKEITS_ARTEN`; die EINE Stelle, die Sitemap und Seite fragen
// · src/app/(public)/unternehmen/[bereich]/_profil/kanonik.ts — NEU,
//   `beitragsMetadaten(bereich, slug, sprache)`
// · src/app/(public)/{,en/}unternehmen/[bereich]/{news,beitraege}/[slug]/page.tsx
//   — alle vier rufen jetzt `beitragsMetadaten` und setzen `canonical`
// · src/server/db/seed/inhalt.ts — `LEISTUNGSSEITEN` (+ TODO(client, O-652))
// · src/server/db/seed/inhalt-en.ts — `LEISTUNGSSEITEN_EN` (+ TODO)
// · scripts/content-import.ts — Funktion `leistungen()`, beide Listen angehaengt
// · src/server/db/seed/kern.ts — dreistufige Kontosuche (alle vier
//   Gesellschaften), Empfaengerzeile faellt auf `empfaenger_typ='benutzer'` zurueck
//
// ============================================================================
// B) Was NICHT meine Domaene ist, was ich aber beim Beheben gemessen habe
// ============================================================================
// 1. `pnpm db:seed` bricht ab: „new row violates row-level security policy for
//    table leistungskatalog_position" (42501), in `seedSonderUndQualitaet`
//    (seed/index.ts:1605) — also VOR `seedKern` (1748). Die Ursache liegt in
//    der noch nicht eingecheckten Arbeit der Domaene
//    reinigung-security-qualitaet (drizzle/0298_leistungskatalog_status.sql,
//    services/katalog/*, services/reinigung/sonderleistung.ts). Folge fuer
//    ALLE: `pnpm db:seed` und damit `tests/isolation/global-setup.ts` (baut
//    seine Vorlagen mit genau diesem Seed) laufen nicht durch.
// 2. `src/server/services/radar/profil.ts` trug zeitweise einen Syntaxfehler
//    (Backticks INNERHALB eines Template-Literals, ~Zeile 397-405), der
//    `pnpm typecheck` mit TS1005 abbrach. Inzwischen behoben — `pnpm typecheck`
//    ist jetzt ueber das ganze Projekt sauber (0 Fehler).
// 3. `tests/kern/verweis-rechte.test.ts` ist rot mit 12 Befunden — KEINER in
//    meiner Domaene (datenschutz, einstellungen, finanzen, objekte, zeiten).
// 4. `drizzle/0222_werbewiderspruch.sql` (Domaene datenschutz) traegt weiter
//    `nachricht_id uuid references nachricht(id)` — einspaltiger FK auf eine
//    Tabelle mit `mandant_id` (K-16/§1.11, Existenzorakel). Richtig waere
//    `foreign key (mandant_id, nachricht_id) references nachricht (mandant_id, id)`;
//    `nachricht_mandant_id_uk` existiert seit 0011.
//
// ============================================================================
// C) Testlage nach dem Behebungsschritt
// ============================================================================
// · `pnpm typecheck`: 0 Fehler (ganzes Projekt)
// · eslint ueber alle beruehrten Pfade: sauber
// · gruen: tests/kern/{oeffentliche-detailwege (13),gruppen-kanonik,
//   aufgabe-frist,sicherheit-txt,seo,jsonld,sprachpfade,annahmen,
//   api-verdrahtung,rumpf-form,wachen,zustandsseiten,quelltext,
//   routen-manifest} = 141 Faelle; tests/design/* = 58 Faelle
// · rot, bis die Register gepflegt sind: tests/kern/routen.test.ts,
//   tests/kern/portal-shell.test.ts, Wache `todo-client-nicht-im-register`
// · Migration: `drop database w_aufg` / `create` / `db:migrate` zweimal
//   fehlerfrei; `p_aufgabe_kunde_decke` steht danach auf
//   `with check (app.portal() <> 'kunde')`
// · Isolationssuite NICHT gelaufen (siehe B1); die zwei neuen Faelle von Hand
//   gegen echtes Postgres 16 als `cse_app` mit FORCE RLS nachgewiesen

## Zeilen für docs/DECISIONS.md, Abschnitt „Offen“ — ERLEDIGT (18.09.2026)

Eingetragen heisst gelöscht. Die 3 Zeilen dieser Domäne stehen in
`docs/DECISIONS.md` unter „Open — ask, do not guess“, Unterabschnitt
„Raised while building · die Domänenwelle (Routenbau)“. Hier ist nichts mehr offen.

## Befunde des Prüfers (13)

- **wichtig** · `/home/user/cse-platform/drizzle/0230_kern_team_aufgabe.sql` — Die restriktive Decke `p_aufgabe_kunde_decke` traegt `with check (app.portal() = 'intern')` statt `<> 'kunde'`. Eine restriktive WITH-CHECK-Bedingung muss bei jedem INSERT/UPDATE wahr sein — `app.portal()` liefert im `person`-Scope fest 'mitarbeiter' und im Mandanten-Scope das Portal der Mitgliedschaft. Damit ist JEDER Schreibvorgang eines Mitarbeiterkontos auf `aufgabe` abgewiesen, obwohl 03-AUTH-BERECHTIGUNGEN.md:2441 der Rolle `mitarbeiter` genau `aufgabe.schreiben` gibt („completing an assigned task; granted, ceiling-narrowed"). Die Policy heisst „kunde_decke" und tut etwas anderes als ihr Kommentar sagt. Die Schwestermigration 0231 hat den Fehler nicht: dort schreibt ein Mitarbeiterkonto (t_nachricht_mandant + p_beteiligt ueber `absender_benutzer_id`).
  - Behebung: `with check (app.portal() <> 'kunde')` — dieselbe Form wie 0192/0201; die Verengung auf das Zugewiesene leistet bereits `p_zustaendig` (dessen USING bei fehlendem WITH CHECK auch als WITH CHECK gilt). Dazu ein Isolationsfall „ein Mitarbeiterkonto erledigt die ihm zugewiesene Aufgabe" mit `readonly: false`.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/aufgaben/page.tsx` — Das Anlegeformular wird ohne Rechtepruefung gerendert. Die Route traegt nur `aufgabe.lesen` (routen.generiert.ts:111), also erreicht ein reines Lesekonto die Seite, sieht „Neue Aufgabe", drueckt „Anlegen" und bekommt vom `authorize`-Aufruf in api/aufgaben eine nackte 404-JSON-Antwort ohne Erklaerung. Dasselbe in nachrichten/page.tsx:186 („Neuer interner Faden" ohne `nachricht.versenden`-Pruefung). Beide Detailseiten der eigenen Domaene machen es richtig — das ist also kein bewusster Entwurf, sondern eine Auslassung.
  - Behebung: In derselben gebundenen Transaktion `app.hat_recht('aufgabe.schreiben', app.aktiver_mandant())` bzw. `app.hat_recht('nachricht.versenden', app.aktiver_mandant())` mitlesen und das Formular durch denselben sichtbaren Hinweis ersetzen, den aufgaben/[id]/page.tsx bei fehlendem `aufgabe.zuweisen` zeigt.
- **wichtig** · `/home/user/cse-platform/src/app/api/aufgaben/route.ts` — `bezugTyp` kommt ungeprueft aus dem Rumpf in einen Enum-Cast. `prioritaet` wird gegen PRIORITAETEN geprueft, `faelligDatum` gegen TAG — `bezugTyp` gegen nichts. Ein POST mit `bezugTyp=foo` erreicht `$11::bezug_typ` in `legeAn()` und wirft 22P02; der Fehler ist keine der drei gefangenen Klassen und endet als 500. `bezugTyp` ohne `bezugId` verletzt `aufgabe_bezug_paarweise` (23514) — ebenfalls 500. Derselbe Cast ohne Whitelist steht im Dienst fuer den Seitenfilter: `?bezug=foo` passt auf `/^[a-z_]+$/` (aufgaben/page.tsx:98) und gibt eine 500-Seite statt einer leeren Liste. Auch `faelligDatum=9999-99-99` passt auf TAG und stirbt an `::date`.
  - Behebung: Die 26 Werte als `export const BEZUG_TYPEN` in services/kern/aufgabe.ts fuehren (sie stehen schon im Enum von 0230), in der Route und im Seitenfilter dagegen pruefen, `bezugTyp` ohne `bezugId` mit 400 abweisen und das Datum mit `Number.isNaN(Date.parse(...))` nachpruefen.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/aufgaben/page.tsx` — Die Kopfzahl widerspricht der Liste darunter. `offenGesamt` kommt aus `zaehleJeZustand()`, das gar keinen Filter kennt, waehrend `ueberfaellig` aus den GEFILTERTEN `zeilen` gerechnet wird. Mit „Nur meine" oder einem Bezugsfilter steht oben z. B. „12 offen" ueber einer Liste mit einer Zeile — und „1 ueberfaellig" daneben, also zwei Zahlen auf zwei verschiedene Grundmengen. Genau die Kopfzeile ist die DSH-01-Auskunft, auf die jemand reagiert.
  - Behebung: `zaehleJeZustand` denselben `AufgabeFilter` uebergeben (die WHERE-Bausteine existieren bereits in `listeAufgaben`) — oder die Zahl im Text ausdruecklich als Gesamtstand der Gesellschaft kennzeichnen und die Ueberfaelligen genauso ungefiltert zaehlen.
- **wichtig** · `/home/user/cse-platform/src/server/db/seed/kern.ts` — Der Seed bedient nur drei der vier Gesellschaften. `seedKern` sucht Konten mit `r.schluessel in ('admin','leitung')`; `operations` hat kein solches Konto, also entstehen dort kein Team, keine Aufgabe und kein Faden. Der Bericht behauptet „je Gesellschaft ein Team … drei Aufgaben … und ein interner Faden". `/portal/operations/aufgaben` und `/portal/operations/nachrichten` zeigen damit nur den Leerzustand — und zwar bei genau der Gesellschaft, die nach SEITENKARTE §2.2 die oeffentlichen Gruppenseiten traegt, also am haeufigsten angesehen wird.
  - Behebung: Wenn keine admin/leitung-Mitgliedschaft existiert, auf ein beliebiges aktives Nicht-Dienstkonto der Gesellschaft bzw. auf `benutzer.globale_rolle_id = super_admin` zurueckfallen — und die Zaehlung im Bericht/Register auf den tatsaechlichen Umfang korrigieren.
- **wichtig** · `/home/user/cse-platform/src/app/(public)/leistungen/[slug]/page.tsx` — Die Route hat keine einzige Datenzeile und antwortet fuer jeden Slug 404 — der Plan verlangte dafuer ausdruecklich Seed-Bestand. Damit laufen `istLeistungsseite()`, die `besitzer`-Abfrage und der neue `seitenService()`-JSON-LD-Block nie: der Service-Block ist zur Laufzeit ungetestet, obwohl er als fertig gemeldet ist, und die englische Zwillingsseite ebenso.
  - Behebung: Je Sprache eine als Demonstrationsbestand benannte `seite`-Zeile unter `/leistungen/<slug>` seeden (mandant_id NULL, `ist_vorlaeufig`-Hinweis im Text, Verweis auf O-652) — dann traegt die Route echte Zeilen und der Service-Block wird ausgefuehrt.
- **wichtig** · `/home/user/cse-platform/docs/DECISIONS.md` — Die drei offenen Fragen, auf die der neue Code zeigt, stehen nirgends: O-650, O-651 und O-652 sind in DECISIONS.md nicht vorhanden. CLAUDE.md verlangt fuer jede offene Regel „Record it in docs/DECISIONS.md under 'Open'" und nennt es in der Definition of done. Der Bericht liefert Registertext fuer dienste.ts, route-manifest.ts, navigation.ts und rls.ts — aber keine DECISIONS-Zeilen. Damit verweisen drei TODO(client)-Marken im Baum auf Nummern, die kein Mensch nachlesen kann, und die naechste Domaene kann dieselbe Nummer neu vergeben.
  - Behebung: Drei Zeilen unter „Open" mit wortgleicher Fragestellung aus 0230:142, 0231:548 und jsonld.ts:193 aufnehmen, bevor die Nummern anderswo wiederverwendet werden.
- **wichtig** · `/home/user/cse-platform/src/server/auth/route-manifest.ts` — Die drei neuen Handler stehen in keinem Register, und die vorhandene Wache ist dadurch rot. `tests/kern/routen.test.ts` faellt mit einer Liste fehlender Routen, darunter `api/aufgaben`, `api/nachrichten` und `.well-known/security.txt`. Ebenso fehlen `kern/aufgabe`/`kern/nachricht`/`inhalt/sicherheit-txt` in registry/dienste.ts, die zwei Menuepunkte in registry/navigation.ts und die fuenf Loeschsperren in db/schema/rls.ts. Solange rls.ts die fuenf Eintraege nicht hat, wuerde `pnpm db:triggers` die erzeugten Bloecke am Ende von 0230 und 0231 wieder entfernen — also genau die Loeschsperren, die den Nachweis tragen. Der Sicherungscommit delegiert das ausdruecklich zentral; die Domaene ist bis dahin aber nicht abgeschlossen.
  - Behebung: Die vier gelieferten Registertexte einsetzen. Die `grund`-Strings sind geprueft und stimmen zeichengenau mit den erzeugten Bloecken in 0230 (team, aufgabe) und 0231 (nachricht, nachricht_empfaenger, nachricht_anhang) ueberein, `db:triggers` wird sie also nicht umschreiben.
- **wichtig** · `/home/user/cse-platform/src/server/services/inhalt/sitemap.ts` — `detailEintraege()` schliesst zwei von vier Beitragsarten aus und laesst sie damit sitemaplos. Gemeldet werden nur `neuigkeit` und `aktualisierung` unter `/unternehmen/<bereich>/news/<slug>`; ein veroeffentlichter Beitrag der Art `beitrag` oder `projektschau` ist oeffentlich erreichbar (die Detailroute `/unternehmen/[bereich]/beitraege/[slug]` liest ueber `oeffentlicherBeitragNachSlug`, das GAR KEINEN Artfilter hat) und steht in keiner Sitemap. SEITENKARTE §2.5 verlangt „every published seite, referenz, social_post, news". Erschwerend: `/unternehmen/<b>/news/<slug>` und `/unternehmen/<b>/beitraege/<slug>` liefern dieselbe Zeile und setzen beide KEIN `canonical` — die neue Sitemap erklaert also eine von zwei ununterschiedenen Adressen zur einen.
  - Behebung: Das Segment aus der Art ableiten (`neuigkeit|aktualisierung` → `news`, sonst `beitraege`) statt die anderen Arten wegzufiltern, und auf den zwei Gesellschaftsdetailseiten `alternates.canonical` auf die jeweils gemeldete Adresse setzen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/nachrichten/[id]/page.tsx` — Der Knopf „Als gelesen markieren" haengt am Lesestand FREMDER Empfaenger. `ungelesen` prueft jede Empfaengerzeile des Fadens, und im internen Portal gibt `ladeFaden` alle Empfaenger der Gesellschaft heraus. Der Knopf erscheint also, solange irgendwer den Faden nicht gelesen hat; der POST trifft dann null eigene Zeilen, und die Seite meldet trotzdem „Gespeichert." Umgekehrt ist der eigene Ungelesen-Stand in der Liste korrekt berechnet — die Detailseite benutzt ihn nur nicht.
  - Behebung: `ladeFaden` eine eigene `ungelesen`-Zahl mitgeben (dieselbe Bedingung wie in der CTE von `listeFaeden`) und den Knopf daran haengen; den Rueckgabewert von `markiereGelesen` fuer die Erfolgsmeldung nutzen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/aufgaben/page.tsx` — Die Fristspalte formatiert `faellig_am` ohne Jahr. Eine seit einem Jahr ueberfaellige Aufgabe liest sich als „14.06. 16:00" und ist von einer Frist in zwei Tagen nicht zu unterscheiden. Die Detailseite derselben Domaene zeigt das Jahr (`dateStyle: 'medium'`).
  - Behebung: `year: '2-digit'` ergaenzen oder dieselbe `dateStyle`/`timeStyle`-Kombination wie auf der Detailseite verwenden.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/nachrichten/page.tsx` — Der Anbindungshinweis nennt nur die offene Frage des ERSTEN unverbundenen Kanals. Im selben Satz werden E-Mail und SMS als nicht verbunden aufgezaehlt, danach steht `(offen O-36)` — die offene Frage der SMS-Anbindung (O-82) faellt weg, obwohl das Register sie fuehrt.
  - Behebung: Die offene Frage je Kanal ausgeben, also in derselben `map`, die schon „E-Mail: nicht verbunden · SMS: nicht verbunden" zusammensetzt.
- **klein** · `/home/user/cse-platform/docs/architecture/routenbau/register/aufgaben-nachrichten-oeffentlich.md` — Zwei Aussagen im Bericht/Register sind sachlich falsch und wuerden doppelte Arbeit ausloesen. (1) „`/werbewiderspruch` (tokenlos) … die Seite existiert heute nicht, der tokenlose Weg endet damit auf 404" — die Seite existiert, im gleichen Commit, und die drei Rueckmeldezustaende passen exakt zur Tokenseite. (2) `tests/kern/gruppen-kanonik.test.ts` ueberschreibt einen Block mit „alle sechs Seitendateien", listet in `SEITEN` aber vier; die beiden leistungen-Dateien stehen in einem zweiten `it.each`. Ausserdem meldet der Bericht 21 bzw. „je Gesellschaft", tatsaechlich sind es 23 Isolationsfaelle bzw. drei von vier Gesellschaften.
  - Behebung: Die Registerzeile auf den tatsaechlichen Stand korrigieren (tokenloser Weg vorhanden, Zustaende stimmen ueberein), die Testbeschreibung auf „alle sechs" oder „vier" angleichen und die Zaehlungen im Bericht berichtigen.

**Urteil:** Handwerklich ueberwiegend solide: alle 36 gemeldeten Dateien existieren, `npx tsc --noEmit` hat in dieser Domaene NULL Fehler (der einzige Treffer liegt in kundenportal/zahlung.ts, fremde Domaene), die vier Unit-Dateien laufen gruen (49 Faelle) und beide Isolationsdateien gegen echtes Postgres ebenfalls (23 + 22). Ich habe jede Abfrage der beiden Dienste, des Sitemap-Dienstes und aller Schreibpfade einzeln per `prepare` gegen die migrierte Datenbank `w_aufg` geparst — kein falscher Spaltenname, kein falscher Enum-Vergleich, kein fehlender Cast. Die Seiten tragen echte Zeilen (Seedlauf: 3 Teams, 9 Aufgaben, 3 Faeden), alle sechs Bezugsziele der Aufloeserliste existieren als Route, Zeit wird durchgehend als `timestamptz` gehalten und nur zur Anzeige nach Europe/Berlin gedreht (`fristlage()` ist mit beiden Umstellungsnaechten geprueft), Geldspalten gibt es hier keine, Rechte werden serverseitig geprueft und muenden in 404, der Aussenversand wirft vor dem Schreiben statt Erfolg zu behaupten, und die Gestaltungswerte kommen aus dem vorhandenen Satz (`tracking-[0.08em]` 234x im Baum, `ok`/`mail` im geschlossenen Iconsatz, `Überfällig` im PillZustand-Typ).

Dennoch dreizehn Befunde, und einer davon haette teuer werden koennen: `p_aufgabe_kunde_decke` (0230:453) traegt `with check (app.portal() = 'intern')` statt `<> 'kunde'` und verriegelt damit still JEDEN Schreibvorgang eines Mitarbeiterkontos auf `aufgabe` — genau das, was 03-AUTH §12.7 der Rolle mit `aufgabe.schreiben` gibt. Es ist die einzige der 43 `*_kunde_decke`-Policies im Baum mit dieser Form, die Schwestermigration 0231 hat den Fehler nicht, und kein Test faellt darauf, weil alle Mitarbeiterfaelle lesend laufen. Dazu drei Luecken, die den „fertig\"-Anspruch einschraenken: die Anlegeformulare beider Listenseiten sind nicht gegen das Schreibrecht abgesichert (die Detailseiten derselben Domaene machen es vor), `bezugTyp` erreicht ungeprueft einen Enum-Cast und ergibt 500 statt 400, und die Kopfzahl der Aufgabenliste rechnet ungefiltert ueber eine gefilterte Liste. Ausserhalb des Codes fehlt die Buchfuehrung: O-650, O-651 und O-652 stehen in keiner Zeile von DECISIONS.md, `/leistungen/[slug]` hat entgegen dem Plan keine Seed-Zeile und antwortet fuer jeden Slug 404 (der neue Service-JSON-LD ist damit zur Laufzeit ungetestet), der Seed bedient drei von vier Gesellschaften, und die Sitemap laesst zwei der vier Beitragsarten aus, obwohl sie oeffentlich erreichbar sind. Die fehlenden Registereintraege (routen.test.ts ist rot) sind laut Sicherungscommit zentral delegiert, bleiben aber Voraussetzung dafuer, dass `db:triggers` die Loeschsperren in 0230/0231 nicht wieder entfernt — die gelieferten `grund`-Texte habe ich gegen die erzeugten Bloecke geprueft, sie stimmen zeichengenau.

## Vom Behebenden WIDERLEGT (Befund war falsch)

- **Teilbefund in Befund 13 (klein):** der Prüfer schreibt, beim tokenlosen `/werbewiderspruch` „passen die drei Rueckmeldezustaende exakt zur Tokenseite". Das stimmt nicht — es sind zwei VERSCHIEDENE Mengen, und jede passt zu ihrem Weg. `src/app/api/werbewiderspruch/route.ts:38-42,80-93` leitet den tokenlosen Weg mit `entgegengenommen | email_ungueltig | ohne_gesellschaft` zurück, und genau diese drei Schlüssel führt `MELDUNG` in `src/app/(public)/werbewiderspruch/page.tsx:61-78`. Die Tokenseite dagegen kennt in `STAENDE` `erfasst | bereits | unbekannt` (`src/app/(public)/werbewiderspruch/[token]/page.tsx:63`), passend zu `Einloesung` in `services/datenschutz/werbewiderspruch.ts:143-150`. Der SCHLUSS des Prüfers ist richtig (es ist nichts zu bauen, die Registerzeile war falsch) und die Zeile ist korrigiert — die Begründung war es nicht, und ein „die Zustände sind dieselben" hätte den nächsten dazu verleitet, die beiden Mengen zusammenzulegen.

## Nach der Behebung noch offen

- **Registereinträge und DECISIONS-Zeilen stehen weiter aus** — `registry/dienste.ts`, `auth/route-manifest.ts`, `registry/navigation.ts`, `db/schema/rls.ts` und `docs/DECISIONS.md` sind die gemeinsamen Dateien, die ich nicht anfasse. Bis sie gepflegt sind, bleiben `tests/kern/routen.test.ts` („keine Route fehlt im Manifest": `.well-known/security.txt`, `api/aufgaben`, `api/nachrichten`), `tests/kern/portal-shell.test.ts` („das Register kennt jeden Dienst": `kern/aufgabe`, `kern/nachricht`, `inhalt/sicherheit-txt`) und die Wache `todo-client-nicht-im-register` (O-650/651/652) rot — nachgemessen, und es sind genau die Zusagen, die diese Tests tragen sollen. Die `grund`-Strings für rls.ts habe ich nach meiner 0230-Änderung erneut gegen die erzeugten Blöcke gehalten: sie stimmen zeichengenau, `pnpm db:triggers` schreibt sie nicht um.
- **Die Isolationssuite liess sich in diesem Baum nicht fahren** (siehe `notizen`): `pnpm db:seed` bricht in einer FREMDEN Domäne ab, und `tests/isolation/global-setup.ts` baut seine Vorlagen mit genau diesem Seed. Die zwei neuen Fälle in `tests/isolation/aufgabe.test.ts` habe ich deshalb von Hand gegen echtes Postgres 16 als `cse_app` mit FORCE RLS nachgewiesen, mit derselben GUC-Bindung, die `alsApp()` setzt — beide Richtungen, siehe Befund 1. Der Lauf selbst ist nachzuholen, sobald der Seed wieder durchläuft.
- **`/leistungen/[slug]` trägt Demonstrationsbestand, keine Redaktion.** Eine Zeile je Sprache, klar als vorläufig benannt, damit die Route und der `Service`-Block wirklich ausgeführt werden; `Service.provider` bleibt WEG. Welche Leistungen eine eigene Seite bekommen und welche Gesellschaft sie verantwortet, ist O-652 und gehört dem Auftraggeber. Jede andere Adresse unter `/leistungen/` antwortet weiter 404 — richtig, nicht leer.

## NICHT gebaut, mit Grund

- /werbewiderspruch (tokenlos) — nicht in meiner Routenliste. Der Handler der Domaene datenschutz leitet aber dorthin (?stand=entgegengenommen|email_ungueltig|ohne_gesellschaft); die Seite existiert heute nicht, der tokenlose Weg endet damit auf 404. Gehoert zur Domaene datenschutz.
- /portal/gruppe/nachrichten und /portal/gruppe/aufgaben — die Seitenkarte fuehrt sie in §6 nicht; die Lesepolicies (gruppe.aufgabe.lesen, gruppe.nachricht.lesen) stehen und sind geprueft, aber ein Menuepunkt auf eine Seite, die es nicht gibt, ist D-561.
- /portal/[mandant]/team — es gibt keine Routenzeile dafuer. team und team_mitglied sind angelegt, geseedet und im Mitarbeiterportal sichtbar; eine Pflegeoberflaeche fehlt und gehoert zur Kalender-/Stammdatendomaene.
- kalender_eintrag / kalender_teilnehmer nach §7.3/§7.4 — nicht meine Tabellen (0160 fuehrt eine eigene, einfachere Fassung). team/team_mitglied sind so gebaut, dass kalender_eintrag.team_id sie per zusammengesetztem FK nutzen kann.
- Aussenversand von Nachrichten — kein Versender verbunden (O-36). sendeNachAussen() ist vollstaendig gebaut, wirft aber VersandNichtVerbundenFehler BEVOR es schreibt; die Oberflaeche sagt 'nicht verbunden'.
- Sitemap-Eintraege fuer offene stelle-Zeilen (Karriere) — gehoert dem Recruiting-Modul und haengt an O-512.
- benachrichtigung / benachrichtigung_praeferenz nach §7.8 — 0011 fuehrt eine aeltere, funktionierende Fassung; anzufassen haette den gebauten Posteingang gebrochen (Do not break what works).

## Notizen des Bauender

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

## Notizen des Behebender

Alle 13 Befunde nachvollzogen; 12 trafen zu und sind an der Ursache behoben, bei einem (klein, Nr. 13) ist der Schluss richtig und die Begruendung falsch — die Registerzeile ist korrigiert, die falsche Begruendung unter „widerlegt" belegt.

ZWEI FREMDE BAUSTELLEN haben die Pruefung eingeschraenkt, beide nicht meine Domaene:

(1) `pnpm db:seed` bricht mit `new row violates row-level security policy for table "leistungskatalog_position"` (42501) in `seedSonderUndQualitaet` ab — seed/index.ts:1605, also VOR `seedKern` (1748). Ursache ist die noch nicht eingecheckte Arbeit der Domaene reinigung-security-qualitaet (`drizzle/0298_leistungskatalog_status.sql`, `src/server/services/katalog/*`, `services/reinigung/sonderleistung.ts`). Ich habe sie NICHT angefasst — ein zweiter Agent schreibt dort gerade. Folge: `tests/isolation/global-setup.ts` baut seine Vorlagen mit genau diesem Seed und kommt daher nicht durch, die Isolationssuite liess sich nicht fahren. Ersatzweise habe ich `seedKern` einzeln gegen `w_aufg` gefahren (Ergebnis 4/9/12/4, zweiter Lauf 0/0/0/0) und die zwei neuen Isolationsfaelle von Hand gegen echtes Postgres 16 als `cse_app` mit FORCE RLS nachgewiesen — mit derselben GUC-Bindung, die `alsApp()` setzt, in beiden Richtungen (alte Policy weist ab, neue laesst durch, fremde Aufgabe bleibt bei UPDATE 0).

(2) `src/server/services/radar/profil.ts` trug zeitweise einen Syntaxfehler (Backticks innerhalb eines Template-Literals, ~397-405), der `pnpm typecheck` mit TS1005 abbrach. Inzwischen von der anderen Seite behoben; der abschliessende `pnpm typecheck` ist ueber das ganze Projekt sauber. Ich habe die Datei nicht beruehrt.

Grenzen eingehalten: keine Migrationsnummer ausserhalb 0230–0244 angelegt (nur 0230 inhaltlich korrigiert), `registry/*`, `route-manifest.ts`, `schema/rls.ts`, `docs/DECISIONS.md`, `04-SEITENKARTE.md`, die erzeugten Bloecke und `package.json` NICHT angefasst — alles davon steht als Eintrag hier. Kein `git commit`, kein `pnpm build`, keine volle Test-Suite.

GESTALTUNG: keine neuen Werte erfunden. Die zwei neuen Hinweise („anlegen-fehlt", „eroeffnen-fehlt") benutzen `mt-s3 max-w-prose text-sm text-text-muted` — zeichengleich mit dem vorhandenen `zuweisen-fehlt` in `aufgaben/[id]/page.tsx`. Die Fristspalte uebernimmt `dateStyle: 'medium'`/`timeStyle: 'short'` von der Detugsseite. Der neue Zustand „gelesen_schon" nutzt `Hinweis art="hinweis"` (Vorgabewert der Komponente) statt eines neuen Tons. `tests/design/*` (58 Faelle) gruen, die Tailwind-Farbwache eingeschlossen. In DESIGN.md fehlt nichts, was ich gebraucht haette.

GESCHAEFTSREGELN: nichts erfunden. Die drei offenen Fragen O-650/651/652 haben ihre `// TODO(client, O-NN)`-Marke mit der Nummer in DERSELBEN Zeile (0230:142, 0231:548, jsonld.ts:193, neu auch seed/inhalt.ts:642 und seed/inhalt-en.ts:524) und ihre DECISIONS-Zeile in diesem Ergebnis. `Service.provider` bleibt weg, die Demo-Leistungsseite nennt sich selbst vorlaeufig, und der Anbindungshinweis nennt jetzt je Kanal die nachlesbare offene Frage (O-36 fuer E-Mail, O-82 fuer SMS) statt nur die erste — kein simulierter Versand.

Die vollstaendige, aktuelle Warteschlange steht auch im Baum: `/home/user/cse-platform/docs/architecture/routenbau/register/aufgaben-nachrichten-oeffentlich.md` (auf den jetzigen Stand nachgezogen).
