# Registereintraege: stammdaten

Diese Eintraege hat der bauende Agent geliefert; sie sind **noch nicht** eingefuegt.
Die gemeinsamen Dateien pflegt EINE Hand, weil mehrere Agenten gleichzeitig im Baum
arbeiten und sich sonst in dieselbe Zeile schreiben. Ist ein Eintrag eingefuegt,
verschwindet er hier — diese Datei ist eine Warteschlange, kein Archiv.

## Migrationen (gegen eine eigene Datenbank gefahren: True)

- /home/user/cse-platform/drizzle/0275_stammdaten_katalogpflege.sql — Plattform-Schreibzweig fuer abwesenheitsart und antragsart (t_plattform_anlegen / t_plattform_aendern, nur app.ist_super_admin(), not app.ist_readonly(), antragsart zusaetzlich not ist_system). Antwort auf den ersten KRITIK-Punkt: t_katalog_pflege war die EINZIGE Schreibpolicy und hatte keinen Super-Admin-Zweig — die sieben Plattformarten waren fuer NIEMANDEN aenderbar, O-139 also durch keine Oberflaeche beantwortbar. Das Muster ist woertlich das von qualifikation (q_schreiben/q_aendern, 0030, 01-KERN §6.16) und keine neue Regel.
- /home/user/cse-platform/drizzle/0276_katalog_schluessel_kollision.sql — kern.katalog_schluessel_frei() (security definer, Eigentuemer cse_definer) + trg_abwesenheitsart_schluessel_frei / trg_antragsart_schluessel_frei, dazu die fehlende cse_definer-Lesepolicy at_definer auf antragsart. Schliesst die von der KRITIK gefundene Luecke: unique nulls not distinct (mandant_id, schluessel) erlaubt 'urlaub' plattformweit UND je Gesellschaft, waehrend leseAbwesenheitsarten/leseAntragsarten nur archiviert_am filtern — im Antragsformular stuenden zwei gleich aussehende Eintraege mit verschiedener Lohnfolge. Archivierte Zeilen geben den Schluessel frei.
- /home/user/cse-platform/drizzle/0277_belagsart_historie_lesen.sql — app.belagsart_historie_lesen() (stable, security definer, Eigentuemer cse_definer, prueft Portal 'intern' UND stammdaten.verwalten) plus grant select on belagsart to cse_definer und policy b_definer. Ohne sie ist die Historie mit Leistungswert nicht lesbar (K-05-Spaltenentzug), und app.leistungswerte_lesen gibt nur die Stichtagsscheibe und prueft objekt.lesen.
- /home/user/cse-platform/drizzle/0278_abwesenheitsart_schutz_definer.sql — kern.abwesenheitsart_schutz() als security definer mit Eigentuemer cse_definer, Rumpf unveraendert aus 0073. Eigener Befund: der Ausloeser prueft 'ist die Art benutzt' mit den Rechten des AUFRUFERS gegen abwesenheit (force RLS, t_mandant verlangt zeit.abwesenheit_lesen). Eine Pflegesitzung mit stammdaten.verwalten, aber ohne Abwesenheitsrecht, bekam dort false — die Sperre gegen das Umbenennen einer benutzten Art verschwand lautlos genau fuer die Sitzung, fuer die es sie gibt.

## Gebaute Routen

- `/portal/[mandant]/stammdaten/abwesenheitsarten` — fertig
  - Katalog + echter Schreibweg (anlegen/aendern/archivieren). bezahlt hat DREI Zustaende (ja/nein/ungeklaert mit O-139-Marke, nie stillschweigend nein), dazu zaehlt_auf_urlaubskonto, erzeugt_stundenkonto_bewegung, ist_gesundheitsbezogen, nachweis_pflicht_ab_tagen, lohnart_schluessel, farbe_token (nur DESIGN-Tokens) und bezeichnung_i18n fuer de/en/ar/tr. Plattformzeilen (alle 7) stehen mit dem Vermerk 'Plattformkatalog — hier nicht aenderbar' da; mit Super-Admin-Sitzung (aal2) sind sie pflegbar (Migration 0275) — das ist der Weg, auf dem O-139 ueberhaupt beantwortbar wird. Geloescht wird nie: archiviert_am.
- `/portal/[mandant]/stammdaten/antragsarten` — fertig
  - Liste mit Herkunft, Pflichtfeldern, Folgewirkung und Antragsbestand; Anlege-/Aenderungs-/Archivierungsweg fuer mandanteigene und (Super-Admin) plattformweite Arten. KRITIK umgesetzt: die sechs Schalter tragen je den ORT ihrer Wirkung — vier im Antragsformular (leseAntragsarten), erzeugt_abwesenheit erst bei der Entscheidung, ist_stammdatenaenderung ausschliesslich in kern.antrag_pflichtfelder. Systemzeilen (alle drei vorhandenen) sind fuer JEDEN gesperrt, mit Grund statt totem Knopf; die O-142-Marke steht vor der Liste. Dienstpruefung: erzeugt_abwesenheit verlangt Zeitraum UND Abwesenheitsart, sonst scheitert erst die Genehmigung an NOT NULL in abwesenheit.
- `/portal/[mandant]/stammdaten/belagsarten` — fertig
  - Heute gueltige Werte + Historie je Code + Umdatierung (laufende Fassung zum Vortag schliessen, neue ab gewaehltem Tag) + Richtigstellung ohne neue Fassung. Der Leistungswert ist cse_app spaltenweise entzogen (K-05), deshalb neuer Definer app.belagsart_historie_lesen() mit stammdaten.verwalten (0277) statt app.leistungswerte_lesen (objekt.lesen, nur Stichtagsscheibe). Rechtefalle aus der KRITIK aufgeloest: Lesen laeuft ueber den Definer, SCHREIBEN braucht zusaetzlich objekt.lesen (t_mandant USING) — fehlt es, sagt die Seite das und blendet die Formulare aus, statt beim Speichern abzuweisen. O-17 und O-349 stehen vor der Liste.
- `/portal/[mandant]/stammdaten/qualifikationen` — fertig
  - Katalog mit Kategorie (O-144), Rechtsgrundlage (Anzeigetext), laeuft_ab + standard_gueltigkeit_monate (leer = O-341), Warnstufen 60/30/7, blockiert_einsatz, erfordert_dokument (O-343) und Reichweite je Zeile (Nachweise / Posten-Anforderungen, 'n. l.' wo das Recht fehlt — nie 0). KRITIK umgesetzt: die Sperrwirkung wird gegen app.einsatz_qualifikation_erfuellt (0031) belegt, nicht gegen einteilung.ts; nachweis_art_id ist KEIN Formularfeld (von keiner Codezeile gelesen). Plattformzeilen nur Super-Admin (q_schreiben/q_aendern, 0030) — keine Migration noetig.
- `/portal/[mandant]/stammdaten/reinigungsklassen` — fertig
  - Code, Bezeichnung, Beschreibung, Sortierung, Bestaetigung (O-55) — anlegen, aendern, umsortieren, archivieren. Wirkungstext nach KRITIK neu geschrieben: die Klasse steuert NUR raum.reinigungsklasse_id und die Code-Zuordnung des Raumbuch-Imports, sie geht in keine Sollzeit und keine Kalkulation (die rechnen ueber die Belagsart). Vor dem Archivieren nennt die Zeile die Zahl der Raeume und Importzeilen; der Teilindex gibt den Code erst danach frei. Ergaenzt: Lesen braucht objekt.lesen (Policy t_mandant) — die Seite sagt, dass eine leere Liste dann nicht 'keine Klassen' heisst.

## src/server/registry/dienste.ts

/**
   * **Die fuenf Stammdatenkataloge (SEITENKARTE §5.13, PR Stammdaten).**
   *
   * `stammdaten/katalog` ist reine Eingabepruefung ohne jede Datenbank —
   * deshalb `schreibend: false`. Die fuenf Fachdienste schreiben alle mit
   * demselben Recht, und zwar mit dem, das auch die Policies der Tabellen
   * pruefen (`t_katalog_pflege`, `q_schreiben`, `t_mandant`): ein zweites
   * Recht hier waere eines, das die Datenbank nicht kennt.
   */
  { modul: 'stammdaten', pfad: 'stammdaten/katalog', schreibend: false },
  {
    modul: 'stammdaten', pfad: 'stammdaten/abwesenheitsart',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },
  {
    modul: 'stammdaten', pfad: 'stammdaten/antragsart',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },
  {
    modul: 'stammdaten', pfad: 'stammdaten/belagsart',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },
  {
    modul: 'stammdaten', pfad: 'stammdaten/qualifikation',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },
  {
    modul: 'stammdaten', pfad: 'stammdaten/reinigungsklasse',
    schreibend: true, schreibRecht: 'stammdaten.verwalten',
  },

## src/server/auth/route-manifest.ts

/**
   * **Die fuenf Schreibwege der Stammdaten (SEITENKARTE §5.13).**
   *
   * Alle fuenf tragen `stammdaten.verwalten` — dasselbe Recht, mit dem die
   * Seiten oeffnen und mit dem die Policies der fuenf Katalogtabellen
   * schreiben. Es gibt hier keinen Rechtebruch zu ueberbruecken.
   *
   * Es gibt bewusst KEINE Loesch-Route: alle fuenf Tabellen tragen
   * `kern.verhindere_loeschung`, und das Ende einer Katalogzeile ist
   * `archiviert_am` (Invariante 8). `?was=` waehlt anlegen, aendern oder
   * archivieren; bei `belagsarten` datieren oder richtigstellen.
   */
  {
    pfad: 'api/stammdaten/abwesenheitsarten',
    recht: 'stammdaten.verwalten',
  },
  {
    pfad: 'api/stammdaten/antragsarten',
    recht: 'stammdaten.verwalten',
  },
  {
    pfad: 'api/stammdaten/belagsarten',
    recht: 'stammdaten.verwalten',
  },
  {
    pfad: 'api/stammdaten/qualifikationen',
    recht: 'stammdaten.verwalten',
  },
  {
    pfad: 'api/stammdaten/reinigungsklassen',
    recht: 'stammdaten.verwalten',
  },

## src/server/db/schema/rls.ts

KEINE Aenderung an src/server/db/schema/rls.ts noetig — geprueft, nicht vermutet:

1. Keine neue Tabelle. Alle fuenf Katalogtabellen stehen mit ihrer Loeschsperre bereits in KEIN_HARD_DELETE (abwesenheitsart/antragsart 0073/0074, belagsart/reinigungsklasse 0021, qualifikation 0030), und ich habe das per psql gegen die Datenbank bestaetigt (trg_*_kein_hard_delete und trg_*_kein_truncate vorhanden).

2. Meine beiden neuen Ausloeser (trg_abwesenheitsart_schluessel_frei, trg_antragsart_schluessel_frei, 0276) laufen auf kern.katalog_schluessel_frei() — nicht auf kern.verhindere_loeschung und nicht auf kern.protokolliere_aenderung. tests/isolation/unveraenderbarkeit.test.ts zaehlt ausschliesslich ueber diese zwei Funktions-OIDs auf, die Register bleiben also in beiden Richtungen stimmig.

3. AUDITIERT und die geaendert_am-Liste bleiben unveraendert. abwesenheitsart und antragsart tragen weiterhin KEINEN setze_geaendert_am-Ausloeser (KRITIK bestaetigt) — die beiden Pflegedienste setzen geaendert_am/geaendert_von deshalb selbst; belagsart/reinigungsklasse/qualifikation haben den Ausloeser, dort setzen die Dienste nur geaendert_von. Und weil vier der fuenf Tabellen keinen Audit-Ausloeser tragen (nur belagsart hat einen), schreiben die Dienste app.protokolliere('stammdaten.*_angelegt|_geaendert|_archiviert', ...) mit Vorher UND Nachher von Hand; bei belagsart NICHT, weil trg_belagsart_audit dieselbe Aussage schon schreibt.

4. 0277 aendert Rechte an belagsart (grant select on belagsart to cse_definer + policy b_definer) und 0276 ergaenzt policy at_definer auf antragsart. Beides betrifft die cse_definer-Sicht, die rls.ts nicht fuehrt.

## src/server/registry/navigation.ts

KEIN Eintrag in src/server/registry/navigation.ts — und das ist eine Entscheidung, keine Auslassung.

Ein Navigationspunkt braucht einen Pfad, den das Routenregister kennt (tests/kern/portal-shell.test.ts: „jeder Punkt zeigt auf eine Route, die es GIBT"). Die Seitenkarte fuehrt unter §5.13 nur die fuenf Blattseiten und KEINE Wurzel /portal/[mandant]/stammdaten; ein Punkt darauf fuehrte auf 404, und eine der fuenf Blattseiten als Sidebar-Ziel zu nehmen waere eine willkuerliche Wahl.

Der Einstieg sind deshalb fuenf Karten in src/app/portal/[mandant]/einstellungen/page.tsx (von mir eingefuegt, die Datei steht nicht auf der zentralen Liste). Sie fragen ihr Recht — wie alle Karten dort — ueber findeRoute() aus dem Routenregister, also stammdaten.verwalten; eine Rolle ohne das Recht sieht sie nicht (AUT-06). Falls die Seitenkarte spaeter eine Indexroute /portal/[mandant]/stammdaten bekommt, gehoert der Punkt { schluessel: 'stammdaten', label: 'Stammdaten', pfad: 'stammdaten', recht: 'stammdaten.verwalten', icon: 'einstellungen' } in die NAVIGATION und die Indexseite mit denselben fuenf Karten daneben — beides erst DANN.

## Sonstiges

1) src/server/registry/modul.ts — 'stammdaten' in QUERSCHNITT aufnehmen (eine Zeile, aus gemeinsames #10 des Plans):

  'nachricht', 'versand', 'medien', 'abwesenheit', 'lead', 'kunde',
  // `stammdaten` (SEITENKARTE §5.13): die fuenf Kataloge sind kein Gewerk.
  // `abwesenheitsart`, `antragsart` und `qualifikation` haengen am MENSCHEN
  // und gelten gesellschaftsuebergreifend (D-09); `belagsart` und
  // `reinigungsklasse` sind mandantengebunden und in einer Gesellschaft ohne
  // Reinigung einfach leer. `modulAktiv` gibt heute schon `true` zurueck —
  // aber ueber den Rueckfall „unbekanntes Modul bleibt offen", also aus
  // Versehen richtig. Mit dieser Zeile ist es Absicht.
  'stammdaten',

2) docs/architecture/04-SEITENKARTE.md §5.13 — die fuenf Routen sind gebaut (vorher ueber den Auffangboden /portal/[mandant]/[...rest] beantwortet): abwesenheitsarten, antragsarten, belagsarten, qualifikationen, reinigungsklassen. Keine Indexroute angelegt (siehe registry_navigation).

3) src/app/portal/[mandant]/einstellungen/page.tsx — fuenf Karten ergaenzt (Icons aus dem geschlossenen Satz: kalender, freigabe, security, aufmass, reinigung). Erledigt, nicht zentral gepflegt; hier nur zur Kenntnis, weil die Datei der einzige Einstieg zu den fuenf Seiten ist.

4) docs/DESIGN.md — zwei Beobachtungen, KEINE neuen Werte erfunden:
   · §5 „Status pills" fuehrt kein Vokabular fuer „unbestaetigter Platzhalter". Ich habe es wie einstellungen/abrechnungsarten geloest: StatusPill zustand="Entwurf" plus der Text „unbestaetigt (O-17)" / „unbestaetigt (O-55)" daneben, und fuer eine offene Angabe StatusPill zustand="Offen" plus „ungeklaert (O-139)". Wenn DESIGN.md dafuer ein eigenes Pill-Wort bekommt, gehoeren diese Stellen darauf umgestellt.
   · Fuer die Herkunft einer Katalogzeile (Plattform / diese Gesellschaft / System) gibt es kein Bauteil; ich habe reinen Text in text-xs text-text-muted benutzt.

5) tests/kern/katalog-unbenutzt.ts:191 — optionale Hygiene, von mir NICHT angefasst: die KRITIK weist nach, dass 'stammdaten.verwalten' dem Pruefer schon als benutzt gilt (22 Funde, davon 16 in Migrationen) und dass katalog.test.ts nur unbenutzt ⊆ Warteliste prueft, also kein Bau-Gate ist.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-690 | **Fuehrt jede Gesellschaft eigene Abwesenheitsarten, oder gilt der Katalog gruppenweit einheitlich — und muss der Lohnartenschluessel je Art in allen drei Rechtseinheiten derselbe sein?** Die Plattform kann beides: `abwesenheitsart` ist zweistufig (K-17), die Pflegeseite legt auf Wunsch eine mandanteigene Art an und `kern.katalog_schluessel_frei` (0276) verhindert, dass derselbe Schluessel auf beiden Stufen aktiv ist. Offen ist die organisatorische Haelfte: eine eigene Art je Gesellschaft heisst je Gesellschaft eine eigene Lohnzuordnung im ACC-12-Export. | EMP-05, ACC-12, `abwesenheitsart`, O-139 |
| O-691 | **Wer pflegt in der Gruppe den PLATTFORM-Katalog (Abwesenheitsarten, Antragsarten, Qualifikationen), und braucht eine Aenderung daran eine zweite Zustimmung?** Plattformweite Katalogzeilen gelten fuer alle vier Gesellschaften; sie sind seit 0275 (abwesenheitsart, antragsart) und 0030 §6.16 (qualifikation) genau dem Super-Admin mit zweitem Faktor zugaenglich, und jede Aenderung steht im Pruefprotokoll. Ein Vier-Augen-Prinzip ist NICHT gebaut — `bezahlt` oder `blockiert_einsatz` wirken mit dem Speichern. | AUT-01, AUT-02, K-17, `abwesenheitsart`, `antragsart`, `qualifikation` |
| O-692 | **Darf eine Belagsart-Fassung RUECKWIRKEND beginnen, wenn fuer den Zeitraum schon Kalkulationen gerechnet wurden — und wer gibt das frei?** Heute gilt: eine neue Fassung darf vor der laufenden liegen, solange `belagsart_zeitraum_eindeutig` keine Ueberschneidung findet; die laufende Fassung wird nur zum Vortag geschlossen, wenn sie FRUEHER begann (`pruefeDatierung`). Eine rueckwirkende Fassung aendert damit die Grundlage jeder Kalkulation aus dieser Zeit, ohne dass jemand zustimmt. Die strengere Variante — Beginn nie vor `app.berlin_heute()` — ist eine Zeile im Dienst. | OPS-03, O-17, `belagsart`, `kalkulation_position` |
| O-693 | **Was geschieht mit Raeumen, die auf eine archivierte Reinigungsklasse zeigen — bleibt die Einstufung stehen oder muessen sie vor dem Archivieren umgestuft werden?** Heute bleibt sie stehen: `archiviert_am` gibt den Code frei (Teilindex `reinigungsklasse_code_uk`), `raum.reinigungsklasse_id` wird NICHT geleert, und die Pflegeseite nennt vor dem Archivieren die Zahl der betroffenen Raeume und Importzeilen. Die Alternative — Archivieren nur ohne haengende Raeume — waere eine Sperre, die ein Mensch heute nicht erwartet. | OPS-02, O-55, `reinigungsklasse`, `raum` |

## Tests

- /home/user/cse-platform/tests/kern/stammdaten.test.ts — 47 Faelle, GELAUFEN und gruen (npx vitest run tests/kern/stammdaten.test.ts): Schluesselform, Pflichttexte, Zahl-vs-NULL, isoDatum, i18n auf genau de/en/ar/tr, pflegbar/sperrgrund-Matrix (eigen / Plattform / System), alsLeistungswert als TEXT (kein float, 0 m²/h abgewiesen), vortag() an Monatsende, Jahreswechsel, Schalttag 2028-02-29 und beiden DST-Tagen, pruefeDatierung (erste / Abloesung / gleicher Tag / rueckwaerts), Warnstufen (Vorgabe 60/30/7, Sortierung, Dubletten, 0 abgewiesen), Kategorie-Enum, Frist an nicht ablaufender Qualifikation abgewiesen, erzeugt_abwesenheit ohne Zeitraum+Art abgewiesen, bezahlt in drei Zustaenden, Farbtoken nur DESIGN-Satz.
- /home/user/cse-platform/tests/isolation/stammdaten.test.ts — 24 Faelle fuer Policies und Ausloeser (NICHT von mir gelaufen: pnpm test:isolation ist untersagt). Inhalt jedoch Fall fuer Fall per tsx-Handprobe gegen echtes Postgres (Datenbank w_stamm, frisch migriert, harness.seed()) nachgewiesen: 53/53 und 18/18 gruen. Geprueft: admin haelt stammdaten.verwalten und ist kein Super-Admin; ist_super_admin nur mit aal2; Plattformart durch admin nicht aenderbar, durch Super-Admin schon; bezahlt faellt nicht auf ungeklaert zurueck; eigene Art anlegen/archivieren; Schluesselkollision in BEIDEN Richtungen (Dienst UND Ausloeser, auch am Dienst vorbei) und Freigabe nach Archivierung; Systemantragsart fuer jeden fest und nicht archivierbar; belagsart: Definer-Lesung, direkter Spaltenzugriff scheitert (42501), Abloesung zum Vortag, Rueckwaertsdatierung abgewiesen, Ausschluss-Schranke am Dienst vorbei, Richtigstellung ohne Wertaenderung; reinigungsklasse: Code nur einmal aktiv, nach Archivierung frei, in fremder Gesellschaft unsichtbar (K-03); qualifikation: Plattformzeile nur Super-Admin, schluessel unveraenderlich; kein DELETE auf allen fuenf Tabellen; Protokollzeilen mit Vorher/Nachher und gefuelltem geaendert_felder.

## NICHT gebaut

- Indexseite /portal/[mandant]/stammdaten — die Seitenkarte und routen.generiert.ts fuehren KEINE Indexroute; eine gebaute Seite dort faellt in portalZugang auf 404. Einstieg sind stattdessen fuenf Karten in src/app/portal/[mandant]/einstellungen/page.tsx (von mir eingefuegt, Datei ist nicht zentral gepflegt).
- Verwendungszaehlung je Abwesenheitsart — abwesenheit.abwesenheitsart_id ist cse_app spaltenweise ENTZOGEN (K-05, 0073); ein group by scheitert mit 42501, und eine Zaehlung je Art waere die Auskunft 'wie viele Krankmeldungen'. Die Seite sagt das und verlaesst sich auf kern.abwesenheitsart_schutz, dessen Meldungen der Dienst in Saetze uebersetzt. Der Plan hatte hier 'Reichweite je Zeile' zugesagt.
- Formularfeld fuer qualifikation.nachweis_art_id — tote Spalte (KRITIK bestaetigt: 0 Codetreffer); ein Feld pflegte einen Wert, auf den sich nichts stuetzt.
- Rueckverweise AUS den Nachbardomaenen (Raumbuch -> Belagsarten/Reinigungsklassen, Nachweisregister -> Qualifikationen, Antragseingang -> Antragsarten). Meine fuenf Seiten verweisen rechtegeprueft NACH draussen; die Gegenrichtung liegt in Dateien anderer Domaenen, an denen parallel gearbeitet wird.
- Streichung von 'stammdaten.verwalten' in tests/kern/katalog-unbenutzt.ts:191 — die KRITIK weist nach, dass der Schluessel dem Pruefer schon als benutzt gilt (22 Funde) und kein Test das Streichen erzwingt. Gemeinsame Datei, paralleler Zugriff: bewusst gelassen.
- tests/e2e-Spec fuer die fuenf Seiten — die Browsersuite darf ich nicht starten; alle data-cse-Anker sind gesetzt (arten, antragsarten, belagsarten, klassen, qualifikationen, *-leer, *-offen, *-gesperrt, *-bearbeiten, stammdaten-hinweis).

## Notizen des Bauenden

MIGRATIONSLAUF: `DATABASE_URL=…/w_stamm pnpm db:migrate` lief zuletzt vollstaendig bis „Migrationen angewendet." durch, auf einer frisch angelegten w_stamm, mit 0275–0278 als letzten vier Dateien. Kein fremder Fehler unterwegs; 0248/0249/0250/0265/0266 anderer Agenten kamen waehrend meiner Arbeit dazu und liefen mit.

WAS DIE KRITIK GEAENDERT HAT (sie galt, wo sie dem Plan widersprach):
· „Keine Migration noetig" war der falsche Befund. Ohne 0275 kann NIEMAND die sieben Plattform-Abwesenheitsarten aendern (t_katalog_pflege ist die einzige Schreibpolicy und hat keinen Super-Admin-Zweig, force RLS, cse_app haelt nur select/insert/update) — O-139 waere durch keine Oberflaeche beantwortbar geblieben, und fuenf der sieben Arten bleiben mit bezahlt = NULL unbenutzbar (pruefeArt wirft ArtUngeklaertFehler). Verifiziert: derselbe Aufruf scheitert als admin und gelingt als super_admin mit aal2.
· Die von der KRITIK zusaetzlich gefundene Falle (unique nulls not distinct erlaubt 'urlaub' zweimal, Leser filtert nur archiviert_am) ist als 0276 geschlossen, in BEIDEN Richtungen und als security definer, damit die Pruefung auch die Zeile einer fremden Gesellschaft sieht.
· belagsart: die Historie ist ueber app.leistungswerte_lesen nicht darstellbar (nur Stichtagsscheibe) und direkt nicht lesbar (K-05-Spaltenentzug) — daher 0277 mit stammdaten.verwalten statt objekt.lesen. Die Rollenmengen sind wirklich verschieden (objekt.lesen auch an `kunde`), also haette objekt.lesen im Definer den Katalog dem Kundenportal geoeffnet, gegen p_intern_decke.
· reinigungsklasse: der Wirkungstext des Plans stuetzte sich auf die falschen Dateien. Nachgeprueft (grep + psql): einziger Leser in src/ ist raumbuch/import.ts; revier.ts und kalkulation/raumbuch.ts lesen belagsart ueber app.leistungswerte_lesen. Die Seite sagt das jetzt so.
· antragsart: vier Schalter erreichen das Mitarbeiterformular, erzeugt_abwesenheit wirkt bei der Entscheidung, ist_stammdatenaenderung nur im SQL-Ausloeser. Steht als SCHALTER-Liste im Dienst (nicht in der Seite, weil eine page.tsx nur exportieren darf, was Next kennt) und ist im Unit-Test festgeschrieben.
· qualifikation: nachweis_art_id ist kein Formularfeld; die Sperrwirkung wird gegen app.einsatz_qualifikation_erfuellt (0031) belegt.
· Jede der fuenf neuen API-Routen braucht einen Eintrag in route-manifest.ts (sonst faellt tests/kern/routen.test.ts) — siehe registry_manifest. Jede Route ruft authorize() selbst, in derselben gebundenen Transaktion wie den Dienst.

EIGENER BEFUND, der ueber den Plan hinausgeht (0278): kern.abwesenheitsart_schutz prueft „ist diese Art benutzt" mit den Rechten des Aufrufers gegen abwesenheit. Unter force RLS bekommt eine Sitzung ohne zeit.abwesenheit_lesen dort `false` — die Sperre gegen das Umbenennen einer benutzten Art und gegen das Kippen ihrer Art-9-Einstufung verschwand also lautlos genau fuer die Pflegesitzung, die nur stammdaten.verwalten haelt. Jetzt security definer mit Eigentuemer cse_definer (die Policy ab_definer und das Tabellenrecht bestehen seit 0073). Die Funktion gibt nach wie vor nichts zurueck als new oder eine Meldung; der Art-9-Grund bleibt hinter app.abwesenheit_grund_lesen.

WAS AN DIESEN SEITEN EIN PLATZHALTER BLEIBT (Regel 1, alles in der Oberflaeche sichtbar): bezahlt / nachweis_pflicht_ab_tagen / lohnart_schluessel je Abwesenheitsart -> „offen (O-139)"; der Bestand der Antragsarten -> O-142 vor der Liste; Leistungswerte -> „unbestaetigt (O-17)" plus O-349 fuer Glasflaechen; Reinigungsklassen -> „unbestaetigt (O-55)"; standard_gueltigkeit_monate -> „Frist offen (O-341)", erfordert_dokument -> „offen (O-343)", Kategorie -> O-144, Artenliste -> O-107. Vier NEUE Fragen sind O-690 bis O-693; ihre TODO(client, O-NNN)-Zeilen stehen in den vier Seiten (abwesenheitsarten:41, qualifikationen:44, belagsarten:41, reinigungsklassen:41) und melden bis zum Registereintrag erwartungsgemaess `todo-client-nicht-im-register`. Sonst meldet `npx tsx scripts/guards/run-all.ts` zu meinen Dateien NICHTS (keine tailwind-farbe, kein page-fremder-export).

FUER EINE „Entschieden"-SEKTION in docs/DECISIONS.md (nicht Offen), wenn Du sie fuehrst:
· D-…: Plattformweite Personal-Kataloge pflegt der Super-Admin mit zweitem Faktor — dasselbe Muster wie qualifikation (§6.16), nachgezogen fuer abwesenheitsart und antragsart (0275). ist_system-Antragsarten bleiben fuer JEDEN fest.
· D-…: Ein Katalogschluessel gehoert einer Stufe. Plattform und Mandant duerfen denselben aktiven Schluessel nicht fuehren (0276), weil der Auswahlleser des Mitarbeiterportals nicht nach Stufe filtert.
· D-…: Der Leistungswert wird nie ueberschrieben, sondern umdatiert; Richtigstellung (Name/Quelle) und neue Fassung (Wert) sind zwei getrennte Aktionen und zwei getrennte Formulare.
· D-…: Eine Zahl, die eine Sitzung nicht lesen DARF, wird als „nicht lesbar" gezeigt und nie als 0 (Reichweite der Qualifikationen, Antragsbestand, Raeume/Importzeilen je Klasse). Eine 0 aus einer leeren RLS-Antwort waere eine Aussage ueber den Bestand statt ueber die Rechte — und genau darauf stuetzte sich dann die Entscheidung ueber blockiert_einsatz oder ein Archivieren.

PRUEFSTAND: 47 Unit-Faelle gelaufen und gruen. Isolationsdatei geschrieben, aber nicht gelaufen (untersagt) — dafuer jeder ihrer Faelle per tsx-Handprobe gegen echtes Postgres bestaetigt (53/53 und 18/18, zuletzt gegen die frisch migrierte w_stamm). Typecheck auf meine Pfade gefiltert: sauber. eslint auf alle neuen Dateien plus die geaenderte einstellungen/page.tsx: sauber. `pnpm db:seed` habe ich nicht laufen lassen (untersagt): die Seed-Daten der fuenf Kataloge kommen aus Migration (abwesenheitsart, antragsart) bzw. src/server/db/seed/qualifikation.ts und reinigung.ts und werden von den Seiten unveraendert gelesen — die Pflegewege habe ich stattdessen auf leeren und auf befuellten Katalogen geprueft.
