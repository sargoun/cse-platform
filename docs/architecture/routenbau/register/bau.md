# Registereinträge: bau

**Warteschlange, kein Archiv.** Diese Einträge sind **noch nicht** im Baum. Die
gemeinsamen Dateien pflegt EINE Hand, weil mehrere Agenten gleichzeitig arbeiten
und sich sonst in dieselbe Zeile schreiben. Ist ein Abschnitt eingetragen, wird
er hier gelöscht — solange er hier steht, fehlt er dort.

**Die Einträge des Behebungsschritts gelten.** Er lief zuletzt und hatte den
Auftrag, die vollständige aktuelle Liste zu liefern — auch das, was sich seit
dem Bauschritt geändert hat.

## Stand

- Bau: fertig
- Kritik: 15 Befunde
- Behebung: 15 behoben, 0 widerlegt, 6 offen

## Migrationen (gegen eine eigene Datenbank gefahren: True)

- drizzle/0210_bau_abnahme_art.sql
- drizzle/0211_abnahme.sql
- drizzle/0212_lv_import.sql
- drizzle/0213_projekt_summe_lesen.sql
- (Behebung) drizzle/0214_lv_import_hinweis.sql — neue Spalte `lv_import_zeile.hinweise text[] not null default '{}'` plus `grant select (hinweise) on lv_import_zeile to cse_app` (0212 hat der Tabelle nur eine erschoepfende Spaltenliste erteilt, eine neue Spalte waere sonst unsichtbar). Trennt HINWEIS (Zeile kommt mit, etwas wurde angepasst) von FEHLER (Zeile kommt nicht mit) — noetig, weil `ist_gueltig` an der Leere von `fehler` haengt und ein verworfener Titel seine Positionen elternlos machte. Keine Tabelle, keine Loeschsperre, also keine Zeile in schema/rls.ts und keine in generate-triggers.ts.

## Gebaute Adressen

- `/portal/[mandant]/bau` — fertig
  - Moduluebersicht: Kachelzeile aus EINER Abfrage (ladeBauKennzahlen, neun Unterabfragen in einem Schnappschuss), dann offene Nachtraege mit der 14-Tage-Wachfrist (BAU-04), laufende Behinderungen ohne Wegfall (BAU-06), Bautage im Entwurf plus Tage ohne Eintrag (BAU-07, Pflichttage offen O-630), vorgelegte Aufmassblaetter (BAU-03), Ausserhalb-LV-Warnungen (BAU-05). KRITIK-Punkt Saat erledigt: behinderung war ungeseedet, jetzt drei Faelle (laufend / mit Wegfall / storniert); dazu neu eine Teilabnahme und ein wartender LV-Import in der Saat.
- `/portal/[mandant]/bau/projekte/[id]` — fertig
  - Projektkopf mit Vertragsgrundlage gross, Soll-/Ist-Terminen, Bauleitung, Gewaehrleistung als beschrifteter Platzhalter (O-154). Sechs Karten mit Zahlen. KRITIK zum falschen Recht umgesetzt: Auftragssumme und Sicherheitseinbehalt ueber die neue Leserfunktion app.projekt_summe_lesen (bau.preis_lesen, Mandantenpruefung, audit_log, KEINE Zeile statt 0 EUR); die Marge bleibt bei app.projekt_kennzahlen, ihr Recht kalkulation.lesen wird VORHER in SQL geprueft, damit keine Ausnahme die gebundene Transaktion abbricht. Prozentanzeige jetzt ueber den Hausformatierer prozent() aus bericht/ausgabe (ganzzahlige Basispunkte, kein toLocaleString auf einer Zahl - die Wache anzeige-berlin hatte zwei Treffer).
- `/portal/[mandant]/bau/projekte/[id]/abnahme` — fertig
  - Abnahmeprotokoll nach § 12 VOB/B: Art, Berliner Kalendertag, Leistungsumfang bei Teilabnahme, Teilnehmer beider Seiten, die zwei Vorbehalte getrennt mit protokolliertem Wortlaut (§ 11 Abs. 4 und § 12 Abs. 3), Maengelliste mit Frist und LV-Bezug, Verweigerung als vollwertiger Datensatz mit Grund. Schnappschuss und SHA-256 entstehen serverseitig VOR dem Einfuegen, Maengel nur in derselben Transaktion; Korrektur durch Storno mit Ersatz. gewaehrleistung_bis bleibt NULL hinter der Schnittstelle GewaehrleistungsFrist (O-154). Das unterschriebene Papier steht als nicht angehaengt da - kein Dokumentenspeicher verbunden, kein PDF vorgetaeuscht.
- `/portal/[mandant]/bau/projekte/[id]/aufmass/[aufmassId]/freigabe` — fertig
  - Die Seite zeigt, WAS gegengezeichnet wird: Kopf, alle Zeilen mit Rechenansatz und Ergebnis, Messfotos, vorhandene Signaturen mit Digest - gemeinsame Bausteine in AufmassTeile.tsx, damit Blatt- und Freigabeansicht dasselbe zeigen. Fehlt etwas, stehen die Hindernisse aus pruefeVorlage; ist das Blatt gesperrt, der Satz zur Unveraenderlichkeit mit dem Weg ueber Storno. Das Formular postet auf den bestehenden Endpunkt, der Schnappschuss bleibt serverseitig. KRITIK-Punkt erledigt: das Formular ist von der mit bau.lesen bewachten Detailseite hierher verlegt, dort steht nur noch ein Verweis hinter haeltRechte('bau.aufmass_freigeben'), und die drei gruenen Playwright-Faelle in tests/e2e/aufmass.spec.ts sind auf den neuen Weg umgeschrieben.
- `/portal/[mandant]/bau/projekte/[id]/lv/[ozId]` — fertig
  - OZ, Brotkrume aus dem Baum (rekursiv ueber eltern_id, nicht aus dem Pfad), Kurz- und Langtext, Einheit, Vertragsmenge, Einheitspreis und Betrag nur ueber app.lv_preis_lesen (sonst ausdruecklicher Hinweis, nie 0). Gegenueberstellung aufgemessene gegen Vertragsmenge mit Mehrmengenwarnung (BAU-05), die buchenden Aufmassblaetter, Herkunft (quelle_seite, quelle_bereich, Konfidenz, Pruefstand) und der Bestaetigungsknopf hinter bau.schreiben. O-155 steht wortgleich wie im LV-Baum. Die Regel selbst wohnt jetzt im Dienst (zaehltPositionsartInSumme) statt in einer zweiten Fassung im Seitenkoerper.
- `/portal/[mandant]/bau/projekte/[id]/lv/import` — fertig
  - Eine Adresse, zwei Zustaende wie OPS-04: ohne ?import= das Formular (Datei, Format - die Auswahl nennt die nicht implementierten Formate sichtbar und gesperrt, O-41), mit ?import= die Vorschau aus dem SERVERSEITIGEN Staging, je Zeile OZ, Art, Kurztext, Menge, Einheit, Preis, Aktionspille (anlegen / aktualisieren / unveraendert / ignorieren) und die Fehler je Zeile, oben die drei Zaehler. Der Parser liegt hinter der Schnittstelle LvQuelle; implementiert ist CSV (Semikolon) ueber den vorhandenen Leser aus raumbuch/tabelle.ts, alles andere wird abgewiesen statt halb gelesen. Uebernommen wird in eine NEUE Fassung; jede maschinell gelesene Position traegt Konfidenz und bleibt ungeprueft.

## src/server/registry/dienste.ts

UNVERAENDERT gegenueber dem Bauschritt — vier Eintraege in src/server/registry/dienste.ts, im Bau-Block:

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

Drei Eintraege in src/server/auth/route-manifest.ts, im Bau-Block (nach 'api/bau/behinderungen/[id]/wegfall'). GEAENDERT gegenueber dem Bauschritt: im dritten Kommentar steht jetzt der richtige Ausloesername (`kern.aufmass_vorlage_pruefen()` statt des nicht existierenden `bau.pruefe_lv_geprueft()`).

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

UNVERAENDERT gegenueber dem Bauschritt — 0214 bringt KEINE neue Zeile (sie legt weder Tabelle noch Loeschsperre an, nur eine Spalte auf der schon registrierten `lv_import_zeile`).

(1) In KEIN_HARD_DELETE ans Ende einfuegen (der letzte vorhandene Eintrag endet ohne Komma, also erst `},` daraus machen):

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

(3) AUDITIERT bekommt NICHTS, und das ist eine Entscheidung: `abnahme` friert mit dem Einfuegen ein (`kern.abnahme_einfrieren` weist jede Protokollspalte ab), beweglich sind nur Storno, `ersetzt_durch_id` und die Aufbewahrung — ein Auditeintrag mit Vorher/Nachher haette dort nichts zu zeigen, was nicht schon in eigenen Spalten steht. Jeder LESENDE Zugriff auf die Vertragssumme steht ohnehin im audit_log (app.projekt_summe_lesen protokolliert). `lv_import_zeile` traegt bewusst KEINE Loeschsperre: cse_job raeumt die Zwischenzeilen nach der Uebernahme (Policy t_job_raeumen), der Kopf bleibt.

(4) `lv_import_zeile` gehoert NICHT in NUR_UEBER_DEFINER: die Tabelle hat eine Mandantenpolicy und einen Spalten-GRANT ohne einheitspreis_cent/rohdaten; der Preis kommt ueber app.lv_import_preis_lesen (geprueft in tests/isolation/bau-lv-import.test.ts).

## src/server/registry/navigation.ts

UNVERAENDERT gegenueber dem Bauschritt. In src/server/registry/navigation.ts den Kommentar (Zeilen 206-212) und den Eintrag (Zeile 213) ersetzen — der alte Kommentar begruendet genau den Zustand, der jetzt weg ist:

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

(0) NEU: drizzle/0214_lv_import_hinweis.sql. Eine Spalte `lv_import_zeile.hinweise text[] not null default '{}'` plus `grant select (hinweise) on lv_import_zeile to cse_app`. Sie braucht KEINE Zeile in schema/rls.ts und keine in scripts/generate-triggers.ts: die Tabelle steht mit ihrem Eintrag schon im Register (0212), und 0214 legt weder Tabelle noch Loeschsperre an. Gegen eine frisch angelegte, vollstaendig migrierte Datenbank gefahren.

(A) scripts/generate-triggers.ts — MIGRATIONS_DATEIEN braucht zwei Zeilen, sonst faellt tests/kern/loeschsperre.test.ts mit „path argument must be of type string" (die beiden neuen Nummern stehen dann in MIGRATIONEN, haben aber keine Datei im Register):

  '0211': join(WURZEL, 'drizzle/0211_abnahme.sql'),
  '0212': join(WURZEL, 'drizzle/0212_lv_import.sql'),

(B) Danach EINMAL `pnpm db:triggers` laufen lassen (ich habe es nicht ausgefuehrt). Der Lauf aendert nur src/server/db/triggers/no-hard-delete.sql; erzeuge(m) stimmt fuer alle Migrationen mit dem Block in der Datei, auch fuer 0211 und 0212.

(C) NICHTS zu aendern an: routen.generiert.ts (alle sechs Pfade stehen mit den richtigen Rechten in den Zeilen 150-168), katalog.generiert.ts (bau.lesen, bau.schreiben, bau.aufmass_freigeben, bau.preis_lesen vorhanden), kennzahlen.ts, tableiste.ts, modul.ts, docs/architecture/04-SEITENKARTE.md, docs/DESIGN.md (kein neuer Gestaltungswert — s2/s3/s4/s5/s6, text-h1/h3/sm/xs/micro, text-warning/danger/muted/subtle, rounded-lg/md sind alle vorhanden; die Kachelzeile waechst nur von vier auf fuenf Eintraege im bestehenden KachelRaster, die Vorschautabelle von fuenf auf sechs Spalten im bestehenden sm:grid-cols-Raster).

(D) Hinweis zur Bewachung der Abnahmeseite: `/portal/[mandant]/bau/projekte/[id]/abnahme` traegt laut Seitenkarte `bau.schreiben` als LESERECHT. Die Seite hat deshalb jetzt keine Rechtezweige mehr im Koerper. Sollen Abnahmeprotokolle auch mit `bau.lesen` LESBAR sein, ist das eine Aenderung der Seitenkarte (lesen: bau.lesen / schreiben: bau.schreiben) — dann muessen die Zweige zurueck; die Stelle ist im Seitenkopf benannt. Dasselbe gilt fuer die RLS-Policy `t_mandant` auf `abnahme`, deren `using` ohnehin `bau.lesen` verlangt.

## Zeilen für docs/DECISIONS.md, Abschnitt „Offen"

| O-630 | **An welchen Tagen wird ein Bautagebucheintrag erwartet — an jedem Kalendertag, an jedem Werktag oder nach Bauzeitenplan?** § 3 Abs. 3 VOB/B verlangt die Fuehrung, nicht eine Taktung. Die Moduluebersicht zeigt deshalb heute jeden Kalendertag der letzten sieben Tage ohne Eintrag und schreibt daneben, dass die Pflichttage offen sind (`tageOhneBautagebuch`, `bau/uebersicht.ts`); ein unterstellter Werktagskalender machte aus einem Samstag ohne Arbeit eine Luecke im Bauzeitnachweis und aus einem stillen Baustopp einen vollstaendigen Nachweis. | BAU-07, `/portal/[mandant]/bau` |
| O-631 | **Uebernimmt der LV-Import die Einheitspreise des Auftraggebers als Vertragspreise, oder werden sie nach der Uebernahme kalkuliert und eingetragen?** Heute wandert der gelesene Preis mit in die neue Fassung (`uebernimmLvImport`), und zwar nur durch `app.lv_import_preis_lesen` — wer `bau.preis_lesen` nicht haelt, uebertraegt ihn nicht. Er wird dabei NICHT als unbestaetigt gefuehrt: die einzige implementierte Quelle ist CSV, und `CSV_QUELLE` setzt bewusst `konfidenz: null`, weil eine woertlich gelesene Spalte kein Modell geraten hat. Damit greifen `istUngeprueftMaschinell`, das Hindernis in `kern.aufmass_vorlage_pruefen()` (0072) und `bestaetigeLvPosition` fuer CSV-Positionen NICHT — diese Sicherung beginnt erst bei einem extrahierenden Leser (PDF, Bild, O-41). Kommt das LV als Ausschreibung ohne Preise, ist die Uebernahme des leeren Feldes richtig; kommt es als Auftrags-LV mit Preisen, ist der Preis Vertragsinhalt. Die Antwort entscheidet, ob die Vorschau eine Preisspalte fuehren darf und ob ein importierter Preis ohne menschliche Bestaetigung abrechenbar sein soll. | BAU-01, REQ-04, APR-03, `/portal/[mandant]/bau/projekte/[id]/lv/import` |
| O-632 | **Soll das Steuerkennzeichen einer LV-Position (§ 13b UStG — bei Bauleistungen ist der Wechsel der Steuerschuld der Regelfall) in der Oberflaeche erscheinen, und hinter welchem Recht — `bau.preis_lesen` wie der Einheitspreis, oder einem eigenen?** 0071 entzieht `cse_app` das `select` auf `lv_position` und erteilt eine erschoepfende Spaltenliste OHNE `einheitspreis_cent` UND ohne `steuer_kennzeichen`; fuer den Preis gibt es den gepruegten Leser `app.lv_preis_lesen`, fuer das Kennzeichen keinen. Bis zur Antwort zeigt die Positionsseite die Spalte nicht und sagt das (sichtbar als „offen (O-632)"); ein geratenes Kennzeichen entschied darueber, wer die Umsatzsteuer schuldet. | BAU-01, UStG § 13b, `/portal/[mandant]/bau/projekte/[id]/lv/[ozId]` |
| O-633 | **Soll eine Teildatei beim LV-Import das Leistungsverzeichnis FORTSCHREIBEN oder ERSETZEN — kommen die Positionen der aktuellen Fassung, die in der Datei fehlen, mit in die neue Fassung oder sind sie gestrichen?** Heute wird ersetzt: `uebernimmLvImport` baut die neue Fassung ausschliesslich aus den Zeilen der Datei, und `legeLvImportAn` vergleicht danach gegen diese Fassung. Eine Teillieferung des Auftraggebers macht damit aus einem LV mit 27 Positionen eine aktuelle Fassung mit drei. Das ist seit dem Pruefbefund nicht mehr still: die Vorschau zaehlt „Fehlen in der Datei" und listet die betroffenen OZ (`fehler_bericht.fehlendeOz`), und die alte Fassung bleibt vollstaendig lesbar. Welche Bedeutung eine Teildatei hat, entscheidet aber der Vertrag und nicht der Import — ein Nachtrags-LV liefert bewusst nur seine Positionen, ein korrigiertes Auftrags-LV bewusst alle. | BAU-01, REQ-04, `/portal/[mandant]/bau/projekte/[id]/lv/import` |

## Befunde des Prüfers (15)

- **blockierend** · `/home/user/cse-platform/src/server/services/bau/lv-import.ts:435 (uebernimmLvImport) zusammen mit /home/user/cse-platform/src/server/services/bau/lv.ts:402 (ladeLvAuswahl)` — Die Uebernahme legt eine NEUE Fassung des Hauptauftrag-LV an und archiviert die alte NICHT (kein `archiviert_am` auf dem alten Kopf, kein `archiviert_am` auf dessen Positionen). `ladeLvAuswahl` filtert aber nur `where l.projekt_id = $1 and l.art = 'position' and l.archiviert_am is null` — OHNE Verzeichnis- oder Fassungsbezug. Nach dem ersten Import enthaelt damit jede Positionsauswahl JEDE OZ doppelt (Fassung 1 und Fassung 2), angezeigt nur als `{oz} · {kurztext}`, ohne Unterscheidungsmerkmal. Betroffen sind die Aufmasserfassung (aufmass/neu/page.tsx:73) und die Maengelliste der neuen Abnahmeseite (abnahme/page.tsx:89). Wird eine Aufmasszeile auf die Position der ALTEN Fassung gebucht, ist das ein falsches Ergebnis und kein Anzeigefehler: `findeLvPosition` summiert `menge_aufgemessen` je `lv_position_id`, die Position der aktuellen Fassung steht also weiter auf 0, die Mehrmengenwarnung nach § 2 Abs. 3 VOB/B (BAU-05) feuert nie, und die Menge haengt am Einheitspreis einer ueberholten Fassung.
  - Behebung: Entweder `uebernimmLvImport` archiviert die Vorfassung in derselben Transaktion (`archiviert_am`/`archiviert_von` auf `leistungsverzeichnis` und deren `lv_position`) — dann bleibt sie als Beleg lesbar, verschwindet aber aus jeder Auswahl —, oder `ladeLvAuswahl` bekommt einen Verzeichnisbezug (juengste lebende Fassung des Hauptauftrags plus die Nachtrags-LVs) und die Anzeige nennt je Zeile Verzeichnis und Fassung. Beides mit einem Isolationsfall belegen: nach einer Uebernahme darf keine OZ zweimal in `ladeLvAuswahl` stehen.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/bau/page.tsx:396 und :440` — Die neue Moduluebersicht traegt `bau.lesen` (routen.generiert.ts:150), verlinkt aber ungeschuetzt auf `/portal/[mandant]/bau/projekte/[id]/bautagebuch/[datum]`, und diese Route verlangt `bau.schreiben` (routen.generiert.ts, Zeile fuer `bautagebuch/[datum]`: `lesen:["bau.schreiben"]`). Ein fehlendes Recht endet in `notFound()` (src/app/portal/zugang.ts:397-405) — wer nur `bau.lesen` haelt, sieht in beiden Abschnitten (Bautage im Entwurf, Tage ohne Eintrag) anklickbare Tage und landet auf 404. Das ist genau der Fehler, den derselbe Agent auf der Aufmassdetailseite behoben hat, und das Haus hat dafuer ein Muster.
  - Behebung: `const darf = await haeltRechte(sitzung, 'bau.schreiben')` in die Uebersicht aufnehmen und beide Tageslinks (Spalte `datum` der Entwurfstabelle, Listenelement der Luecken) wie in bau/bautagebuch/page.tsx nur bei gehaltenem Recht als Link ausgeben, sonst als Text.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/bau/projekte/[id]/page.tsx:207-213` — Die Projektdetailseite traegt `bau.lesen`, die Karte „Abnahme" zeigt aber unbedingt auf `…/projekte/[id]/abnahme`, und diese Route ist mit `bau.schreiben` bewacht (routen.generiert.ts, Zeile `/portal/[mandant]/bau/projekte/[id]/abnahme` → `lesen:["bau.schreiben"]`). Fuer jeden Benutzer mit `bau.lesen` ohne `bau.schreiben` ist die sechste Karte ein 404 — dieselbe Klasse Fehler wie oben, und sie steht in derselben Kachelzeile wie fuenf funktionierende Karten.
  - Behebung: `haeltRechte(sitzung, 'bau.schreiben')` holen und die Abnahmekarte entweder weglassen oder als nicht verlinkte Kachel mit dem Satz ausgeben, dass das Protokoll `bau.schreiben` verlangt — so wie es die Aufmassdetailseite jetzt fuer `bau.aufmass_freigeben` tut.
- **wichtig** · `/home/user/cse-platform/src/server/services/bau/lv-import.ts:466 und /home/user/cse-platform/src/app/portal/[mandant]/bau/projekte/[id]/lv/import/page.tsx:368-374` — Die neue Fassung entsteht AUSSCHLIESSLICH aus den Zeilen der Datei. Positionen, die in der aktuellen Fassung stehen und in der Datei FEHLEN, kommen nicht mit — die Vorschau erwaehnt das nirgends, und der Begleittext behauptet das Gegenteil: „In die neue Fassung gehen alle gültigen Zeilen, auch die unveränderten; sonst wäre die neue Fassung unvollständig. Nur fehlerhafte Zeilen bleiben zurück." Es gibt keine vierte Aktion („fehlt in der Datei") und keinen Zaehler dafuer. Eine Teillieferung des Auftraggebers — genau der Fall, den die Saat mit vier Zeilen vorfuehrt — macht damit aus einem LV mit 27 Positionen eine aktuelle Fassung mit drei, und `legeLvImportAn` vergleicht ab dann gegen diese verkuerzte Fassung (`order by lv.fassung desc limit 1`, Zeile 191-200).
  - Behebung: Die Vorschau muss die Streichungen benennen: aus dem Bestandsabgleich die OZ ermitteln, die in der Datei nicht vorkommen, sie als eigene Zaehlung („N Positionen der aktuellen Fassung fehlen in dieser Datei") und als Liste zeigen, und den irrefuehrenden Satz ersetzen. Ob eine Teildatei die fehlenden Positionen uebernehmen soll, ist eine Fachfrage — dann als `TODO(client, O-NN)` mit Registerzeile, nicht stillschweigend so oder anders entscheiden.
- **wichtig** · `/home/user/cse-platform/src/server/services/bau/lv-quelle.ts:190-207 (arteAus) und /home/user/cse-platform/src/server/services/bau/lv-import.ts:532-546` — Die Uebernahme schreibt `einheitspreis_cent = app.lv_import_preis_lesen(...)` fuer JEDE Zeile, auch fuer `los`, `titel`, `untertitel` und `hinweistext`. `lv_position` traegt aber die Bedingung `lvp_preis_nur_position CHECK (art = 'position' OR einheitspreis_cent IS NULL)`. Eine Titelzeile mit Preis in der EP-Spalte (Titelsumme — in exportierten LV-Tabellen ueblich) wird von `arteAus` als `titel` eingeordnet (kein Preis-Bezug in der Ableitung), erhaelt keinen Zeilenfehler, steht in der Vorschau als gueltig — und die Uebernahme bricht mit einem unbehandelten Datenbankfehler ab. Der Parser nimmt ausdruecklich zwei der drei Positionsbedingungen vorweg (`lvp_einheit_bei_position`, `lvp_menge_bei_position`, Kommentar lv-quelle.ts:305-311) und uebersieht die dritte.
  - Behebung: In `CSV_QUELLE.lese` denselben Vorgriff wie bei Einheit und Menge ergaenzen: ein Preis auf einer Zeile, die nicht `position` ist, wird entweder verworfen (Preis auf `null` und Hinweis in `fehler`) oder macht die Zeile ungueltig. Ein Kernfall in tests/kern/bau-lv-quelle.test.ts dazu.
- **wichtig** · `/home/user/cse-platform/src/server/services/bau/lv-quelle.ts:262-345 (CSV_QUELLE.lese) und /home/user/cse-platform/src/server/services/bau/lv-import.ts:521-550` — Zwei Dateizeilen mit derselben OZ werden beide als gueltig gelesen (der Parser prueft OZ nur auf Leere) und beide als `anlegen`/`aktualisieren` in der Vorschau gezeigt. `lv_position` traegt `lv_position_oz_uk UNIQUE (leistungsverzeichnis_id, oz)`, also scheitert die Uebernahme mitten in der Schleife mit `unique_violation` — wieder ein unbehandelter 500 nach einer gruenen Vorschau. Zusaetzlich ueberschreibt `idJeOz.set(z.oz, neu.id)` (Zeile 548) stillschweigend den Elternteil-Eintrag, `angelegt: idJeOz.size` zaehlte dann falsch.
  - Behebung: Doppelte OZ beim Lesen erkennen: die zweite und jede weitere Zeile mit bereits vergebener OZ bekommt einen Zeilenfehler („OZ x steht in Zeile n schon") und damit `ignorieren`. Ergaenzend `lv_position_oz_uk` in `uebernimmLvImport` als `LvImportFehler` uebersetzen, damit ein Restfall eine Auskunft und keine 500 ergibt.
- **wichtig** · `/home/user/cse-platform/src/server/services/bau/lv-quelle.ts:340, /home/user/cse-platform/src/server/db/seed/bau.ts:1118-1128, /home/user/cse-platform/docs/architecture/routenbau/register/bau.md:189 (Zeile O-631 fuer DECISIONS.md)` — Die vorgeschlagene Registerzeile O-631 sagt: der importierte Preis „bleibt aber als maschinell gelesen und ungeprueft markiert, bis ein benannter Mensch ihn bestaetigt — ein Aufmass kann auf einer solchen Position nicht gegengezeichnet werden". Fuer das EINZIGE implementierte Format gilt das nicht: `CSV_QUELLE` setzt `konfidenz: null` (bewusst, Zeile 338-340), die Uebernahme schreibt diese NULL weiter, und damit ist `istUngeprueftMaschinell` (lv.ts:259) falsch, das Hindernis in `kern.aufmass_vorlage_pruefen()` greift nicht, die Pille „maschinell gelesen, unbestätigt" erscheint nicht, und `bestaetigeLvPosition` (lv.ts:779, `where … konfidenz is not null`) trifft null Zeilen — der ganze Bestaetigungsweg samt neuem Endpunkt ist fuer importierte Positionen unerreichbar. Die Registerzeile beschreibt eine Sicherung, die es auf dem gebauten Pfad nicht gibt; derselbe falsche Satz steht im Saatkommentar.
  - Behebung: Entweder die Registerzeile O-631 und den Saatkommentar auf den tatsaechlichen Zustand bringen (CSV ist woertlich gelesen, traegt keine Konfidenz, wird NICHT als unbestaetigt gefuehrt — die Sicherung greift erst bei einem extrahierenden Leser), oder eine bewusste Entscheidung treffen, dass der Import Preise ohne Bestaetigung nicht abrechenbar macht, und sie umsetzen. Ein Satz im Register, der eine nicht vorhandene Finanzkontrolle behauptet, ist das Gefaehrlichste an dieser Route.
- **wichtig** · `/home/user/cse-platform/src/server/services/bau/abnahme.ts:445 (protokolliereAbnahme) und /home/user/cse-platform/src/app/api/bau/abnahmen/route.ts:168-181` — Die Einmaligkeit der Gesamtabnahme steht nur als partieller Unique-Index in der Datenbank (`abnahme_gesamt_uk`). `pruefeAbnahme` prueft sie nicht, `protokolliereAbnahme` faengt sie nicht, und der `catch` der Route uebersetzt nur `AbnahmeFehler` — ein zweiter Protokollversuch (zwei offene Tabs, Doppelklick, oder der Weg ueber den Endpunkt) endet als unbehandelte Ausnahme und damit als 500. Der Fehlergrund `'schon_abgenommen'` ist im `AbnahmeFehler`-Typ deklariert (Zeile 53) und wird an keiner Stelle geworfen; `'gesperrt'` ebenso.
  - Behebung: `abnahme_gesamt_uk` in `protokolliereAbnahme` wie im Hausmuster auf `AbnahmeFehler('schon_abgenommen', …, 409)` uebersetzen — oder die beiden ungenutzten Gruende aus dem Typ entfernen, damit der Typ nicht mehr behauptet, es gaebe diese Antwort.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/bau/projekte/[id]/abnahme/page.tsx:401-411` — Sobald eine wirksame Gesamtabnahme steht, ersetzt die Seite das GANZE Formular durch einen Hinweis — und dieser Hinweis sagt selbst: „eine weitere Teilabnahme ist nach § 12 Abs. 2 VOB/B möglich, solange sie einen anderen Teil betrifft". Genau das ist danach nicht mehr moeglich: es gibt kein Formular, und der Dienst und der Index erlauben beliebig viele Teilabnahmen (Index nur `WHERE abgenommen AND art <> 'teilabnahme'`, Isolationsfall „und mehrere Teilabnahmen sind zulässig", bau-abnahme.test.ts:214). Die Seite widerspricht ihrem eigenen Satz und dem getesteten Verhalten des Dienstes.
  - Behebung: Bei vorhandener Gesamtabnahme das Formular stehen lassen und auf die noch zulaessigen Faelle einschraenken — Art fest auf `teilabnahme` (und die Verweigerung), Leistungsumfang als Pflichtfeld —, mit dem Hinweis darueber. Oder den Satz aus dem Hinweis streichen; das Widersprechen ist das Problem, nicht die Beschraenkung.
- **wichtig** · `/home/user/cse-platform/src/server/services/bau/abnahme.ts:615-639 und /home/user/cse-platform/src/app/api/bau/abnahmen/route.ts:85-90` — „Korrektur durch Storno mit Ersatzprotokoll" ist der erklaerte Korrekturweg (Dateikopf abnahme.ts:24-28, Seitentexte, Registerbegruendung fuer KEIN_HARD_DELETE), aber `ersetzt_durch_id` wird von keinem erreichbaren Pfad geschrieben: `storniereAbnahme` nimmt `ersetztDurchId` optional, die Route uebergibt es nie (sie liest nur `abnahme` und `storno_grund`), und das Formular hat kein Feld dafuer. Die Anzeige liest die Spalte (`ABNAHME_SPALTEN`, Zeile 252) und rendert sie nirgends. Ergebnis: das stornierte Protokoll und sein Ersatz stehen unverbunden nebeneinander, die Kette, die den Storno rechtfertigt, entsteht nicht.
  - Behebung: Beim Protokollieren nach einem Storno das Ersatzprotokoll verbinden: entweder ein verstecktes `ersetzt` im Protokollformular (die Seite kennt das stornierte Protokoll) und `storniereAbnahme`/ein Nachtrag-Update im selben Vorgang, oder ein zweiter Schritt „Ersatz zuordnen" hinter `bau.schreiben`. Und die Verbindung in der Protokollliste beidseitig anzeigen.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/bau/page.tsx:85` — Die Uebersicht laedt mit `listeAufmasse(kontext)` JEDES lebende Aufmassblatt des Mandanten — je Blatt vierzehn Spalten und zwei Unterabfragen (Zeilen- und Fotozaehlung) — und filtert danach in TypeScript auf `status === 'vorgelegt'` (Zeile 97). Das ist genau das Muster, gegen dessen Kosten der neue Dienst `bau/uebersicht.ts` in seinem Dateikopf argumentiert („Zweihundert Zeilen zu laden, um sie zu zaehlen, ist auf einem Baustellentelefon der Unterschied zwischen einer Seite und einer Wartezeit"). Fuer Nachtraege (`nurOffen`), Behinderungen (`nurLaufend`) und Bautage (`nurOffene`, `grenze`) wurde jeweils ein Filter mitgebaut, fuer Aufmasse nicht — `listeAufmasse` kennt nur `projektId`.
  - Behebung: `listeAufmasse` um `status`/`nurVorgelegte` und eine Grenze erweitern (wie `listeBautage` sie hat) und die Uebersicht damit aufrufen; der JS-Filter faellt weg. `ladeAusserhalbLv(kontext)` ohne Projektfilter waechst auf derselben Seite genauso — mindestens eine Grenze ziehen.
- **klein** · `/home/user/cse-platform/src/server/services/bau/lv.ts:768 und /home/user/cse-platform/src/app/api/bau/lv-positionen/[id]/bestaetigung/route.ts:18` — Die Begruendung des neuen Endpunkts steht auf einer Funktion, die es nicht gibt: `bau.pruefe_lv_geprueft()` kommt weder in `drizzle/*.sql` noch in der lebenden Datenbank vor. Die Pruefung, die tatsaechlich greift, steckt in `kern.aufmass_vorlage_pruefen()` (0072:550-572, Bedingung `l.konfidenz is not null and l.geprueft_am is null`). Der falsche Name steht schon vorher einmal in lv.ts:254, ist jetzt aber in zwei neuen Stellen und im vorgeschlagenen route-manifest-Kommentar wiederholt — wer die genannte Sicherung nachlesen will, findet sie nicht.
  - Behebung: In lv.ts:254, lv.ts:768, bestaetigung/route.ts:18 und im route-manifest-Kommentar auf `kern.aufmass_vorlage_pruefen()` (0072) korrigieren.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/bau/projekte/[id]/abnahme/page.tsx:394` — Die Seite verzweigt dreimal auf `darf['bau.schreiben']`, obwohl die Route selbst mit `bau.schreiben` als LESERECHT bewacht ist (routen.generiert.ts: `…/abnahme` → `lesen:["bau.schreiben"]`). Ohne das Recht wird die Seite nie gerendert, der Zweig „Protokollieren darf, wer bau.schreiben hält" und die beiden Formularbedingungen sind unerreichbar. Das liest sich wie eine Absicherung und ist keine.
  - Behebung: Entweder die drei Bedingungen samt `haeltRechte`-Aufruf entfernen und in einem Satz festhalten, dass das Recht an der Tuer haengt — oder, falls die Abnahmeprotokolle auch mit `bau.lesen` lesbar sein sollen, die Seitenkarte auf `lesen: bau.lesen` / `schreiben: bau.schreiben` aendern; dann tragen die Bedingungen wieder etwas.
- **klein** · `/home/user/cse-platform/docs/architecture/routenbau/register/bau.md:18 und :221` — Zwei Angaben im eingecheckten Register stimmen nicht. (1) „behinderung … jetzt drei Faelle (laufend / mit Wegfall / storniert)": die Saat legt `laufend`, `weggefallen` und `entwurf` an — eine STORNIERTE Behinderung wird nirgends erzeugt, der Ausschluss `storniert_am is null` in `ladeBauKennzahlen` und `findeProjektDetail` bleibt damit unbelegt. (2) „KOLLISION BEI DEN O-NUMMERN: O-639 ist schon belegt": die beiden genannten Treffer sind „ISO-639-3" (der Sprachcode-Standard), keine offene Frage. Die hoechste vergebene O-Nummer in docs/DECISIONS.md ist O-596.
  - Behebung: Registertext korrigieren. Wenn der stornierte Fall vorgefuehrt werden soll, eine vierte Behinderung mit `storniert_am` in die Saat aufnehmen; sonst die Aufzaehlung auf „laufend / mit Wegfall / Entwurf" richtigstellen.
- **klein** · `/home/user/cse-platform/src/server/services/bau/lv.ts:534 und /home/user/cse-platform/src/server/services/bau/uebersicht.ts:43` — Zwei gelesene Felder werden nie angezeigt: `LvPositionDetail.quelle_bereich` wird abgefragt, aber die Positionsseite rendert nur `quelle_seite` und `gaeb_dp` (der Bericht behauptet „Herkunft (quelle_seite, quelle_bereich, Konfidenz, Pruefstand)"), und `BauKennzahlen.abnahmen` wird in einer der neun Unterabfragen gezaehlt, ohne dass die Uebersicht eine Kachel oder Zeile dafuer hat.
  - Behebung: Beides entweder anzeigen (Bereich als Fundstelle im Herkunftsblock, Abnahmen als fuenfte Kachel mit Ziel auf ein Projekt) oder aus Abfrage und Schnittstelle entfernen — eine mitgelesene Spalte ohne Leser ist die naechste, die jemand fuer vorhanden haelt.

**Urteil:** Die sechs Adressen sind ECHT gebaut, keine Huelsen: jede Seite laedt ihre Zeilen in EINER gebundenen Transaktion, ruft die Dienste wirklich, und alle Leser laufen gegen echtes Postgres durch — ich habe `ladeBauKennzahlen`, `tageOhneBautagebuch`, `findeProjektDetail` (inklusive `left join lateral app.projekt_summe_lesen`), `ladeProjektMarge`, `findeLvPosition`, `ladeLvPfad`, `ladeNachtraegeJePosition`, `ladeAufmasseJePosition`, `listeAbnahmen`, `ladeMaengel`, `findeLvImport`, `ladeLvImportZeilen` und die Bestandsabfrage des Imports als `cse_app` mit gesetzten K-02-GUCs auf w_kupo_seed ausgefuehrt: kein Spaltenrechte-, kein Enum-, kein Namensfehler. Die beiden Selbstbefunde des Bauenden (steuer_kennzeichen, `select n.*`) sind tatsaechlich behoben. Enums stimmen alle (`projekt_status geplant|in_arbeit`, `nachtrag_status angemeldet`, `behinderung_status freigegeben|angezeigt`, `aufmass_status vorgelegt`, `bautagebuch_status entwurf`). 0211/0212 sind sauber: `mandant_id`, `enable`+`force row level security`, Policy je Rolle, Kundendecke bzw. interne Decke, erschoepfende Spalten-GRANTs ohne `einheitspreis_cent`/`rohdaten`, Definer mit `owner to cse_definer` + `revoke all … from public`, Loeschsperre und Serverzeit-Ausloeser; 0213 gibt bei fehlendem Recht KEINE Zeile statt 0 EUR, und `cse_definer` hat das noetige Spaltenrecht auf `projekt`. Geld ist durchgehend `bigint`/Cent als Text, Prozent laeuft ueber `prozent()` auf Basispunkten, Zeitstempel sind `timestamptz` und werden nur zur Anzeige nach Europe/Berlin gedreht, Kalendertage kommen aus `app.berlin_heute()`. Kein erfundener Gestaltungswert (kein Hex, kein `p-[13px]`), keine vorgetaeuschte Integration (PDF und Dokumentenspeicher stehen ausdruecklich als nicht verbunden, nicht implementierte LV-Formate werden abgewiesen). Die drei Kern-Testdateien laufen gruen (54 Faelle), `npx tsc --noEmit` auf einer auf die Bau-Pfade beschraenkten tsconfig ist still, die Wachen melden nur die drei erwarteten `todo-client`-Treffer, und der Umbau der Aufmassdetailseite hat nichts entfernt (die drei Bloecke sind woertlich nach AufmassTeile.tsx gewandert, die Playwright-Faelle gehen den neuen Weg).

Sechzehn Befunde bleiben. Der schwerste ist BLOCKIEREND und betrifft die Folge des neuen Imports auf vorhandenen Code: `ladeLvAuswahl` filtert nicht auf das Verzeichnis, und die Uebernahme archiviert die Vorfassung nicht — nach dem ersten Import steht jede OZ zweimal in der Positionsauswahl von Aufmasserfassung und Abnahmemaengeln, und eine auf der ueberholten Fassung gebuchte Menge fehlt in der BAU-05-Gegenueberstellung der aktuellen. Danach zwei Navigationsloecher derselben Klasse, die der Bauende an anderer Stelle gerade behoben hat (Uebersicht → `bautagebuch/[datum]`, Projektkarte → `abnahme`: beide Ziele verlangen `bau.schreiben`, beide Links sind ungeschuetzt, fehlendes Recht endet auf 404), drei Faelle „Vorschau gruen, Uebernahme 500" (fehlende Streichungsanzeige, Preis auf einer Titelzeile, doppelte OZ — die letzten zwei habe ich gegen echtes Postgres bis zur Bedingungsmeldung nachgestellt), ein falscher Satz in der vorgeschlagenen Registerzeile O-631 (die dort behauptete Sicherung „maschinell gelesen und ungeprueft" existiert fuer CSV nicht, `konfidenz` bleibt NULL und der ganze Bestaetigungsweg ist damit fuer importierte Positionen unerreichbar), sowie die unbehandelte Einmaligkeit der Gesamtabnahme, der nie geschriebene `ersetzt_durch_id` und die Selbstwidersprueche der Abnahmeseite.

Zwei Dinge konnte ich NICHT pruefen, beide aus fremden Domaenen und beide blockierend fuer den Baum: (1) `pnpm db:seed` — und damit die ganze Isolationssuite, deren global-setup es aufruft — bricht in `src/server/db/seed/vertrieb.ts:275` mit `AngebotFehler: Ohne Preisfreigabe geht kein Angebot hinaus` ab (unversionierte Arbeit an `angebot/index.ts` + `drizzle/0295_angebot_preisfreigabe.sql`); die 58 gruenen Bau-Isolationsfaelle des Berichts sind damit heute nicht nachstellbar. (2) `npx tsc --noEmit` ueber den ganzen Baum bricht an einem Syntaxfehler ab: `src/app/portal/[mandant]/angebote/[id]/versand/page.tsx(90,21): error TS1005: ',' expected`. Sein Fremdbefund zu `app.ist_mitglied` ist echt: `psql -c "select pg_get_function_arguments(oid) …"` zeigt `p_stichtag date DEFAULT CURRENT_DATE`, waehrend `benutzer_mandant.gueltig_ab` auf `app.berlin_heute()` steht — die eine Zeile in einer neuen Migration ist faellig. Die Registerzeilen (dienste.ts, route-manifest.ts, schema/rls.ts, navigation.ts:213, MIGRATIONS_DATEIEN in scripts/generate-triggers.ts, die drei DECISIONS-Zeilen) fehlen alle noch, wie angekuendigt; die generierten Bloecke in 0211/0212 stimmen wortgleich mit den vorgeschlagenen `grund`-Texten, und die drei neuen route.ts (api/bau/abnahmen, api/bau/lv-import, api/bau/lv-positionen/[id]/bestaetigung) stehen wirklich noch nicht im Manifest — ohne sie faellt tests/kern/routen.test.ts.

## Nach der Behebung noch offen

- O-630, O-631, O-632, O-633 bleiben offene Fachfragen (Zeilen unten). O-631 ist nur RICHTIGGESTELLT, nicht beantwortet; O-633 ist neu und entstand aus Befund 4.
- Die Registereintraege unten sind weiterhin NICHT eingefuegt (dienste.ts, route-manifest.ts, rls.ts, navigation.ts, generate-triggers.ts, DECISIONS.md) — ich habe die gemeinsamen Dateien wie vorgegeben nicht angefasst. tests/kern/routen.test.ts ist deshalb rot; die Liste der fehlenden Manifesteintraege umfasst rund fuenfzig Routen aus ALLEN Domaenen, nicht nur die drei aus bau.
- `pnpm db:seed` laeuft derzeit im Baum NICHT durch: er bricht mit „new row violates row-level security policy for table leistungskatalog_position" ab — fremde Domaene (Stammdaten/Katalog), nicht von mir verursacht und nicht von mir behoben. Folge fuer mich: ich konnte die Saat nicht end-to-end fahren; meine Saataenderung ist reiner Kommentartext, und die Isolationssuite lief deshalb gegen eine eigene, frisch migrierte Datenbank ohne die Vorlage der globalen Einrichtung.
- tests/isolation/bau-nachtrag.test.ts hat einen Fall rot: „eine NEU angelegte Gesellschaft bekommt den Katalog vom Ausloeser" scheitert an „Fuer den Bereich neu… gibt es kein Identitaetstoken in DESIGN §1" (mi_token-Pruefung aus 0200). Fremder Befund, unabhaengig von meinen Aenderungen — der Test legt Gesellschaften mit zufaelligem Bereichsschluessel an.
- Playwright nicht gelaufen (verboten). tests/e2e/aufmass.spec.ts ist von der Vorrunde auf die Freigaberoute umgeschrieben und braucht weiterhin einen Lauf; meine Aenderungen beruehren dort nur die Positionsauswahl in `aufmass/neu` (jetzt `optgroup`), auf die kein Browserfall zugreift.
- Namensabweichung zwischen Spezifikation und Migration: docs/architecture/02-datenmodell/03-GEWERKE.md §7.5/§14 und die Ausloesertabelle nennen den Ausloeser `pruefe_lv_geprueft()`, 0072 hat ihn `kern.aufmass_vorlage_pruefen()` genannt. Ich habe den CODE auf den wirklichen Namen gebracht und die Spezifikation bewusst nicht angefasst — sie zu aendern ist eine Entscheidung ueber das Dokument, nicht ueber meinen Pfad. Empfehlung: einen der beiden Namen zum verbindlichen erklaeren.

## NICHT gebaut, mit Grund

- GAEB-Parser (DA XML X83/X84, D83, D84), Excel und PDF als LV-Quelle - Schnittstelle LvQuelle steht, die vier Formate sind in der Oberflaeche sichtbar und gesperrt, implementiert ist nur CSV (O-41 / O-97)
- Ableitung von gewaehrleistung_bis aus der Abnahme - Schnittstelle GewaehrleistungsFrist mit FRIST_OFFEN, Spalte bleibt NULL (O-154: 4 Jahre § 13 Abs. 4 VOB/B gegen 5 Jahre § 634a BGB)
- Anzeige von lv_position.steuer_kennzeichen - 0071 entzieht die Spalte zusammen mit dem Einheitspreis, ein Leser dafuer waere eine Rechteentscheidung (O-632)
- Pflichttage des Bautagebuchs - tageOhneBautagebuch zeigt heute jeden Kalendertag der letzten Woche ohne Eintrag und schreibt das hin (O-630)
- Uebernahme der Einheitspreise des Auftraggebers als Vertragspreise beim Import - heute wandern sie mit, ausdruecklich als offen markiert (O-631)
- PDF des Abnahmeprotokolls - kein Dokumentenspeicher verbunden; die Seite sagt 'nicht angehaengt', es wird kein Beleg erzeugt

## Notizen des Bauender

ZWEI ECHTE FEHLER IN MEINEM EIGENEN CODE, gefunden erst durch Abfragen gegen echtes Postgres — beide haetten JEDEM Benutzer einen Serverfehler gezeigt, nicht eine Luecke, und beide waren im Typsystem und im Einheitstest unsichtbar:
(1) findeLvPosition las lv_position.steuer_kennzeichen. Ein Spalten-GRANT maskiert nicht, er verweigert: "permission denied for table lv_position", die ganze Positionsseite tot. Behoben (Spalte aus Abfrage und Schnittstelle, Platzhalter O-632 in der Oberflaeche).
(2) ladeNachtraegeJePosition schrieb `select n.*` in drei Vereinigungszweigen; n.* expandiert auf betrag_netto_cent, das 0080 genauso entzogen hat. Behoben (sechs benannte Spalten). Damit das nicht wiederkommt, ist tests/isolation/bau-seiten-abfragen.test.ts entstanden: jeder Leser der sechs Seiten wird einmal aufgerufen, mit bau.preis_lesen und ohne.

BEFUND AUSSERHALB MEINER DOMAENE, BLOCKIEREND FUER DIE GANZE ISOLATIONSSUITE (bitte weitergeben): app.ist_mitglied hat `p_stichtag date default CURRENT_DATE`, der Spaltenvorgabewert von benutzer_mandant.gueltig_ab ist aber app.berlin_heute() (0169). 0169 hat vierzehn Funktionskoerper auf berlin_heute() umgestellt und diesen ARGUMENTVORGABEWERT uebersehen. Die Zwei-Argument-Aufrufer sind kern.auftrag_verantwortlich_im_mandant (0025:266) und 0146:48. Folge: zwischen 22:00 UTC und Mitternacht (Sommerzeit; im Winter 23:00-24:00) ist berlin_heute() schon morgen und CURRENT_DATE noch heute, eine soeben angelegte Mitgliedschaft gilt nicht, und jedes Anlegen eines Auftrags scheitert mit "Der Verantwortliche gehoert nicht zu dieser Gesellschaft". Gemessen um 21:46 UTC: 52 von 52 Faellen gruen; um 22:05 UTC dieselben Dateien: 48 von 53 rot, und in den fuenf uebrigen Bau-Isolationsdateien 92 von 98 rot. Das trifft auch `pnpm db:seed`. Die Behebung ist eine Zeile in einer NEUEN Migration (nicht meine Nummer, nicht mein Objekt): create or replace function app.ist_mitglied(p_benutzer uuid, p_mandant uuid, p_stichtag date default app.berlin_heute()). Meine beiden Fixturen (bau-abnahme, bau-lv-import) und die neue Datei setzen gueltig_ab jetzt ausdruecklich auf current_date - 1, mit dem Befund als Kommentar an der Stelle; die fuenf aelteren Bau-Isolationsdateien habe ich NICHT angefasst, weil die zentrale Zeile sie alle erledigt.

ZWEI WEITERE FREMDE BEFUNDE (beim Gegenpruefen mitgelaufen, nicht von mir verursacht): (a) tests/isolation/unveraenderbarkeit.test.ts erwartet bei `truncate audit_log` die Meldung des Loeschsperr-Ausloesers, bekommt seit 0204 aber "cannot truncate a table referenced in a foreign key constraint" (audit_kettenglied zeigt auf audit_log) — die Sperre haelt, der Test misst den falschen Satz. (b) tests/isolation/schema-meta.test.ts (D-09) faellt, weil 0194_person_zusammenfuehren einen Fremdschluessel person.zusammengefuehrt_in_person_id -> person angelegt hat; der Test verlangt "person points at nothing". Ausserdem sind vier Typfehler im Baum, alle in src/app/portal/[mandant]/crm/... (Next-typed-routes auf eine noch fehlende Seite) — meine Pfade sind sauber.

KOLLISION BEI DEN O-NUMMERN: O-639 ist schon belegt (src/server/services/radar/ted.ts:75 und tests/kern/radar-quellen.test.ts:244). Ich habe deshalb nur O-630, O-631, O-632 vergeben.

WEITERE AUFRAEUMARBEIT IN MEINER DOMAENE: die O-155-Regel stand in zwei Fassungen — einmal im Dienst (zaehltInSumme) und einmal als Kopie im Koerper der Positionsseite. Jetzt gibt es zaehltPositionsartInSumme im Dienst, beide rufen sie, und ein Fall in tests/kern/rechenansatz-lv.test.ts nagelt fuer jede der sechs Positionsarten fest, dass die zwei Funktionen dasselbe sagen. Zwei Treffer der Wache anzeige-berlin auf der Projektseite (toLocaleString mit Optionen auf einer Zahl) sind durch den Hausformatierer prozent() ersetzt — ganzzahlige Basispunkte, kein Gleitkomma.

PRUEFSTAND: pnpm db:migrate auf eigener Datenbank (w_bau, danach noch einmal frisch als w_bau2) bis "Migrationen angewendet." durchgelaufen, mit allen inzwischen dazugekommenen Nummern anderer Agenten. 107 Kern-Faelle gruen (sechs Dateien), 58 Isolationsfaelle gruen (bau-abnahme, bau-lv-import, bau-seiten-abfragen) gegen echtes Postgres. npx tsc --noEmit: keine Meldung auf meinen Pfaden. eslint auf meinen Pfaden: still. scripts/guards/run-all.ts: von meinen Dateien nur die drei todo-client-nicht-im-register-Treffer (O-630, O-631, O-632) — sie verschwinden mit den drei Zeilen fuer docs/DECISIONS.md oben. Playwright habe ich nicht laufen lassen (verboten); tests/e2e/aufmass.spec.ts ist auf die neue Freigaberoute umgeschrieben und braucht einen Lauf.

DAS PROTOKOLL DER ABNAHME, kurz zur Einordnung fuer docs/DECISIONS.md (D-Nummern vergebe ich nicht selbst): die Abnahme ist einmalig je Projekt fuer die Gesamtleistung (partieller unique index ueber die wirksamen, nicht stornierten), eine Teilabnahme und eine Verweigerung sperren sie nicht und schlagen projekt.status nicht um; kunde_id kommt vom Projekt und wird als Eingabe verworfen; protokolliert_am ist Serverzeit; der Schnappschuss entsteht aus der EINGABE vor dem Einfuegen, weil snapshot_hash not null ist und die Maengel danach nur in derselben Transaktion dazukommen duerfen — sonst gaebe es zwei Maengellisten zu einem Protokoll. Die Gewaehrleistungsfrist rechnet ein Dienst, nie die Datenbank und nie die KI, und solange O-154 offen ist, rechnet sie nichts.

## Notizen des Behebender

PRUEFSTAND. Migration: `drop database w_bau` / `create database w_bau` / `cse.fenster_schluessel` gesetzt / `DATABASE_URL=…/w_bau pnpm db:migrate` bis „Migrationen angewendet." — zweimal gefahren, einmal vor und einmal nach 0214. Isolationsfaelle gegen echtes Postgres als `cse_app`: bau-lv-import (24), bau-abnahme (37), bau-seiten-abfragen (6), bau-lv, bau-aufmass — zusammen 102 gruen; dazu bau-nachtrag, bau-behinderung, bau-bautagebuch in einem frueheren Lauf (163 von 164 gruen, der eine rote Fall ist der fremde mi_token-Befund oben). Kernfaelle: bau-lv-quelle (29, davon 6 neu), rechenansatz-lv, bau-wache, bau-abnahme-frist — 68 gruen. `npx tsc --noEmit`: keine Meldung auf meinen Pfaden (die vier verbleibenden Fehler liegen in src/app/portal/[mandant]/crm/… und src/server/services/crm/…, fremde Domaene). `npx eslint` auf allen beruehrten Dateien: still. `scripts/guards/run-all.ts`: von meinen Dateien ausschliesslich die vier `todo-client-nicht-im-register`-Treffer (O-630, O-631, O-632, O-633) — sie verschwinden mit den vier Zeilen fuer DECISIONS.md. Keine vollen Suiten, kein Commit, kein Build.

LAUFUMGEBUNG. Der Postgres-Cluster auf Port 55432 war beim Start gestoppt und ist wieder oben; die Arbeitsdatenbanken `w_bau`/`w_kupo_seed` des Vorlaufs existierten nicht mehr (Containerneustart) und wurden neu angelegt. Die Isolationssuite lief NICHT ueber vitest.isolation.config.ts: deren globale Einrichtung sperrt die Basis `cse_test` (ein anderer Lauf hielt sie) und baut ihre Vorlage mit `pnpm db:seed`, der derzeit fremdverschuldet abbricht. Ich habe stattdessen `w_bau` geklont und mit einer Konfiguration im Kritzelverzeichnis ohne globale Einrichtung gefahren — dieselben Dateien, dieselbe Harness, dieselbe `cse_app`-Rolle, nur ohne die geseedete Vorlage. Die Klondatenbank ist danach wieder geloescht.

ZWEI ENTSCHEIDUNGEN, die vom Wortlaut der Befunde abweichen und die ich benenne, weil sie begruendet sind:
(1) Befund 1 bot Archivieren ODER Verzeichnisbezug an. Ich habe den Verzeichnisbezug genommen. Archivieren haette die Vorfassung aus `listeVerzeichnisse` (filtert `archiviert_am is null`) und damit aus dem LV-Baum entfernt — zusammen mit Befund 4 (Teildatei streicht, was fehlt) waere aus einem LV mit 27 Positionen eine sichtbare Fassung mit drei geworden, der Rest nur noch per SQL auffindbar. Der Verzeichnisbezug erreicht die geforderte Eigenschaft („keine OZ zweimal in ladeLvAuswahl") ohne diesen Verlust und ohne Migration.
(2) Befund 5 schlug vor, den Preis auf einer Nicht-Position zu verwerfen „und Hinweis in `fehler`". Ein Eintrag in `fehler` macht die Zeile aber ungueltig (`ist_gueltig = fehler.length === 0`), und eine verworfene Titelzeile nimmt ihren Positionen den Elternteil. Ich habe deshalb einen zweiten Kanal gebaut (Spalte `hinweise`, 0214) — Fehler heisst „kommt nicht mit", Hinweis heisst „kommt mit, etwas wurde angepasst".

DREI FREMDE BEFUNDE, weiterzugeben:
(a) `pnpm db:seed` bricht ab: „new row violates row-level security policy for table leistungskatalog_position" — blockiert die globale Einrichtung der ganzen Isolationssuite, nicht nur meine.
(b) tests/isolation/bau-nachtrag.test.ts: „eine NEU angelegte Gesellschaft bekommt den Katalog vom Ausloeser" faellt an „Fuer den Bereich neu… gibt es kein Identitaetstoken in DESIGN §1" (mi_token, 0200). Der Test legt Gesellschaften mit zufaelligem Bereichsschluessel an; entweder braucht die Fixtur einen der vier echten Bereiche, oder die Pruefung muss Testbereiche zulassen.
(c) Der Befund des Vorlaufs zu `app.ist_mitglied(… p_stichtag date default CURRENT_DATE)` gegen `app.berlin_heute()` (0169) steht unveraendert und ist weiterhin nicht behoben — er macht jeden Lauf zwischen 22:00 UTC und Mitternacht rot.

GESTALTUNG: kein neuer Wert. Verwendet sind nur vorhandene Tokens (s1–s6, text-h1/h3/base/sm/xs/micro, text/text-muted/text-subtle, text-warning/danger/brand, border-line/line-strong, bg-surface/surface-3, rounded-lg/md, tabular-nums, cse-zahl). Die Kachelzeile der Uebersicht waechst von vier auf fuenf Eintraege im bestehenden KachelRaster, die Zaehlerzeile der Importvorschau von `sm:grid-cols-5` auf `sm:grid-cols-6` und der Herkunftsblock der Positionsseite von `sm:grid-cols-4` auf `sm:grid-cols-5` — alles innerhalb der vorhandenen Rasterklassen.
