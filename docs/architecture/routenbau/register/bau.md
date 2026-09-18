# Registereintraege: bau

Diese Eintraege hat der bauende Agent geliefert; sie sind **noch nicht** eingefuegt.
Die gemeinsamen Dateien pflegt EINE Hand, weil mehrere Agenten gleichzeitig im Baum
arbeiten und sich sonst in dieselbe Zeile schreiben. Ist ein Eintrag eingefuegt,
verschwindet er hier — diese Datei ist eine Warteschlange, kein Archiv.

## Migrationen (gegen eine eigene Datenbank gefahren: True)

- drizzle/0210_bau_abnahme_art.sql
- drizzle/0211_abnahme.sql
- drizzle/0212_lv_import.sql
- drizzle/0213_projekt_summe_lesen.sql
- drizzle/0214_lv_import_hinweis.sql

## Gebaute Routen

- `/portal/[mandant]/bau` — fertig
  - Moduluebersicht: Kachelzeile aus EINER Abfrage (ladeBauKennzahlen, neun Unterabfragen in einem Schnappschuss), dann offene Nachtraege mit der 14-Tage-Wachfrist (BAU-04), laufende Behinderungen ohne Wegfall (BAU-06), Bautage im Entwurf plus Tage ohne Eintrag (BAU-07, Pflichttage offen O-630), vorgelegte Aufmassblaetter (BAU-03), Ausserhalb-LV-Warnungen (BAU-05). KRITIK-Punkt Saat erledigt: behinderung war ungeseedet, jetzt drei Faelle (laufend / mit Wegfall / Entwurf); dazu neu eine Teilabnahme und ein wartender LV-Import in der Saat. KEINE stornierte Behinderung — die Anwendung hat fuer Behinderungen gar keinen Stornoweg (weder Dienst noch Endpunkt noch Oberflaeche), der Ausschluss `storniert_am is null` in ladeBauKennzahlen/findeProjektDetail ist reine Vorsorge; eine Saatzeile, die nur per rohem SQL entstehen kann, fuehrte einen Zustand vor, den niemand erzeugen kann. PRUEFBEFUND behoben: die Seite holt jetzt `haeltRechte(sitzung,'bau.schreiben')` und verlinkt die einzelnen Bautage (Entwurfstabelle und Luecken) nur mit dem Recht — `bautagebuch/[datum]` traegt `bau.schreiben` an der Tuer, ohne das Recht war die Kachel ein 404 (AUT-06). Ausserdem laedt sie nicht mehr JEDES Aufmassblatt des Mandanten, um vier davon zu zeigen: `listeAufmasse` hat jetzt `status` und `grenze`, `ladeAusserhalbLv` eine `grenze`. Fuenfte Kachel „Abnahmeprotokolle" — `BauKennzahlen.abnahmen` wurde gezaehlt und nirgends gezeigt.
- `/portal/[mandant]/bau/projekte/[id]` — fertig
  - Projektkopf mit Vertragsgrundlage gross, Soll-/Ist-Terminen, Bauleitung, Gewaehrleistung als beschrifteter Platzhalter (O-154). Sechs Karten mit Zahlen. KRITIK zum falschen Recht umgesetzt: Auftragssumme und Sicherheitseinbehalt ueber die neue Leserfunktion app.projekt_summe_lesen (bau.preis_lesen, Mandantenpruefung, audit_log, KEINE Zeile statt 0 EUR); die Marge bleibt bei app.projekt_kennzahlen, ihr Recht kalkulation.lesen wird VORHER in SQL geprueft, damit keine Ausnahme die gebundene Transaktion abbricht. Prozentanzeige jetzt ueber den Hausformatierer prozent() aus bericht/ausgabe (ganzzahlige Basispunkte, kein toLocaleString auf einer Zahl - die Wache anzeige-berlin hatte zwei Treffer). PRUEFBEFUND behoben: die sechste Karte (Abnahme) zeigte unbedingt auf eine Route, die `bau.schreiben` an der Tuer traegt — fuer jeden Benutzer mit nur `bau.lesen` ein 404. Sie steht jetzt ohne Verweis da und nennt das fehlende Recht, wie es die Aufmassdetailseite fuer `bau.aufmass_freigeben` tut.
- `/portal/[mandant]/bau/projekte/[id]/abnahme` — fertig
  - Abnahmeprotokoll nach § 12 VOB/B: Art, Berliner Kalendertag, Leistungsumfang bei Teilabnahme, Teilnehmer beider Seiten, die zwei Vorbehalte getrennt mit protokolliertem Wortlaut (§ 11 Abs. 4 und § 12 Abs. 3), Maengelliste mit Frist und LV-Bezug, Verweigerung als vollwertiger Datensatz mit Grund. Schnappschuss und SHA-256 entstehen serverseitig VOR dem Einfuegen, Maengel nur in derselben Transaktion; Korrektur durch Storno mit Ersatz. gewaehrleistung_bis bleibt NULL hinter der Schnittstelle GewaehrleistungsFrist (O-154). Das unterschriebene Papier steht als nicht angehaengt da - kein Dokumentenspeicher verbunden, kein PDF vorgetaeuscht. VIER PRUEFBEFUNDE behoben: (1) die Einmaligkeit der Gesamtabnahme stand nur als partieller Index — `protokolliereAbnahme` prueft sie jetzt vorher in SQL UND uebersetzt `abnahme_gesamt_uk` als AbnahmeFehler('schon_abgenommen', 409), statt den zweiten Versuch als 500 enden zu lassen. (2) Der ungenutzte Fehlergrund 'gesperrt' ist aus dem Typ entfernt (die Einfrierer lassen genau die Spalten zu, die der Dienst anfasst — es gibt keinen Pfad dorthin). (3) `ersetzt_durch_id` wurde von keinem erreichbaren Pfad geschrieben: neu sind `verknuepfeErsatzprotokoll` im Dienst, ein Feld „Ersetzt ein storniertes Protokoll" im Formular, die Weitergabe in api/bau/abnahmen und die Anzeige der Kette in BEIDE Richtungen. (4) Die Seite ersetzte nach einer Gesamtabnahme das ganze Formular durch einen Hinweis, der selbst sagte, eine weitere Teilabnahme sei moeglich — das Formular bleibt jetzt stehen und ist auf `teilabnahme` mit Pflicht-Leistungsumfang beschraenkt. Dazu KLEIN: die drei Zweige auf `darf['bau.schreiben']` sind weg samt `haeltRechte`-Aufruf — die Route traegt `bau.schreiben` als LESERECHT, ohne das Recht wird die Seite nie gerendert; die Bedingungen lasen sich wie eine Absicherung und waren unerreichbar.
- `/portal/[mandant]/bau/projekte/[id]/aufmass/[aufmassId]/freigabe` — fertig
  - Die Seite zeigt, WAS gegengezeichnet wird: Kopf, alle Zeilen mit Rechenansatz und Ergebnis, Messfotos, vorhandene Signaturen mit Digest - gemeinsame Bausteine in AufmassTeile.tsx, damit Blatt- und Freigabeansicht dasselbe zeigen. Fehlt etwas, stehen die Hindernisse aus pruefeVorlage; ist das Blatt gesperrt, der Satz zur Unveraenderlichkeit mit dem Weg ueber Storno. Das Formular postet auf den bestehenden Endpunkt, der Schnappschuss bleibt serverseitig. KRITIK-Punkt erledigt: das Formular ist von der mit bau.lesen bewachten Detailseite hierher verlegt, dort steht nur noch ein Verweis hinter haeltRechte('bau.aufmass_freigeben'), und die drei gruenen Playwright-Faelle in tests/e2e/aufmass.spec.ts sind auf den neuen Weg umgeschrieben.
- `/portal/[mandant]/bau/projekte/[id]/lv/[ozId]` — fertig
  - OZ, Brotkrume aus dem Baum (rekursiv ueber eltern_id, nicht aus dem Pfad), Kurz- und Langtext, Einheit, Vertragsmenge, Einheitspreis und Betrag nur ueber app.lv_preis_lesen (sonst ausdruecklicher Hinweis, nie 0). Gegenueberstellung aufgemessene gegen Vertragsmenge mit Mehrmengenwarnung (BAU-05), die buchenden Aufmassblaetter, Herkunft (quelle_seite, quelle_bereich, Konfidenz, Pruefstand) und der Bestaetigungsknopf hinter bau.schreiben. O-155 steht wortgleich wie im LV-Baum. Die Regel selbst wohnt jetzt im Dienst (zaehltPositionsartInSumme) statt in einer zweiten Fassung im Seitenkoerper. PRUEFBEFUND behoben: `quelle_bereich` wurde gelesen und nirgends gezeigt — neu die Zeile „Quelle: Fundstelle" im Herkunftsblock ueber `fundstelleText()` (lv.ts). Und der Name der Sicherung ist korrigiert: es gibt keine Funktion `bau.pruefe_lv_geprueft()` (so heisst sie nur in 03-GEWERKE §7.5); die greifende Pruefung ist `kern.aufmass_vorlage_pruefen()` aus 0072 — berichtigt in lv.ts (zwei Stellen), in api/bau/lv-positionen/[id]/bestaetigung/route.ts und im Manifestkommentar unten.
- `/portal/[mandant]/bau/projekte/[id]/lv/import` — fertig
  - Eine Adresse, zwei Zustaende wie OPS-04: ohne ?import= das Formular (Datei, Format - die Auswahl nennt die nicht implementierten Formate sichtbar und gesperrt, O-41), mit ?import= die Vorschau aus dem SERVERSEITIGEN Staging, je Zeile OZ, Art, Kurztext, Menge, Einheit, Preis, Aktionspille (anlegen / aktualisieren / unveraendert / ignorieren) und die Fehler je Zeile, oben die drei Zaehler. Der Parser liegt hinter der Schnittstelle LvQuelle; implementiert ist CSV (Semikolon) ueber den vorhandenen Leser aus raumbuch/tabelle.ts, alles andere wird abgewiesen statt halb gelesen. Uebernommen wird in eine NEUE Fassung. BLOCKIERENDER PRUEFBEFUND behoben: `ladeLvAuswahl` filterte nur auf projekt_id — nach dem ersten Import stand JEDE OZ zweimal in der Auswahl (Aufmasserfassung, Maengelliste der Abnahme), ununterscheidbar. Jetzt gibt sie je Verzeichnis (art + nachtrag_id) nur die JUENGSTE lebende Fassung heraus und nennt Verzeichnis und Fassung je Zeile; beide Seiten gruppieren mit `gruppiereLvAuswahl` in `optgroup`. Die alte Fassung bleibt stehen und lesbar (sie ist der Beleg nach § 2 Abs. 6 VOB/B) — sie ist nur keine Buchungsstelle mehr. DREI WEITERE Befunde: (a) Die neue Fassung entsteht nur aus den Zeilen der Datei; was in der aktuellen Fassung steht und in der Datei fehlt, faellt weg. Das sagte niemand — jetzt ermittelt `legeLvImportAn` die fehlenden OZ, legt sie ins Staging (`fehler_bericht.fehlendeOz`), und die Vorschau zeigt sie als vierten Zaehler plus Liste; der irrefuehrende Begleitsatz ist ersetzt; die Fachfrage ist O-633. (b) Ein Preis auf einer Zeile, die keine Position ist (Titelsumme — in exportierten LV-Tabellen ueblich), verletzte `lvp_preis_nur_position` und endete als 500 nach gruener Vorschau: der Leser verwirft den Preis jetzt und schreibt einen HINWEIS (neue Spalte `lv_import_zeile.hinweise`, 0214) — die Zeile bleibt, sonst haetten ihre Positionen keinen Elternteil. (c) Zwei Dateizeilen mit derselben OZ verletzten `lv_position_oz_uk`: die zweite bekommt jetzt beim Lesen einen Zeilenfehler mit Verweis auf die erste, und `uebernimmLvImport` uebersetzt den Index zusaetzlich als LvImportFehler('oz_doppelt', 422). `angelegt` zaehlt jetzt die wirklich eingefuegten Zeilen statt `idJeOz.size`. KORRIGIERT: CSV traegt KEINE Konfidenz (`konfidenz: null`, bewusst) — die Positionen gelten damit NICHT als maschinell gelesen, und die Bestaetigungspflicht greift erst bei einem extrahierenden Leser. Register und Saatkommentar behaupteten das Gegenteil (siehe O-631).

## src/server/registry/dienste.ts

/**
   * **Die Abnahme (§ 12 VOB/B, 0210/0211).**
   *
   * `bau.schreiben` und nicht `bau.aufmass_freigeben`: eine Abnahme ist keine
   * Mengenfeststellung, sondern die Erklaerung der Vertragsparteien ueber
   * Gefahruebergang, Fristbeginn und Vertragsstrafe. Die Seitenkarte gibt
   * `…/projekte/[id]/abnahme` genau dieses Recht.
   */
  {
    modul: 'bau', pfad: 'bau/abnahme',
    schreibend: true, schreibRecht: 'bau.schreiben',
  },
  /**
   * Der LV-Import (BAU-01, REQ-04, 0212) und die Uebersicht.
   *
   * `bau/lv-quelle` LIEST: der Parser nimmt Text hinein und gibt Zeilen
   * heraus, ohne die Datenbank zu beruehren — damit ist er fuer sich testbar
   * und in der Gruppenansicht unbedenklich. `bau/lv-import` schreibt Staging
   * und Uebernahme und traegt `bau.schreiben`, dasselbe Recht wie die Route.
   *
   * `bau/uebersicht` LIEST: es zaehlt und filtert fuer die Moduluebersicht,
   * es rechnet nichts.
   */
  { modul: 'bau', pfad: 'bau/lv-quelle', schreibend: false },
  {
    modul: 'bau', pfad: 'bau/lv-import',
    schreibend: true, schreibRecht: 'bau.schreiben',
  },
  { modul: 'bau', pfad: 'bau/uebersicht', schreibend: false },

## src/server/auth/route-manifest.ts

Drei neue Eintraege in src/server/auth/route-manifest.ts, im Bau-Block (nach 'api/bau/behinderungen/[id]/wegfall'):

  {
    /**
     * Die Abnahme protokollieren, einen Mangel behoben melden, ein Protokoll
     * stornieren (§ 12 VOB/B).
     *
     * `bau.schreiben` und nicht `bau.aufmass_freigeben`: wer ein Aufmass
     * gegenzeichnet, stellt eine Menge fest; wer eine Abnahme protokolliert,
     * haelt fest, dass Gefahr, Gewaehrleistungsfrist und Faelligkeit
     * umgeschlagen sind. Die Seitenkarte gibt der Seite dasselbe Recht.
     *
     * Ein Eingang fuer drei Vorgaenge: alle teilen Sitzung, Ursprungspruefung,
     * Mandantenkontext und Recht — und die Korrektur IST ein Storno mit
     * Ersatzprotokoll, kein zweiter Schreibweg.
     */
    pfad: 'api/bau/abnahmen',
    recht: 'bau.schreiben',
  },
  {
    /**
     * Ein Leistungsverzeichnis hochladen, pruefen, uebernehmen oder verwerfen
     * (BAU-01, REQ-04, OPS-04-Muster).
     *
     * `bau.schreiben`: der Import bewegt Vertragsmengen und Einheitspreise
     * eines Leistungsverzeichnisses. Geparst wird SERVERSEITIG, die Vorschau
     * liegt im Staging (`lv_import`, `lv_import_zeile`) — uebernommen wird,
     * was der Server gelesen hat, nie etwas aus einem versteckten Feld des
     * Browsers (K-12).
     */
    pfad: 'api/bau/lv-import',
    recht: 'bau.schreiben',
  },
  {
    /**
     * Eine maschinell gelesene LV-Position BESTAETIGEN (APR-03, K-10).
     *
     * `bau.schreiben`: die Bestaetigung benennt den Menschen, der einen aus
     * einem PDF gelesenen Preis verantwortet. Daran haengt mehr als ein
     * Haekchen — `kern.aufmass_vorlage_pruefen()` (0072) weist jede Vorlage
     * eines Aufmasses ab, deren Zeilen auf eine unbestaetigte maschinelle
     * Position buchen.
     */
    pfad: 'api/bau/lv-positionen/[id]/bestaetigung',
    recht: 'bau.schreiben',
  },

## src/server/db/schema/rls.ts

WICHTIG vorweg: die generierten Bloecke in drizzle/0211 und drizzle/0212 stehen schon in den Dateien und sind gegen `erzeuge('0211')`/`erzeuge('0212')` byteweise geprueft (alle 68 Bloecke des Baums stimmen). Nach dem Einfuegen unten bleibt nur `pnpm db:triggers`, und es schreibt dann ausschliesslich src/server/db/triggers/no-hard-delete.sql neu.

(1) In KEIN_HARD_DELETE ans Ende einfuegen — der letzte vorhandene Eintrag endet ohne Komma, also erst `},` daraus machen:

  {
    tabelle: 'abnahme',
    art: 'archiv',
    migration: '0211',
    grund:
      'BAU-01, OPS-11, LEG-01, FIN-08. Mit der Abnahme schlagen Gefahr, '
      + 'Gewaehrleistungsfrist und Faelligkeit um (§ 12 VOB/B), und ohne '
      + 'vorbehalt_vertragsstrafe verfaellt die Vertragsstrafe (§ 11 Abs. 4). '
      + 'Geloescht bliebe ein Projekt zurueck, das abgenommen ist, ohne dass jemand '
      + 'sagen koennte wann, von wem und unter welchem Vorbehalt. Beendet wird mit '
      + 'storniert_am und einem Ersatzprotokoll.',
  },
  {
    tabelle: 'abnahme_mangel',
    art: 'append',
    migration: '0211',
    grund:
      'BAU-01, OPS-11, NOT-01. Der bei der Abnahme aufgenommene Mangel mit seiner '
      + 'Beseitigungsfrist. Er steht im gesiegelten Protokoll des Kopfes; eine '
      + 'geloeschte Zeile ergaebe eine Maengelliste, die kuerzer ist als das Siegel '
      + 'darueber — und kein Fristablauf waere mehr nachweisbar.',
  },
  {
    tabelle: 'lv_import',
    art: 'archiv',
    migration: '0212',
    grund:
      'BAU-01, REQ-04, LEG-01. Der Importkopf dokumentiert, WIE das heutige '
      + 'Leistungsverzeichnis entstanden ist — in welchem Format, aus welcher '
      + 'Datei, von wem uebernommen. Er bleibt, auch wenn seine Zwischenzeilen '
      + 'geraeumt sind; sein Ende ist verworfen_am.',
  },

(2) In GEAENDERT_AM ans Ende einfuegen:

  { tabelle: 'abnahme', migration: '0211' },
  { tabelle: 'abnahme_mangel', migration: '0211' },
  { tabelle: 'lv_import', migration: '0212' },

(3) AUDITIERT bekommt NICHTS, und das ist eine Entscheidung: `abnahme` friert mit dem Einfuegen ein (kern.abnahme_einfrieren weist jede Protokollspalte ab), beweglich sind nur Storno und Aufbewahrung — ein Auditeintrag mit Vorher/Nachher haette dort nichts zu zeigen, was nicht schon in eigenen Spalten steht. Jeder LESENDE Zugriff auf die Vertragssumme steht ohnehin im audit_log (app.projekt_summe_lesen protokolliert). `lv_import_zeile` traegt bewusst KEINE Loeschsperre: cse_job raeumt die Zwischenzeilen nach der Uebernahme (Policy t_job_raeumen), der Kopf bleibt.

(4) lv_import_zeile gehoert NICHT in NUR_UEBER_DEFINER: die Tabelle hat eine Mandantenpolicy und einen Spalten-GRANT ohne einheitspreis_cent/rohdaten; der Preis kommt ueber app.lv_import_preis_lesen (geprueft in tests/isolation/bau-lv-import.test.ts).

## src/server/registry/navigation.ts

In src/server/registry/navigation.ts den Kommentar Zeilen 206-212 und den Eintrag Zeile 213 ersetzen (der alte Kommentar begruendet genau den Zustand, der jetzt weg ist):

  /**
   * `bau`, nicht mehr `bau/projekte`: die Moduluebersicht der Seitenkarte
   * (§5.9, Zeile 1) ist gebaut und traegt die drei Punkte, auf die sie zeigt —
   * offene Nachtraege (BAU-04), laufende Behinderungen (BAU-06) und den Stand
   * des Bautagebuchs (BAU-07). Der Punkt zeigte bewusst auf die Projektliste,
   * solange die Uebersicht leer gewesen waere; jetzt waere der Umweg die
   * Luecke.
   */
  { schluessel: 'bau', label: 'Bau', pfad: 'bau', recht: 'bau.lesen', icon: 'aufmass' },

## Sonstiges

(0) drizzle/0214_lv_import_hinweis.sql ist NEU (Pruefbefund LV-Import): eine Spalte `lv_import_zeile.hinweise text[] not null default '{}'` plus `grant select (hinweise) … to cse_app`. Sie braucht KEINE Zeile in schema/rls.ts und keine in generate-triggers.ts: die Tabelle steht schon mit ihrem Eintrag im Register (0212), und 0214 legt weder Tabelle noch Loeschsperre an. Gegen eine frisch migrierte Datenbank gefahren.

(A) scripts/generate-triggers.ts — MIGRATIONS_DATEIEN braucht zwei Zeilen, sonst faellt tests/kern/loeschsperre.test.ts mit "path argument must be of type string" (die beiden neuen Nummern stehen dann in MIGRATIONEN, haben aber keine Datei im Register):

  '0211': join(WURZEL, 'drizzle/0211_abnahme.sql'),
  '0212': join(WURZEL, 'drizzle/0212_lv_import.sql'),

(B) Danach EINMAL `pnpm db:triggers` laufen lassen. Ich habe es nicht ausgefuehrt (verboten) und dafuer nachgerechnet: erzeuge(m) stimmt fuer alle 68 Migrationen mit dem Block in der Datei, auch fuer 0211 und 0212. Der Lauf aendert also nur src/server/db/triggers/no-hard-delete.sql — die Datei, die ich nicht anfassen darf, und die tests/kern/loeschsperre.test.ts gegen das Register vergleicht.

(C) NICHTS zu aendern an: routen.generiert.ts (alle sechs Pfade stehen mit den richtigen Rechten in Zeilen 150-168), katalog.generiert.ts (bau.lesen, bau.schreiben, bau.aufmass_freigeben, bau.preis_lesen vorhanden), kennzahlen.ts, tableiste.ts, modul.ts, docs/architecture/04-SEITENKARTE.md (alle sechs Zeilen stehen dort samt Recht), docs/DESIGN.md (kein neuer Gestaltungswert; die Prozentanzeige nutzt den vorhandenen Formatierer prozent() aus services/bericht/ausgabe.ts).

(D) Geloescht: vitest.probe-bau.config.ts im Wurzelverzeichnis war mein vorlaeufiger Probenlaeufer und ist entfernt; die drei Bau-Isolationsdateien laufen ueber vitest.isolation.config.ts (include: tests/isolation/**), die neue Datei bau-seiten-abfragen.test.ts wird automatisch mitgenommen.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-630 | **An welchen Tagen wird ein Bautagebucheintrag erwartet — an jedem Kalendertag, an jedem Werktag oder nach Bauzeitenplan?** § 3 Abs. 3 VOB/B verlangt die Fuehrung, nicht eine Taktung. Die Moduluebersicht zeigt deshalb heute jeden Kalendertag der letzten sieben Tage ohne Eintrag und schreibt daneben, dass die Pflichttage offen sind (`tageOhneBautagebuch`, `bau/uebersicht.ts`); ein unterstellter Werktagskalender machte aus einem Samstag ohne Arbeit eine Luecke im Bauzeitnachweis und aus einem stillen Baustopp einen vollstaendigen Nachweis. | BAU-07, `/portal/[mandant]/bau` |
| O-631 | **Uebernimmt der LV-Import die Einheitspreise des Auftraggebers als Vertragspreise, oder werden sie nach der Uebernahme kalkuliert und eingetragen?** Heute wandert der gelesene Preis mit in die neue Fassung (`uebernimmLvImport`), und zwar nur durch `app.lv_import_preis_lesen` — wer `bau.preis_lesen` nicht haelt, uebertraegt ihn nicht. Er wird dabei NICHT als unbestaetigt gefuehrt: die einzige implementierte Quelle ist CSV, und `CSV_QUELLE` setzt bewusst `konfidenz: null`, weil eine woertlich gelesene Spalte kein Modell geraten hat. Damit greifen `istUngeprueftMaschinell`, das Hindernis in `kern.aufmass_vorlage_pruefen()` (0072) und `bestaetigeLvPosition` fuer CSV-Positionen NICHT — diese Sicherung beginnt erst bei einem extrahierenden Leser (PDF, Bild, O-41). Kommt das LV als Ausschreibung ohne Preise, ist die Uebernahme des leeren Feldes richtig; kommt es als Auftrags-LV mit Preisen, ist der Preis Vertragsinhalt. Die Antwort entscheidet, ob die Vorschau eine Preisspalte fuehren darf und ob ein importierter Preis ohne menschliche Bestaetigung abrechenbar sein soll. | BAU-01, REQ-04, APR-03, `/portal/[mandant]/bau/projekte/[id]/lv/import` |
| O-632 | **Soll das Steuerkennzeichen einer LV-Position (§ 13b UStG — bei Bauleistungen ist der Wechsel der Steuerschuld der Regelfall) in der Oberflaeche erscheinen, und hinter welchem Recht — `bau.preis_lesen` wie der Einheitspreis, oder einem eigenen?** 0071 entzieht `cse_app` das `select` auf `lv_position` und erteilt eine erschoepfende Spaltenliste OHNE `einheitspreis_cent` UND ohne `steuer_kennzeichen`; fuer den Preis gibt es den gepruegten Leser `app.lv_preis_lesen`, fuer das Kennzeichen keinen. Bis zur Antwort zeigt die Positionsseite die Spalte nicht und sagt das (sichtbar als „offen (O-632)"); ein geratenes Kennzeichen entschied darueber, wer die Umsatzsteuer schuldet. | BAU-01, UStG § 13b, `/portal/[mandant]/bau/projekte/[id]/lv/[ozId]` |
| O-633 | **Soll eine Teildatei beim LV-Import das Leistungsverzeichnis FORTSCHREIBEN oder ERSETZEN — kommen die Positionen der aktuellen Fassung, die in der Datei fehlen, mit in die neue Fassung oder sind sie gestrichen?** Heute wird ersetzt: `uebernimmLvImport` baut die neue Fassung ausschliesslich aus den Zeilen der Datei, und `legeLvImportAn` vergleicht danach gegen diese Fassung. Eine Teillieferung des Auftraggebers macht damit aus einem LV mit 27 Positionen eine aktuelle Fassung mit drei. Das ist seit dem Pruefbefund nicht mehr still: die Vorschau zaehlt „Fehlen in der Datei" und listet die betroffenen OZ (`fehler_bericht.fehlendeOz`), und die alte Fassung bleibt vollstaendig lesbar. Welche Bedeutung eine Teildatei hat, entscheidet aber der Vertrag und nicht der Import — ein Nachtrags-LV liefert bewusst nur seine Positionen, ein korrigiertes Auftrags-LV bewusst alle. | BAU-01, REQ-04, `/portal/[mandant]/bau/projekte/[id]/lv/import` |

## Tests

- tests/kern/bau-abnahme-frist.test.ts
- tests/kern/bau-lv-quelle.test.ts (erweitert: Preis auf einer Nicht-Position wird verworfen und als HINWEIS gefuehrt, doppelte OZ wird zum Zeilenfehler mit Verweis auf die erste, CSV traegt keine Konfidenz)
- tests/kern/rechenansatz-lv.test.ts (erweitert: zaehltInSumme und zaehltPositionsartInSumme sagen fuer jede Positionsart dasselbe)
- tests/isolation/bau-abnahme.test.ts (erweitert: protokolliereAbnahme laeuft durch die Policies, dieselbe Eingabe wie die Saat; dazu neu: die zweite Gesamtabnahme ist AbnahmeFehler('schon_abgenommen', 409) und keine 500, die Teilabnahme danach bleibt moeglich, verknuepfeErsatzprotokoll verbindet Storno und Ersatz und verweigert lebende, fremde und selbstbezuegliche Verweise)
- tests/isolation/bau-lv-import.test.ts (erweitert: nach zwei Uebernahmen steht KEINE OZ zweimal in ladeLvAuswahl, die alte Fassung bleibt vollstaendig lesbar, die Vorschau nennt die fehlenden OZ, der erste Import meldet keine)
- tests/isolation/bau-seiten-abfragen.test.ts (NEU: jeder Leser der sechs Seiten gegen die echten Spaltenrechte, mit und ohne bau.preis_lesen; erweitert um ladeLvAuswahl/gruppiereLvAuswahl: nur Positionen, je Zeile das Verzeichnis, Gruppenbeschriftung mit Fassung)
- tests/e2e/aufmass.spec.ts (drei Faelle auf die neue Freigaberoute umgeschrieben)

## NICHT gebaut

- GAEB-Parser (DA XML X83/X84, D83, D84), Excel und PDF als LV-Quelle - Schnittstelle LvQuelle steht, die vier Formate sind in der Oberflaeche sichtbar und gesperrt, implementiert ist nur CSV (O-41 / O-97)
- Ableitung von gewaehrleistung_bis aus der Abnahme - Schnittstelle GewaehrleistungsFrist mit FRIST_OFFEN, Spalte bleibt NULL (O-154: 4 Jahre § 13 Abs. 4 VOB/B gegen 5 Jahre § 634a BGB)
- Anzeige von lv_position.steuer_kennzeichen - 0071 entzieht die Spalte zusammen mit dem Einheitspreis, ein Leser dafuer waere eine Rechteentscheidung (O-632)
- Pflichttage des Bautagebuchs - tageOhneBautagebuch zeigt heute jeden Kalendertag der letzten Woche ohne Eintrag und schreibt das hin (O-630)
- Uebernahme der Einheitspreise des Auftraggebers als Vertragspreise beim Import - heute wandern sie mit (nur durch app.lv_import_preis_lesen), ausdruecklich als offen markiert (O-631). NICHT gebaut ist eine Bestaetigungspflicht fuer importierte Preise: CSV traegt keine Konfidenz, also greift der vorhandene Weg (kern.aufmass_vorlage_pruefen, bestaetigeLvPosition) fuer sie nicht
- Fortschreibung statt Ersetzung beim LV-Import - eine Teildatei streicht heute, was in ihr fehlt; die Vorschau benennt es, die Fachfrage ist offen (O-633)
- PDF des Abnahmeprotokolls - kein Dokumentenspeicher verbunden; die Seite sagt 'nicht angehaengt', es wird kein Beleg erzeugt

## Notizen des Bauenden

ZWEI ECHTE FEHLER IN MEINEM EIGENEN CODE, gefunden erst durch Abfragen gegen echtes Postgres — beide haetten JEDEM Benutzer einen Serverfehler gezeigt, nicht eine Luecke, und beide waren im Typsystem und im Einheitstest unsichtbar:
(1) findeLvPosition las lv_position.steuer_kennzeichen. Ein Spalten-GRANT maskiert nicht, er verweigert: "permission denied for table lv_position", die ganze Positionsseite tot. Behoben (Spalte aus Abfrage und Schnittstelle, Platzhalter O-632 in der Oberflaeche).
(2) ladeNachtraegeJePosition schrieb `select n.*` in drei Vereinigungszweigen; n.* expandiert auf betrag_netto_cent, das 0080 genauso entzogen hat. Behoben (sechs benannte Spalten). Damit das nicht wiederkommt, ist tests/isolation/bau-seiten-abfragen.test.ts entstanden: jeder Leser der sechs Seiten wird einmal aufgerufen, mit bau.preis_lesen und ohne.

BEFUND AUSSERHALB MEINER DOMAENE, BLOCKIEREND FUER DIE GANZE ISOLATIONSSUITE (bitte weitergeben): app.ist_mitglied hat `p_stichtag date default CURRENT_DATE`, der Spaltenvorgabewert von benutzer_mandant.gueltig_ab ist aber app.berlin_heute() (0169). 0169 hat vierzehn Funktionskoerper auf berlin_heute() umgestellt und diesen ARGUMENTVORGABEWERT uebersehen. Die Zwei-Argument-Aufrufer sind kern.auftrag_verantwortlich_im_mandant (0025:266) und 0146:48. Folge: zwischen 22:00 UTC und Mitternacht (Sommerzeit; im Winter 23:00-24:00) ist berlin_heute() schon morgen und CURRENT_DATE noch heute, eine soeben angelegte Mitgliedschaft gilt nicht, und jedes Anlegen eines Auftrags scheitert mit "Der Verantwortliche gehoert nicht zu dieser Gesellschaft". Gemessen um 21:46 UTC: 52 von 52 Faellen gruen; um 22:05 UTC dieselben Dateien: 48 von 53 rot, und in den fuenf uebrigen Bau-Isolationsdateien 92 von 98 rot. Das trifft auch `pnpm db:seed`. Die Behebung ist eine Zeile in einer NEUEN Migration (nicht meine Nummer, nicht mein Objekt): create or replace function app.ist_mitglied(p_benutzer uuid, p_mandant uuid, p_stichtag date default app.berlin_heute()). Meine beiden Fixturen (bau-abnahme, bau-lv-import) und die neue Datei setzen gueltig_ab jetzt ausdruecklich auf current_date - 1, mit dem Befund als Kommentar an der Stelle; die fuenf aelteren Bau-Isolationsdateien habe ich NICHT angefasst, weil die zentrale Zeile sie alle erledigt.

ZWEI WEITERE FREMDE BEFUNDE (beim Gegenpruefen mitgelaufen, nicht von mir verursacht): (a) tests/isolation/unveraenderbarkeit.test.ts erwartet bei `truncate audit_log` die Meldung des Loeschsperr-Ausloesers, bekommt seit 0204 aber "cannot truncate a table referenced in a foreign key constraint" (audit_kettenglied zeigt auf audit_log) — die Sperre haelt, der Test misst den falschen Satz. (b) tests/isolation/schema-meta.test.ts (D-09) faellt, weil 0194_person_zusammenfuehren einen Fremdschluessel person.zusammengefuehrt_in_person_id -> person angelegt hat; der Test verlangt "person points at nothing". Ausserdem sind vier Typfehler im Baum, alle in src/app/portal/[mandant]/crm/... (Next-typed-routes auf eine noch fehlende Seite) — meine Pfade sind sauber.

KEINE KOLLISION BEI DEN O-NUMMERN — die fruehere Behauptung war falsch und ist hiermit zurueckgezogen: die beiden Treffer in src/server/services/radar/ted.ts:75 und tests/kern/radar-quellen.test.ts:244 lauten „ISO-639-3" und meinen den Sprachcode-Standard, keine offene Frage. Die hoechste in docs/DECISIONS.md vergebene Nummer ist O-596. Vergeben sind aus meinem Band (O-630 bis O-639) jetzt O-630, O-631, O-632 und neu O-633; O-634 bis O-639 sind frei.

WEITERE AUFRAEUMARBEIT IN MEINER DOMAENE: die O-155-Regel stand in zwei Fassungen — einmal im Dienst (zaehltInSumme) und einmal als Kopie im Koerper der Positionsseite. Jetzt gibt es zaehltPositionsartInSumme im Dienst, beide rufen sie, und ein Fall in tests/kern/rechenansatz-lv.test.ts nagelt fuer jede der sechs Positionsarten fest, dass die zwei Funktionen dasselbe sagen. Zwei Treffer der Wache anzeige-berlin auf der Projektseite (toLocaleString mit Optionen auf einer Zahl) sind durch den Hausformatierer prozent() ersetzt — ganzzahlige Basispunkte, kein Gleitkomma.

PRUEFSTAND: pnpm db:migrate auf eigener Datenbank (w_bau, danach noch einmal frisch als w_bau2) bis "Migrationen angewendet." durchgelaufen, mit allen inzwischen dazugekommenen Nummern anderer Agenten. 107 Kern-Faelle gruen (sechs Dateien), 58 Isolationsfaelle gruen (bau-abnahme, bau-lv-import, bau-seiten-abfragen) gegen echtes Postgres. npx tsc --noEmit: keine Meldung auf meinen Pfaden. eslint auf meinen Pfaden: still. scripts/guards/run-all.ts: von meinen Dateien nur die drei todo-client-nicht-im-register-Treffer (O-630, O-631, O-632) — sie verschwinden mit den drei Zeilen fuer docs/DECISIONS.md oben. Playwright habe ich nicht laufen lassen (verboten); tests/e2e/aufmass.spec.ts ist auf die neue Freigaberoute umgeschrieben und braucht einen Lauf.

DAS PROTOKOLL DER ABNAHME, kurz zur Einordnung fuer docs/DECISIONS.md (D-Nummern vergebe ich nicht selbst): die Abnahme ist einmalig je Projekt fuer die Gesamtleistung (partieller unique index ueber die wirksamen, nicht stornierten), eine Teilabnahme und eine Verweigerung sperren sie nicht und schlagen projekt.status nicht um; kunde_id kommt vom Projekt und wird als Eingabe verworfen; protokolliert_am ist Serverzeit; der Schnappschuss entsteht aus der EINGABE vor dem Einfuegen, weil snapshot_hash not null ist und die Maengel danach nur in derselben Transaktion dazukommen duerfen — sonst gaebe es zwei Maengellisten zu einem Protokoll. Die Gewaehrleistungsfrist rechnet ein Dienst, nie die Datenbank und nie die KI, und solange O-154 offen ist, rechnet sie nichts.
