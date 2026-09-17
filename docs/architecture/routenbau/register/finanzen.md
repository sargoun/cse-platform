# Registereintraege: finanzen

Diese Eintraege hat der bauende Agent geliefert; sie sind **noch nicht** eingefuegt.
Die gemeinsamen Dateien pflegt EINE Hand, weil acht Agenten gleichzeitig im Baum
arbeiten und sich sonst in dieselbe Zeile schreiben. Ist ein Eintrag eingefuegt,
verschwindet er hier — diese Datei ist eine Warteschlange, kein Archiv.

## Migrationen (alle gegen eine eigene Datenbank gefahren: True)

- drizzle/0180_ausgabe.sql — ausgabe_status (Enum), ausgabe_kategorie, ausgabe, ausgabe_steuer; Indizes nach §8.5; Übergangsauslöser fin.ausgabe_uebergang, Unveränderlichkeit ab gebucht (fin.ausgabe_unveraenderlich), fin.ausgabe_steuer_nach_buchung_fest, zurückgestellter Constraint-Trigger fin.ausgabe_steuer_stimmt (Zeilen müssen vor dem Buchen zum Kopf passen); CHECKs: brutto = netto+steuer, bar ⇒ Kasse, Beleg ab Freigabe (ACC-03), Ablehnung mit Grund; RLS: t_mandant/t_gruppe (Modul eingang), p_intern_ceiling auf der Kategorie, p_ma_ceiling + p_kunde_ceiling + p_gruppe_kein_personenbezug + t_person auf ausgabe und ausgabe_steuer — auf dem KIND jeweils über die Sichtbarkeit des Elternteils, weil eine Policy auf ausgabe_steuer die gesperrte Spalte ausgabe.anstellung_id nicht lesen darf (sonst 'permission denied for table ausgabe' bei JEDEM Lesezugriff); Spaltenrecht K-05 (anstellung_id fehlt im GRANT) plus Definer app.ausgabe_erstattung_lesen(uuid) mit personal.erstattung_lesen und app.protokolliere; NACHGETRAGENE Fremdschlüssel: rechnungsposition_quelle.ausgabe_id (0107), konto_mapping.ausgabe_kategorie_id (0126, dazu km_typ_hat_eltern gelöscht), buchungssatz.ausgabe_id (0127, bs_herkunft_hat_eltern enger gefasst auf kassenbewegung).
- drizzle/0181_rechnung_versand.sql — uebertragungsweg (Enum, wortwörtlich aus 02-CRM-OPERATIONS.md §647; diese Schicht prägt kein zweites Wegevokabular), versand_status (Enum, vier Werte inkl. nicht_verbunden), rechnung_versand; Auslöser: fin.rechnung_versand_serverzeit (eigene Funktion — kern.erzwinge_serverzeit() stempelt fest eingegangen_am und scheitert hier bei JEDEM Einfügen; im Testlauf gefunden), nur festgeschriebene Rechnungen, fin.rechnung_versand_kanal_verbunden (liest versand.<kanal>.verbunden je MANDANT DER ZEILE und lässt ohne Verbindung nur status=nicht_verbunden zu — SOC-07), append-only bis auf Zustand/gesendet_am/zugang/fehlertext/externe_id (K-12); CHECKs: Fehlertext bei fehlgeschlagen, gesendet ⇔ Zeitpunkt, Zugang ⇔ Grundlage (§286 BGB); RLS t_mandant (versand.lesen / versand.freigeben) + p_intern_ceiling, KEINE Gruppenpolicy (der Katalog führt kein gruppe.versand.lesen).
- drizzle/0182_bauleistung_jahressumme.sql — bauleistung_jahressumme (§8.6); UNIQUE (mandant_id, lieferant_id, jahr); prognose_cent nur mit prognose_grundlage (wird von einem Menschen eingetragen, nie abgeleitet); Auslöser fin.bauleistung_jahressumme_fortschreiben beim Übergang nach freigegeben — VOR der Abzugsentscheidung —, gezählt nach dem LEISTUNGSJAHR und nur für bauabzugsteuer_pflichtig; als cse_definer mit eigener Policy (D-388); RLS t_mandant/t_gruppe (eingang) + p_intern_ceiling.

## Gebaute Routen

- `/portal/[mandant]/finanzen/rechnungen/[id]/festschreiben` — fertig — Einwegtor als eigener Bildschirm: Netto je Steuersatzgruppe, Steuer, Brutto, Abschlagsabzug, Bauabzugsteuer, Überweisungsbetrag; §14-Ampel (alle Fehler auf einmal, mit Regel/Feld/Sprungziel); FIN-18 mit Pflichtbegründung ab 10 Zeichen; der ziehende Kreis mit Maske und Zählerstand, aber KEINE Nummer und keine Vorschau darauf; Knopf fehlt bei Platzhalterkreis, geschlossenem Kreis, offenem Abschlag (FIN-08) oder blockierendem Befund — mit genanntem Grund. Postet auf /api/rechnungen/festschreiben.
- `/portal/[mandant]/finanzen/rechnungen/[id]/verwerfen` — fertig — Zustandswechsel entwurf → verworfen, mit Pflichtgrund; sagt in einem Satz, dass nichts gelöscht wird und keine Nummernlücke entsteht; zeigt vorher die Quellen (ladeQuellen), die durch gibQuellenFrei() wieder abrechenbar werden. Bei festgeschriebenem Beleg Verweis auf /storno statt Formular.
- `/portal/[mandant]/finanzen/rechnungen/[id]/storno` — fertig — Gegenrechnung Position für Position mit gespiegelten Mengen und Beträgen (negiere/milliMenge), Kettenbindung, Pflichtgrund ab 10 Zeichen, zwei Ausgänge (nur_storno Vorgabe / korrektur). Erkennt bereits stornierte Belege und Selbst-Stornos und zeigt dann die Rückverweise statt eines Formulars. Demodaten vorhanden (rechnung_beziehung trägt 2 Zeilen) — keine Seedarbeit nötig, wie die Kritik festhält.
- `/portal/[mandant]/finanzen/rechnungen/[id]/abschlaege` — fertig — Frühere Abschläge des Auftrags mit Verrechnungsstand; Abzug je Steuersatzgruppe (jeSteuergruppe), nie ein Mischsatz; AbschlagFehler wird zu einem Satz auf der Seite statt zu 500. Einbehalt nach KRITIK: einbehaltCent() wirft NICHT, gibt 0n zurück — die Seite zeigt BEDINGUNGEN_PLATZHALTER.herkunft WÖRTLICH plus „offen (O-20)", kein try/catch. Zusätzlich gefunden und angezeigt: auftrag.sicherheitseinbehalt_bp/_cent (0025) werden als hinterlegte Vertragsangabe GEZEIGT, aber nicht gerechnet — was fehlt, ist die Regel, nicht die Zahl.
- `/portal/[mandant]/finanzen/rechnungen/[id]/zugferd` — fertig — Drei benannte Prüfzustände aus pruefstand(), nie „gültig"; Summenprobe (ciiSummen gegen die Snapshot-Kopfsummen, vier Vergleiche einzeln benannt) steht OBEN; ganze Liste fehlender Pflichtangaben mit BT-Nummer; Entwurf ohne Snapshot ist ein ZUSTAND, kein Fehler; CII-XML in lesbarer Form mit Profil und factur-x.xml; Download über den bestehenden Handler.
- `/portal/[mandant]/finanzen/rechnungen/[id]/versand` — fertig — Versandprotokoll aus rechnung_versand (neu, 0181) mit Kanal, eingefrorenem Empfänger, Freigeber, Zustand, Zugang (§286 BGB) und nutzlast_sha256. Kein Sendeknopf: versandwege() liest versand.<kanal>.verbunden — denselben Schlüssel, den der DB-Auslöser prüft; ohne Verbindung steht „Versand nicht verbunden (O-36) — die Datei lässt sich herunterladen und von Hand versenden". kunde.uebertragungsweg existiert nicht; ein Käufer mit XRechnungspflicht ohne Weg BLOCKIERT (07-INTEGRATIONEN §12.1) statt zurückzufallen.
- `/portal/[mandant]/finanzen/hashkette` — fertig — Der GESPEICHERTE Nachtlauf zuerst (job_lauf.job='kette_pruefen', job_lauf_mandant.fehlertext bzw. kennzahlen->>'meldung'); leer heisst ausdrücklich „noch nie gelaufen" und NICHT „in Ordnung" — der Punkt, den die Kritik anmahnt. Darunter die Kettenköpfe je Kreis (neue Abfrage kettenkoepfe(): Genesis, letzter Hash, Kettenlänge, höchste Position, Kopf- und Übergangsprobe). Live-Prüfung nur hinter ?nachrechnen=jetzt; Brüche mit Bruchart im Klartext, nicht mit einer Farbe.
- `/portal/[mandant]/finanzen/nummernkreise` — fertig — Alle Kreise mit Bezeichnung, Typ, Jahr (0 = fortlaufend, nicht „unbekannt"), Maske, Rücksetzung, lückenlos, nächster Nummer als ANSICHT (vorschau() — bei jahr=0 kein stilles 0, sondern benannt), Kettenlage, Vorgänger, geöffnet/geschlossen. Kein „Neuer Kreis", kein „Jahreswechsel" (O-352) — der Vorgang steht in drei Schritten beschrieben. Zeigt den von der Kritik gefundenen Widerspruch (Bezeichnung „Maske unbestätigt" bei ist_platzhalter=false) als benannten Befund O-606 und löst ihn nicht.
- `/portal/[mandant]/finanzen/pruefungen` — fertig — Drei Prüfungen, jede mit Regel und Fundstelle an der Zeile: FIN-18 (abgeschlossener Auftrag ohne erfasste Minute, über fin.auftrag_erfasste_minuten() und NICHT über die security_invoker-Sicht zeiteintrag_auftrag), abgeschlossener Auftrag ohne Rechnung (verworfene zählen nicht), Entwurfszeile ohne wirksame Herkunft (FIN-07, Stufe „fehler"). Sprung in den AUFTRAG, nie in die Zeiterfassung (EMP-13). Kacheln je Regel als Filter. Rubrik „Was diese Liste NOCH NICHT prüft" mit O-601 und O-602 — statt erfundener Prüfungen.
- `/portal/[mandant]/finanzen/belege` — fertig — Belegnummer, Typ, Quelle, Belegdatum, Brutto, Seiten, Eingang in Europe/Berlin (in der DB gedreht, nicht im Browser), Aufbewahrungsklasse mit aufbewahrung_bis ODER ausdrücklich „Frist offen (O-46)". Filter über die FÜNF Quellen inkl. `erzeugt` — der von der Kritik gefundene Fehler des engeren BelegQuelle-Typs ist im neuen Dienst behoben. Keine Datei verlinkt, kein Löschknopf. Leerzustand nennt die wirkliche Ursache: ohne verbundenen Objektspeicher legt auch der Seed keinen Beleg an.
- `/portal/[mandant]/finanzen/belege/[id]` — fertig — Kopf mit datei_sha256 als Nachweis; Dokumentversion mit Hashprobe gegen den Beleg und Hinweis auf eine neuere Version; Datei über /api/dokumente/[id]/datei (die bestehende Adresse — /api/dokument/[id]/url gibt es nicht, wie die Kritik richtig feststellt), nur mit dokument.lesen; Aufbewahrungsregel über app.aufbewahrung_regel; Zugriffshistorie aus dokument_zugriff; Liste der Zeilen, die sich auf den Beleg berufen (eingangsrechnung, ausgabe, buchungssatz) — als Begründung statt eines ausgegrauten Löschknopfs.
- `/portal/[mandant]/finanzen/eingangsrechnungen/[id]/freigabe` — fertig — Oben die VIER Angaben, die erteileFreigabe() in die Nutzlast einfriert (Lieferant, Rechnungsnummer, Rechnungsdatum, Brutto) — in derselben Reihenfolge. Vier-Augen-Lage im Klartext: vierAugenGrenze() gibt null zurück, und die Seite sagt „Kein Vier-Augen-Zwang konfiguriert (O-183)" statt eine Grenze zu behaupten; sie rechnet die Sperre genauso wie freigebe(). Sagt ausdrücklich, dass die Freigabe die BUCHUNG erlaubt und keine Zahlung (Invariante 7). Fehlt eingang.lesen, sagt die Seite das statt leer zu bleiben. Formulare posten auf den bestehenden API-Weg.
- `/portal/[mandant]/finanzen/eingangsrechnungen/[id]/steuer` — fertig — Vollständig gebaut, aber LESEND — und das nach der KRITIK: das Register führt schreiben: [], und drei verschiedene Rechte entscheiden hier (eingang.lesen, finanzen.lesen, finanzen.schreiben) während die Route mit abrechnung.freistellung_pflegen öffnet. Hochladen/Gültigkeit/Widerruf sind deshalb ein klar bezeichneter Platzhalter mit O-604, keine Maske, die die Policy abweist. Inhalt: Stichtag ausgeschrieben (coalesce(leistung_bis, leistungsdatum, rechnungsdatum), STICHTAG_QUELLE, O-176), §13b mit HINWEIS_13B und benannter Lücke O-605, §48 in DREI benannten Ausgängen aus abzugLage() — der mittlere jetzt darstellbar über bauleistung_jahressumme (0182) —, „Keine Bagatellgrenze angewandt (O-21) — es wird einbehalten", Bescheinigungen mit giltAm() je Stichtag und sichtbarem Widerruf.
- `/portal/[mandant]/finanzen/ausgaben` — fertig — Neue Tabellen aus 0180. Liste mit Datum, Kategorie (unbestätigt → O-05), Bezeichnung, Zahlungsmittel/Kasse, Netto/USt/Brutto, Beleg, Weiterberechenbarkeit, Erstattungskennzeichen; Filter Jahr/Status/Kategorie/weiterberechenbar; Summen je Zustand aus der DATENBANK unter derselben Policy. anstellung_id steht in keiner Abfrage (K-05); ob eine Zeile Erstattung ist, kommt über app.ausgabe_erstattung_lesen(). O-185 und O-186 stehen sichtbar auf der Seite.
- `/portal/[mandant]/finanzen/ausgaben/[id]` — fertig — Kopf, Steuerzeilen je Steuersatzgruppe mit Summenprobe gegen den Kopf (nie ein Mischsatz aus dem Brutto), Beleg mit Verweis, Erstattung nur über das schmale Tor (leer heisst „keine" ODER „kein Recht" — AUT-06, und der Aufruf erfolgt nur, wenn die Liste überhaupt eine Erstattung gemeldet hat, damit das audit_log lesbar bleibt), Weiterberechnung über rechnungsposition_quelle (genau eine wirksame Zeile, quelle_ausgabe_uk) mit unwirksamen Storno-Zeilen daneben, Zustandsverlauf ausgeschrieben. Keine Löschung, kein ausgegrauter Knopf.
- `src/app/portal/[mandant]/finanzen/page.tsx (Kacheln ergänzt)` — fertig — Nicht im Auftrag, aber nötig, damit die zehn neuen Seiten erreichbar sind: fünf neue Karten in KARTEN (ausgaben, belege, pruefungen, nummernkreise, hashkette). Die Kacheln fragen ihr Recht über findeRoute() wie bisher.
- `src/app/portal/[mandant]/finanzen/rechnungen/[id]/page.tsx (Navigation ergänzt)` — fertig — Verweise auf die neuen Bildschirme, jeder hinter seinem eigenen Recht (drei neue hat_recht-Abfragen: finanzen.festschreiben, finanzen.entwurf_verwerfen, versand.lesen) — Muster wie darfHerunterladen. Die bestehenden Inline-Formulare für Festschreiben/Verwerfen/Storno bleiben unangetastet („Do not break what works"); ihre Entfernung ist eine Folgeentscheidung, weil die Browsersuite sie benutzen kann.
- `src/app/portal/[mandant]/finanzen/eingangsrechnungen/[id]/page.tsx (Navigation ergänzt)` — fertig — Zwei Verweise („Freigabe ansehen", „Steuerliche Lage"), jeder hinter dem Recht seiner Route (eingang.freigeben bzw. abrechnung.freistellung_pflegen).

## src/server/registry/dienste.ts

/**
   * PR 54.x — die Ausgabenseite, das Belegarchiv, die Nummernkreisübersicht,
   * die Vorab-Prüfungen und das Versandprotokoll (FIN-14, FIN-17, FIN-18,
   * FIN-11, FIN-12, ACC-03, TEN-02).
   *
   * **Alle fünf LESEN, und das ist keine Formalie.** Keiner dieser Dienste
   * hat einen Schreibpfad: die Ausgabe entsteht über den Erfassungsweg, der
   * Beleg über den Uploadweg, die Nummer unter Zeilensperre in der
   * Festschreibungstransaktion, und der Versand — sobald es ihn gibt — über
   * eine Freigabe. Ein lesender Dienst darf in der Gruppenansicht laufen, und
   * genau das brauchen diese fünf: die Gruppenfinanzsicht liest Ausgaben und
   * Belege mit.
   *
   * `finanz/ausgabe` liest `ausgabe`, `ausgabe_steuer` und
   * `ausgabe_kategorie` und ruft für die Erstattung `app.ausgabe_erstattung_lesen()`
   * — ein Definer mit `personal.erstattung_lesen`, der seinen Zugriff
   * protokolliert (K-05, §1.5). Der Dienst selbst nennt `anstellung_id` in
   * keiner Abfrage; die Spalte fehlt im GRANT.
   *
   * `finanz/versand` liest `rechnung_versand` und die Einstellung
   * `versand.<kanal>.verbunden` — denselben Schlüssel, den der Auslöser in
   * 0181 prüft. Er SENDET nichts und kann es nicht (O-36, O-22).
   */
  { modul: 'finanzen', pfad: 'finanz/ausgabe', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/beleg', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/kreisuebersicht', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/vorabpruefung', schreibend: false },
  { modul: 'finanzen', pfad: 'finanz/versand', schreibend: false },
  /**
   * Die ZUGFeRD-Vorschau: sie liest den Snapshot und ruft `baueCii` und
   * `ciiSummen` — dieselben zwei Funktionen, die der PDF-Bauer benutzt. Ein
   * zweiter Erzeuger entsteht dabei nicht, und geschrieben wird nichts.
   */
  { modul: 'finanzen', pfad: 'finanz/zugferd/vorschau', schreibend: false },

## src/server/auth/route-manifest.ts

Keine Einträge nötig. Ich habe keine neue API-Route gebaut: die Formulare der neuen Bildschirme posten auf die bestehenden Adressen `api/rechnungen/festschreiben`, `api/rechnungen/verwerfen`, `api/rechnungen/storno`, `api/rechnungen/abschlaege` und `api/finanzen/eingangsrechnungen`, die alle schon im Manifest stehen. Die Dateien kommen über `api/finanzen/rechnungen/[id]/xrechnung.xml`, `.../zugferd.pdf` und `api/dokumente/[id]/datei` — ebenfalls vorhanden.

Anzumerken für eine spätere Runde (nicht von mir zu registrieren, weil ich die Route nicht gebaut habe): `04-SEITENKARTE.md`/`05-API-KARTE.md` §12.1 nennen `POST /api/finanzen/rechnungen/[id]/versenden` (erzeugt eine Freigabe, der genehmigte Versand schreibt eine `rechnung_versand`-Zeile). Die Tabelle steht jetzt (0181); die Adresse bleibt offen, solange kein Kanal verbunden ist (O-36/O-603, O-22) — sie hätte heute nur einen Weg in `status = nicht_verbunden`.

## src/server/db/schema/rls.ts

In `src/server/db/schema/rls.ts`, Feld `KEIN_HARD_DELETE`. Der `grund` ist wortwörtlich der Kommentar, der in den Migrationen schon im generierten Block steht — so bleibt `pnpm db:triggers --check` grün, und `pnpm db:triggers` ersetzt den vorgeschriebenen Block identisch.

  {
    tabelle: 'ausgabe_kategorie',
    art: 'archiv',
    migration: '0180',
    grund:
      'ACC-01, FIN-14, §147 AO. An der Kategorie haengt die Kontierung jeder '
      + 'Ausgabe, die auf sie zeigt; sie zu loeschen macht jede Buchung darauf '
      + 'unlesbar. Aufgeloest wird ueber `archiviert_am`.',
  },
  {
    tabelle: 'ausgabe',
    art: 'archiv',
    migration: '0180',
    grund:
      'FIN-14, FIN-17, ACC-03, ACC-06, §147 AO. Die Ausgabe traegt den '
      + 'Vorsteuerabzug und den Aufwand einer Gesellschaft; eine '
      + 'weiterberechnete Ausgabe ist zudem die Quelle einer Rechnungszeile. '
      + 'Sie zu loeschen nimmt der Voranmeldung ihre Grundlage und liesse eine '
      + 'Rechnungszeile ohne Beleg zurueck. Zurueckgewiesen wird ueber '
      + '`abgelehnt` mit Grund.',
  },
  {
    tabelle: 'ausgabe_steuer',
    art: 'append',
    migration: '0180',
    grund:
      'FIN-14, ACC-08, §15 UStG, Invariante 1. Die Aufteilung nach '
      + 'Steuersaetzen IST der Vorsteuerabzug — ohne sie steht ein '
      + 'Bruttobetrag da, aus dem sich kein Satz mehr ableiten laesst. Sie zu '
      + 'loeschen aenderte die Voranmeldung ohne Spur.',
  },
  {
    tabelle: 'rechnung_versand',
    art: 'append',
    migration: '0181',
    grund:
      'FIN-11, FIN-12, Invariante 7, LEG-08, §286 BGB. Die Zeile IST der '
      + 'Nachweis, dass ein Mensch den Versand freigegeben hat, und sie traegt '
      + 'den Zugang, ab dem der Verzug rechnet. Sie zu loeschen liesse eine '
      + 'Mahnung ohne Grundlage und eine Freigabe ohne Spur zurueck.',
  },
  {
    tabelle: 'bauleistung_jahressumme',
    art: 'append',
    migration: '0182',
    grund:
      'FIN-10, LEG-06, §48 Abs. 2 EStG. Die Jahressumme ist der Nachweis, '
      + 'WARUM einbehalten oder nicht einbehalten wurde. Sie zu loeschen nimmt '
      + 'jeder Abzugsentscheidung dieses Jahres ihre Grundlage — und der '
      + 'Leistende haftet mit.',
  },

NICHT in `GEAENDERT_AM` und NICHT in `AUDITIERT` eintragen: `ausgabe`, `ausgabe_kategorie` und `bauleistung_jahressumme` tragen ihren `geaendert_am`-Ausloeser bereits von Hand (`trg_ausgabe_geaendert`, `trg_ausgabe_kategorie_geaendert`, `trg_blj_geaendert`). Ein Registereintrag legte einen zweiten mit anderem Namen (`trg_<tabelle>_geaendert_am`) daneben, der dasselbe tut. `ausgabe_steuer` und `rechnung_versand` sind anfuegend und tragen kein `geaendert_am`.

## src/server/registry/navigation.ts

Optional — die fünf neuen Seiten sind über die Kacheln auf `/portal/[mandant]/finanzen` erreichbar (habe ich dort ergänzt). Wer sie zusätzlich in der Seitenleiste will, nimmt diese Einträge; sie gehören hinter `ausgangsbuch` und vor `mahnungen`:

  /**
   * `finanzen/ausgaben` — der Aufwand, der keine Lieferantenrechnung ist
   * (FIN-17). Recht `eingang.lesen` wie die Eingangsrechnungen: es ist
   * dieselbe Kreditorenseite, und eine Erstattung liegt zusätzlich hinter
   * `personal.erstattung_lesen`.
   */
  { schluessel: 'ausgaben', label: 'Ausgaben', pfad: 'finanzen/ausgaben', recht: 'eingang.lesen', icon: 'euro' },
  /**
   * `finanzen/belege` — das GoBD-Belegarchiv (ACC-03). Die DATEI liegt hinter
   * `dokument.lesen`; die Liste zeigt nur, dass es sie gibt.
   */
  { schluessel: 'belege', label: 'Belege', pfad: 'finanzen/belege', recht: 'eingang.lesen', icon: 'dokument' },
  /**
   * `finanzen/nummernkreise` — Maske, Zähler und Kettenlage (TEN-02, FIN-03).
   * Recht `nummernkreis.lesen` und nicht `finanzen.lesen`: der Kreis ist die
   * Buchführungsordnung der Gesellschaft, nicht eine Rechnung darin — dieselbe
   * Begründung wie beim Ausgangsbuch daneben.
   */
  { schluessel: 'nummernkreise', label: 'Nummernkreise', pfad: 'finanzen/nummernkreise', recht: 'nummernkreis.lesen', icon: 'buch' },
  /**
   * `finanzen/pruefungen` — die Vorab-Liste vor der Rechnungsstellung
   * (FIN-18). Sie springt in den AUFTRAG und nie in die Zeiterfassung: die
   * Buchhaltung erfaehrt, DASS Zeit fehlt, nicht von wem (EMP-13).
   */
  { schluessel: 'pruefungen', label: 'Vorab-Prüfungen', pfad: 'finanzen/pruefungen', recht: 'finanzen.lesen', icon: 'qualitaet' },
  /**
   * `finanzen/hashkette` — der naechtliche Pruefbericht (FIN-06, LEG-01).
   */
  { schluessel: 'hashkette', label: 'Hashkette', pfad: 'finanzen/hashkette', recht: 'finanzen.lesen', icon: 'schloss' },

## Sonstiges

`scripts/generate-triggers.ts`, Objekt `MIGRATIONS_DATEIEN` — drei Zeilen, ohne die `pnpm db:triggers` mit einem undefinierten Pfad abbricht, sobald die rls.ts-Eintraege da sind (`MIGRATIONS_DATEIEN[m]!` ist ein Non-Null-Assert):

  // Finanzen (PR 54.x): Ausgaben, Rechnungsversand, §48-Jahressumme.
  '0180': join(WURZEL, 'drizzle/0180_ausgabe.sql'),
  '0181': join(WURZEL, 'drizzle/0181_rechnung_versand.sql'),
  '0182': join(WURZEL, 'drizzle/0182_bauleistung_jahressumme.sql'),

Der generierte Block steht in allen drei Dateien schon im Generatorformat (Sentinel mit Migrationsnummer, Erzeugerzeile, Kommentar je Tabelle mit kollabiertem Whitespace, Trigger, `revoke`, drei Leerzeilen, Endsentinel). `pnpm db:triggers` ersetzt ihn dadurch identisch statt ihn anzuhaengen.

`docs/architecture/04-SEITENKARTE.md`: §5.14.1 nennt `rechnung_versand` — die Tabelle existiert jetzt (0181). Zwei Praezisierungen waeren richtig: (a) die Vorschauadresse eines Belegs ist `/api/dokumente/[id]/datei` und nicht `/api/dokument/[id]/url` (letztere gibt es nicht); (b) `/finanzen/eingangsrechnungen/[id]/steuer` ist heute lesend, weil das Register `schreiben: []` fuehrt und drei andere Rechte die Zeilen entscheiden (O-604).

`docs/DESIGN.md`: nichts einzutragen. Zwei Abbildungen habe ich innerhalb des bestehenden Vokabulars geloest und in `notizen` gemeldet (Loeschsperre → `Archiviert`, `ausgabe_status` → Entwurf/Bereit/Abgeschlossen/Abgelehnt), jeweils mit ausgeschriebenem Zustand daneben.

`src/server/registry/kennzahlen.ts` / `tableiste.ts` / `modul.ts` / `routen.ts`: nichts. Die fuenfzehn Routen stehen mit ihren Rechten vollstaendig in `routen.generiert.ts`; die Tab-Leiste bekommt kein sechstes Ziel (§11.2 nennt genau fuenf).

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-600 | `rechnung_versand.rechnung_dokument_id` | Soll der Rechnungsversand die erzeugte Datei archivieren (`rechnung_dokument` mit eigener Dokumentversion), oder genügt der Nachweis über `nutzlast_sha256` der zum Zeitpunkt erzeugten Nutzlast? Solange `rechnung_dokument` (§9.5) nicht existiert, steht die Kennung ohne Fremdschlüssel und `artefakt` + Hash tragen den Nachweis. |
| O-601 | `/finanzen/pruefungen` | Welche Vorab-Prüfungen soll die Liste ausser FIN-18 führen — und welche davon blockiert die Festschreibung, welche warnt nur? Die Seitenkarte nennt „and the other pre-invoice checks", ohne sie aufzuzählen; heute geführt sind FIN-18, „abgeschlossener Auftrag ohne Rechnung" (FIN-01/FIN-16) und „Entwurfszeile ohne Herkunft" (FIN-07). |
| O-602 | `/finanzen/pruefungen` | Innerhalb welcher Frist nach Auftragsabschluss muss abgerechnet werden, damit die Vorab-Liste einen Auftrag als überfällig zeigen darf? Heute wird keine Frist gesetzt — eine hier erfundene wäre eine Geschäftsregel der Liste. |
| O-603 | `versand.email.verbunden` | Welcher EU-gehostete Transaktionsmailer liefert den Rechnungsversand aus, und unter welchem Auftragsverarbeitungsvertrag? Fortschreibung von O-36 auf `rechnung_versand`: ohne Antwort bleibt der Schlüssel `false`, der Auslöser lässt nur `status = nicht_verbunden` zu, und die Rechnung wird von Hand versendet. |
| O-604 | `/finanzen/eingangsrechnungen/[id]/steuer` | Welches Recht gilt für dieses Blatt? Das Register führt `lesen: [abrechnung.freistellung_pflegen]` und `schreiben: []`; die RLS-Policy auf `eingangsrechnung` verlangt zum Lesen `eingang.lesen`, die auf `freistellungsbescheinigung` `finanzen.lesen` zum Lesen und `finanzen.schreiben` zum Schreiben. Bis zur Entscheidung ist die Seite nur lesend, und Hochladen/Gültigkeit/Widerruf der §48b-Bescheinigung haben keinen registrierten Weg. |
| O-605 | §13b UStG auf der Eingangsseite | Der §13b-Status der EIGENEN Gesellschaft als Leistungsempfängerin ist nirgends als Zeitreihe hinterlegt — `mandant` trägt kein entsprechendes Feld, `kunde_bauleistender_status` beschreibt die Ausgangsseite. Soll er geführt werden, und wer pflegt ihn? Bis dahin zeigt die Steuerseite den auf dem BELEG gespeicherten Stand und bewertet nicht neu. |
| O-606 | `nummernkreis.ist_platzhalter` der Demokreise | Die drei `ausgangsrechnung`-Kreise heissen „Ausgangsrechnungen (DEMO — Maske unbestätigt, O-134)" und tragen `ist_platzhalter = false`. Der Name behauptet den Schutz, die Spalte hebt ihn auf; für Rechnungskreise sitzt der Platzhalterschutz ausschliesslich in `fin.rechnung_nummer_ziehen` und prüft genau diese Spalte. Gehört sie auf `true` — mit Wirkung auf bereits festgeschriebene Belege? |

## Tests

- tests/kern/finanz-nummernkreis-vorschau.test.ts — 9 Fälle, laufen und sind grün. Maskenvorschau: Auffüllen auf die Stellenzahl, ohne Stellenangabe, KEINE Kürzung einer zu langen Nummer, und bei einem fortlaufenden Kreis (jahr = 0) kein stilles „0" als Jahr; dazu der Gleichheitsbeweis gegen formatiereNummer() über vier Masken, damit Vorschau und Vergabe nicht auseinanderlaufen. ZUGFeRD-Summenprobe: vier Summen einzeln benannt, mehrere Abweichungen alle auf einmal, und eine Abweichung von EINEM Cent wird bemerkt.
- tests/kern/finanz-ausgabe-vorabpruefung.test.ts — 16 Fälle, laufen und sind grün. Die vier Zustände von ausgabe_status OHNE in_pruefung; istAusgabeStatus weist auch Plausibles ab. Drei Platzhalter werden festgenagelt, weil ein Platzhalter, der still zu einer Zahl wird, wie eine Entscheidung aussieht: EIGENBELEG_PLATZHALTER (O-185), BAGATELLGRENZE_PLATZHALTER (O-21) plus STICHTAG_QUELLE = 'leistung_bis', und BEDINGUNGEN_PLATZHALTER (O-20) — dort ausdrücklich, dass einbehaltCent() 0n RECHNET und NICHT wirft. Fünf beleg_quelle-Werte inklusive `erzeugt`. Die drei Vorabprüfungsregeln mit ihrer Stufe (FIN-18 warnt, fehlende Herkunft blockiert), regelText() wirft bei einer unbekannten Regel statt Text zu erfinden, und NICHT_GEPRUEFT nennt O-601/O-602. Vier elektronische Kanäle — Portal und Post sind keine.
- tests/isolation/ausgabe.test.ts — 20 Fälle gegen echtes Postgres mit FORCE RLS. Geschrieben, aber NICHT ausgeführt: `pnpm test:isolation` steht auf der Verbotsliste. Jede einzelne Zusage habe ich stattdessen von Hand in `w_fin` nachgespielt und bestätigt: (a) K-05 — cse_app liest die Ausgabe, aber `select anstellung_id` endet mit `permission denied for table ausgabe`; app.ausgabe_erstattung_lesen() gibt Anstellung, Person und Personalnummer heraus und schreibt `ausgabe.erstattung_gelesen` ins audit_log; ohne Anstellung gibt sie dasselbe zurück wie ohne Recht — nichts (AUT-06). (b) K-04/K-18 — Personen-Scope sieht die eigene Erstattung, nicht die fremde und nicht den Sachaufwand der Gesellschaft; die Steuerzeilen ebenso, über das Elternteil; ein eigener Fall hält den behobenen `permission denied`-Fehler fest. (c) SEC-A3 — Gruppenansicht liest null personenbezogene Ausgaben und ihre Steuerzeilen ebenso nicht, den Sachaufwand aber vollständig. (d) Mandantengrenze. (e) ACC-03 — Freigabe ohne Beleg abgewiesen, mit Beleg zugelassen (freigegeben_am wird gestempelt), bar ohne Kasse abgewiesen, Ablehnung ohne Grund abgewiesen. (f) Invariante 1 — Buchen ohne Steuerzeilen abgewiesen, bei einem Cent Abweichung abgewiesen, mit zwei Sätzen auf einem Kassenbeleg zugelassen; brutto ≠ netto+steuer abgewiesen. (g) erfasst → gebucht ohne Freigabe abgewiesen; gebuchte Ausgabe und ihre Steuerzeilen unveränderlich. (h) Invariante 8 — DELETE und TRUNCATE auf allen drei Tabellen, als Eigentümer und als cse_app. (i) die drei nachgetragenen Fremdschlüssel, inklusive: `aufwand_kategorie` ist jetzt möglich, ein Verweis ins Leere bleibt abgewiesen, und `kassenbewegung` bleibt als Buchungsherkunft gesperrt.
- tests/isolation/rechnung-versand.test.ts — 19 Fälle. Ebenfalls geschrieben und nicht ausgeführt, jede Zusage von Hand in `w_fin` nachgespielt und bestätigt: SOC-07 — „gesendet" auf E-Mail, Peppol, ZRE und OZG-RE wird abgewiesen, solange nichts konfiguriert ist; `nicht_verbunden` geht; Post und Kundenportal senden ohne Verbindung (sie sind kein elektronischer Versand); nach `versand.email.verbunden = true` geht „gesendet"; der DIENST liest denselben Schlüssel wie der Auslöser; und der Auslöser wertet den Mandanten DER ZEILE aus (ein Schlüssel bei Security öffnet Reinigung nicht). Ein Entwurf wird nie versendet. K-12 — Empfänger, Artefakt, Hash und Freigabe sind unveränderlich, der Zustandsteil nicht; Zugang ohne Grundlage abgewiesen (§286 BGB); „gesendet" ohne Zeitpunkt abgewiesen; „fehlgeschlagen" ohne Fehlertext abgewiesen; `rechnung` trägt kein `versendet_am`. Invariante 5 — ein mitgeschickter Freigabezeitpunkt wird von der Serveruhr überschrieben (der Fall, der den kern.erzwinge_serverzeit()-Fehler festhält). Invariante 8 und Mandantengrenze. §48 Abs. 2 EStG — die Jahressumme entsteht beim Übergang nach `freigegeben` und nicht davor, zählt nach dem LEISTUNGSJAHR (Dezemberleistung im Januar abgerechnet bleibt im alten Jahr), addiert zwei Rechnungen desselben Leistenden, zählt eine nicht bauabzugspflichtige Rechnung nicht mit, verlangt für eine Prognose ihre Grundlage, sperrt DELETE und bleibt in der Mandantengrenze.

## NICHT gebaut

- Seedzeilen: keine. Der Seed ist zentral (src/server/db/seed/index.ts wird von mehreren Agenten gleichzeitig berührt) und `pnpm db:seed` gehört zu den verbotenen Befehlen — ich hätte Seedcode geschrieben, den ich nicht ausführen und damit nicht prüfen kann. Ungeprüfter Seedcode bricht den Seed für alle. Was fehlt, ist in `notizen` benannt.
- Schreibweg für /eingangsrechnungen/[id]/steuer (Bescheinigung hochladen, Gültigkeit setzen, Widerruf): bewusst nicht gebaut — O-604. Das Register führt schreiben: [], und die Policy auf freistellungsbescheinigung verlangt finanzen.schreiben, während die Route mit abrechnung.freistellung_pflegen öffnet. Eine Maske, die auf eine Policy trifft, die sie abweist, ist schlechter als keine; welcher Schlüssel gilt, ist eine Entscheidung am Rechtemodell (und eine RLS-Migration).
- Sendeknopf auf /rechnungen/[id]/versand: bewusst nicht gebaut — O-36/O-603 und O-22. Kein Kanal ist verbunden; der DB-Auslöser lässt nur status=nicht_verbunden zu. Die Seite schreibt „Versand nicht verbunden" und hält die Dateien bereit.
- Knöpfe „Neuer Kreis" und „Jahreswechsel" auf /nummernkreise: bewusst nicht gebaut — O-352. Der Jahreswechsel steht als beschriebener, nicht auslösbarer Vorgang da.
- bauabzug_anmeldung und eingangsrechnung_extraktion (die zwei weiteren fehlenden Tabellen des Moduls `eingang`, die die KRITIK nennt): nicht angelegt. Keine meiner fünfzehn Routen braucht sie, und sie gehören nicht zu den Tabellen, die ich besitze. bauabzug_anmeldung (§48a EStG, ELSTER nicht verbunden, O-187) und eingangsrechnung_extraktion (ACC-05/APR-03, gebraucht von /eingangsrechnungen/[id]) bleiben offen.
- rechnung_dokument (§9.5): nicht angelegt — nicht meine Tabelle. rechnung_versand.rechnung_dokument_id steht deshalb ohne Fremdschlüssel, mit ausgeschriebenem Grund und O-600, nach demselben Verfahren wie rechnungsposition_quelle.ausgabe_id in 0107.

## Notizen des Bauenden

MIGRATIONEN GEPRÜFT: 0180/0181/0182 laufen auf einer frisch angelegten `w_fin` bis `Migrationen angewendet.` durch (173 Dateien), mehrfach von Null. Jede Abfrage aller neuen Dienste habe ich als `cse_app` gegen dieselbe Datenbank geplant (`explain`), nicht nur getippt.

ZWEI FEHLER, DIE ERST DER ECHTE POSTGRES-LAUF GEZEIGT HAT — und die jetzt einen Test haben:
(1) Die erste Fassung der Policies `p_ma_ceiling` / `t_person` auf `ausgabe_steuer` prüfte `a.anstellung_id` in einer Unterabfrage auf `ausgabe`. Das ist eine FREMDE Tabelle, deren Spaltenrechte Postgres für den Aufrufer prüft — und `anstellung_id` fehlt im GRANT (K-05). Jeder Lesezugriff auf die Steuerzeilen endete mit `permission denied for table ausgabe`, auch für eine Buchhaltung mit allen Rechten. Behoben nach der Fassung, die 05-FINANZEN.md §1.4 ohnehin vorgibt: auf dem Kind wird die SICHTBARKEIT DES ELTERNTEILS gefragt. Nur die eigenen Policies einer Tabelle dürfen ihre gesperrten Spalten lesen.
(2) `kern.erzwinge_serverzeit()` stempelt fest `eingegangen_am`. Auf `rechnung_versand` (Spalte `freigegeben_am`) scheiterte damit JEDES Einfügen mit `record "new" has no field "eingegangen_am"`. Eigene Funktion `fin.rechnung_versand_serverzeit()`.

WAS ICH VON DER KRITIK ÜBERNOMMEN HABE (sie gilt vor dem Plan):
· Abschläge: `einbehaltCent()` wirft NICHT, sie gibt `0n` zurück. Die Seite zeigt `BEDINGUNGEN_PLATZHALTER.herkunft` wörtlich plus „offen (O-20)\" — kein try/catch um einen Fehler, den es nicht gibt. Zusätzlich gefunden: `auftrag.sicherheitseinbehalt_bp/_cent` existieren seit 0025 mit demselben O-20 im Kommentar; sie werden als hinterlegte Vertragsangabe GEZEIGT und nicht gerechnet.
· Hashkette: „blocker: keiner\" war falsch. `job_lauf` ist leer, und ein leerer Berichtsblock sieht aus wie „keine Befunde\". Die Seite sagt deshalb ausdrücklich „noch nie gelaufen\" und dass das NICHT „in Ordnung\" heisst. `KreisBefund` trägt keine Hashfelder — dafür die neue Abfrage `kettenkoepfe()`.
· Belege: `/api/dokument/[id]/url` gibt es nicht. Benutzt wird `/api/dokumente/[id]/datei` (`dokument.lesen`) — die Adresse, die `buchhaltung/buchungen/[id]/beleg` schon so benutzt. `BelegQuelle` in `eingangsrechnung.ts` kennt `erzeugt` nicht; der neue `beleg.ts` führt alle fünf Werte des DB-Enums, und ein Kerntest hält das fest. Der wirkliche Blocker ist der fehlende Objektspeicher, nicht eine fehlende Seedzeile — der Leerzustand sagt das.
· Steuer: `abrechnung.freistellung_pflegen` öffnet weder das Lesen noch das Schreiben. Die Seite ist lesend, nennt alle drei wirklich entscheidenden Rechte und die Lücke als O-604.
· Nummernkreise: `vergebeNummer()` erreicht die `ist_platzhalter`-Prüfung für Rechnungskreise NIE (`DEFINER_KREISE`), der Schutz sitzt allein in `fin.rechnung_nummer_ziehen`. Die Seite stellt den Widerspruch (Bezeichnung „Maske unbestätigt\" bei `ist_platzhalter = false`) als O-606 nebeneinander und ändert keine Daten. `kreise()` ist Umbau vorhandener SQL, wie die Kritik sagt.
· Storno: keine Seedarbeit — `rechnung_beziehung` trägt 2 Zeilen und es gibt eine festgeschriebene Storno-Rechnung.
· Ausgaben: nicht drei, sondern fünf Tabellen fehlen im Modul `eingang`, und es gibt eine ZWEITE hängende Spalte. 0180 verankert beide genannten (`rechnungsposition_quelle.ausgabe_id`, `konto_mapping.ausgabe_kategorie_id`) und zusätzlich `buchungssatz.ausgabe_id`; `bauleistung_jahressumme` kommt mit 0182; `bauabzug_anmeldung` und `eingangsrechnung_extraktion` bleiben offen (siehe `nicht_gebaut`).

WAS ZENTRAL NACHZUZIEHEN IST, damit CI grün wird:
· `docs/DECISIONS.md`: O-600 bis O-606 (Zeilen unter `decisions_zeilen`). Ohne sie meldet `scripts/guards/run-all.ts` `todo-client-nicht-im-register` für `services/finanz/versand.ts:254` und `services/finanz/vorabpruefung.ts:271/272` sowie `drizzle/0181:86`. Alle anderen O-Nummern, die ich verwende (O-05, O-20, O-21, O-22, O-36, O-46, O-77, O-134, O-176, O-183, O-185, O-186, O-352, O-357), stehen schon im Register — der Wächter meldet sie nicht.
· `src/server/db/schema/rls.ts`: fünf Einträge in `KEIN_HARD_DELETE` (Text unter `registry_rls`). Der `grund` ist wortwörtlich der Kommentar, der in meinen Migrationen im generierten Block steht — so bleibt `pnpm db:triggers --check` grün.
· `scripts/generate-triggers.ts`: drei Einträge in `MIGRATIONS_DATEIEN` ('0180', '0181', '0182'). Ohne sie bricht `pnpm db:triggers` mit einem undefinierten Pfad ab, sobald die rls.ts-Einträge da sind. Den Block habe ich in allen drei Dateien im Generatorformat vorgeschrieben (Sentinel, Kommentarzeile, Trigger, revoke, drei Leerzeilen), also ersetzt der Lauf ihn identisch.
· NICHT in `GEAENDERT_AM` und NICHT in `AUDITIERT` eintragen: `ausgabe`, `ausgabe_kategorie` und `bauleistung_jahressumme` tragen ihren `geaendert_am`-Auslöser schon von Hand (`trg_<tabelle>_geaendert`). Ein Registereintrag legte einen zweiten mit anderem Namen daneben, der dasselbe tut.
· Route-Manifest: nichts. Ich habe keine neue API-Adresse gebaut; alle Formulare posten auf bestehende Wege.
· Routenregister: nichts. Alle fünfzehn Routen stehen mit ihren Rechten schon in `routen.generiert.ts`.

DESIGN: kein neuer Gestaltungswert. Alle Farben, Abstände (s1…s7) und Schriftgrössen kommen aus DESIGN.md. Zwei Abweichungen, die ich melde, weil sie Ersatzwahl sind und keine Erfindung: (a) DESIGN §5 führt kein Pillenwort „Gesperrt\" — die Löschsperre eines Belegs wird auf `Archiviert` abgebildet und steht ausgeschrieben daneben (§9: Farbe trägt die Bedeutung nie allein); (b) `ausgabe_status` hat kein eigenes Pillenwort — `erfasst → Entwurf`, `freigegeben → Bereit`, `gebucht → Abgeschlossen`, `abgelehnt → Abgelehnt`, jeweils mit ausgeschriebenem Zustand daneben, wie die Eingangsrechnungsliste es schon macht.

WÄCHTER: `npx tsx scripts/guards/run-all.ts` meldet auf meinen Pfaden nur noch die fünf `todo-client-nicht-im-register`-Zeilen oben. Ein echter Treffer war dabei und ist behoben: die Wache `anzeige-berlin` schlug auf einer ZAHLENformatierung an, weil die Zeichenfolge `daten` das Wort `date` enthält — die Bindung heisst jetzt `dokv`, mit ausgeschriebenem Grund im Code. Die Wache meldet im Zweifel, und das ist richtig; eine Ausnahme dafür wäre der falsche Weg.

SEED — WAS FEHLT, DAMIT DIE SEITEN VORFÜHRBAR SIND (keine Seitenarbeit mehr, nur Daten):
· eine Eingangsrechnung im Zustand `in_pruefung` (nicht `gebucht`/`eingegangen`) — sonst zeigt /freigabe kein Formular. Das ist der von der Kritik korrigierte Punkt: es fehlt nicht „überhaupt eine\", sondern eine im richtigen STATUS.
· eine Freistellungsbescheinigung zu einem Lieferanten (0 Zeilen) — für die drei Ausgänge des §48.
· eine Abschlags- und eine Schlussrechnung an einem Auftrag — /abschlaege ist sonst leer.
· ein verworfener Entwurf — belegt die Zusage „1000 verworfene Entwürfe hinterlassen null Lücken\".
· `ausgabe_kategorie` (vier bis sechs je Bereich, `ist_platzhalter = true`) und `ausgabe`-Zeilen mit zwei Steuersätzen auf einem Kassenbeleg, davon eine Erstattung mit `anstellung_id`.
· ein Lauf `kette_pruefen` in `job_lauf` / `job_lauf_mandant` — sonst ist die Hauptrubrik der Hashkette leer (und sagt das, aber vorführbar ist sie erst mit einem Lauf).
· `beleg`-Zeilen entstehen erst mit einem verbundenen Objektspeicher (`seed/eingang.ts` gibt ohne ihn `nicht_verbunden` zurück) — das ist keine Seedzeile, sondern eine Umgebung.

OFFEN FÜR DIE NÄCHSTE RUNDE: die Inline-Formulare für Festschreiben, Verwerfen und Storno stehen weiterhin auf `rechnungen/[id]/page.tsx` (1119 Zeilen). Ich habe sie NICHT entfernt — sie funktionieren, und die Browsersuite kann sie benutzen; „Adding a feature never removes an existing one\". Sie herauszulösen ist eine eigene, kleine Änderung mit einem e2e-Lauf dahinter.
