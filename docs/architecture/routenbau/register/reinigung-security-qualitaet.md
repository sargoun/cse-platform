# Registereinträge: reinigung-security-qualitaet

**Warteschlange, kein Archiv.** Diese Einträge sind **noch nicht** im Baum. Die
gemeinsamen Dateien pflegt EINE Hand, weil mehrere Agenten gleichzeitig arbeiten
und sich sonst in dieselbe Zeile schreiben. Ist ein Abschnitt eingetragen, wird
er hier gelöscht — solange er hier steht, fehlt er dort.

**Die Einträge des Behebungsschritts gelten.** Er lief zuletzt und hatte den
Auftrag, die vollständige aktuelle Liste zu liefern — auch das, was sich seit
dem Bauschritt geändert hat.

## Stand

- Bau: fertig
- Kritik: 14 Befunde
- Behebung: 0 behoben, 0 widerlegt, 0 offen

> **Der Behebungsschritt lief noch nicht.** Die Einträge unten stammen aus dem Bauschritt und können durch ihn noch wachsen.

## Gebaute Adressen

- `/portal/[mandant]/reinigung` — fertig
  - Modulkopf mit vier Kacheln (Reviere, Schichten heute, offene Nachweise, Generator steht) und drei Listen. Die KRITIK-Korrektur ist umgesetzt: einsatz/planungsserie liegen hinter dienstplan.lesen, leistungsnachweis hinter nachweis.lesen, die Route haelt nur reinigung.lesen — jede Kachel ist deshalb `null` statt `0`, wenn ihr Recht fehlt, und die Seite schreibt „nicht geprueft". Neu: rechteImKontext() fragt die Fremdrechte in DERSELBEN Transaktion (Bauart von ladePlanfenster.abwesenheitGeprueft). listeNachweise nimmt jetzt mehrere Status (entwurf+vorgelegt in EINEM Aufruf statt zwei). Geltung kommt aus turnus, nicht aus planungsserie (die Spalte gibt es dort nicht).
- `/portal/[mandant]/reinigung/sonderleistungen` — fertig
  - Zwei getrennte, beschriftete Abschnitte (Katalogzeilen oben, Abrufe unten) plus Erfassungsformular. KRITIK umgesetzt: (1) statuswechsel() ist eine GETESTETE Funktion — `abgerechnet` und `storniert` sind Endzustaende, `abgerechnet` setzt nur die Rechnungsuebernahme, `storniert` nur der Stornoweg mit Grund; ohne die Sperre koennte ein abgerechneter Abruf zurueck auf `erbracht` und damit ein zweites Mal abrechenbar werden (positionsquelle.ts:461). (2) leistungskatalog_position liegt hinter katalog.lesen — ladeKatalogzeilen() fragt das Recht selbst und gibt `geprueft: false` zurueck. (3) Echte Feldnamen: kurztext/langtext/zeitwert_minuten/standard_einzelpreis_cent. (4) Kein Preisfeld auf der Abrufzeile; setzeZeitwert() faesst den Listenpreis nicht an. Storno als eigene Spalte, nie Loeschung.
- `/portal/[mandant]/reinigung/turnus` — fertig
  - Die Inline-Abfrage aus dienstplan/serien/page.tsx ist nach services/dienstplan/serienliste.ts gehoben; die bestehende Seite ruft jetzt listeSerien(). Die Bausteine EINSAETZE_LEBEND / EINSAETZE_LEBEND_JE_TURNUS / FEIERTAGSREGEL sind gemeinsam, damit „wie viele Termine" und „geplant bis" eine Wahrheit bleiben. listeTurnusse() ankert auf `turnus` (zeigt auch Turnusse OHNE Serie) und traegt die Karte `geprueft`: ohne dienstplan.lesen stehen generiert_bis und Einsatzzahl als „nicht geprueft" und NICHT als „Generator steht"/0. lesbareRegel ist aus der Seite in lib/datum/regeltext.ts gehoben (war sonst vierfach kopiert); regelFehler() macht eine unlesbare Regel zur Fehlerzeile statt sie zu raten. Archivierte Turnusse stehen am Ende, markiert, nicht ausgeblendet.
- `/portal/[mandant]/reinigung/turnus/[id]` — fertig
  - Vier Bloecke: Kopf, Vorkommnis-Vorschau (8 Wochen), Ausnahmen mit Anlegeformular, erzeugte Schichten. KRITIK umgesetzt: planeVorkommnisse liefert WEDER Instant NOCH DST-Kennzeichnung (GeplanterEinsatz hat kein anomalie-Feld, „Der Instant interessiert hier nicht"). Deshalb neue REINE Funktion turnusVorschau(), die ueber entfalte/loeseOrtszeitAuf beides liefert — Plandatum, Ortszeit, UTC-Instant, dst_luecke/dst_doppelt UND die wirkliche Dauer als Differenz der Instants (420/540 in den Umstellungsnaechten). Das Ende ist ein EIGENER Wanduhr-Anker, nicht Beginn+Dauer. ladeFeiertage ist aus generator.ts exportiert — ohne echte Feiertage zeigte die Vorschau Termine, die der Generator gleich darauf ueberspringt. Ausfaelle stehen MIT in der Liste, mit Grund. Feld-Bearbeiten bleibt Platzhalter nach Regel 1 (O-701), sichtbar als „offen (O-701)".
- `/portal/[mandant]/reinigung/turnus/neu` — fertig
  - KRITIK umgesetzt, alle vier Punkte: (1) EIGENER Handler /api/reinigung/turnus, der auf reinigung.schreiben autorisiert (das Recht der Route) und denselben Dienst legeTurnusSerieAn ruft — api/dienstplan/serien autorisiert hart auf dienstplan.schreiben. (2) Monatszweig im DIENST: monatsRegel() + turnusRegel() in serie.ts, mit INTERVAL; der 29.–31. wird NICHT auf den Monatsletzten umgedeutet. (3) Feiertagslader exportiert — die Vorschau laeuft ueber ECHTE Feiertage. (4) EINE Dauergrenze: MAX_DAUER_MINUTEN (1439) ist aus vorkommnisse.ts exportiert, pruefeTurnusEingabe liess vorher 1440 zu (anlegbar, danach stand der Nachtlauf). Der Ablauf ist Vorschau-dann-Bestaetigen (GET auf sich selbst, POST-Knopf UNTER der Terminliste), damit bestaetigt wird, was gezeigt wurde. Die Seite sagt VORHER, dass Anlegen auch dienstplan.schreiben braucht (planungsserie/einsatz-RLS) und bricht sonst atomar ab.
- `/portal/[mandant]/security` — fertig
  - KRITIK umgesetzt: die Art heisst `vorkommnis`, nicht `vorfall` (wachbuch_art hat fuenf Werte; 'vorfall' waere 22P02), und die Tabelle heisst wachbuch_eintrag. Die Kachel zaehlt Eintraege der Art `vorkommnis` in einem BENANNTEN Fenster (7 Berliner Tage) und sagt das in der Ueberschrift — „offen" gibt es als Zustand nicht. leseRegister/lageVon sind aus personal/nachweise/daten.ts in services/nachweis/register.ts gehoben; die daten.ts verweist nur noch dorthin (keine zweite Fassung). Abgelaufen steht als SPERRGRUND (SEC-04), nicht als Warnung; Schwellen kommen aus qualifikation.warnung_tage ueber lageVon. Jede Kachel ist `null` bei fehlendem Recht (dienstplan.lesen / personal.nachweis_lesen / wachbuch.lesen). Verweisblock: jeder Kasten steht unter dem Recht SEINES Ziels.
- `/portal/[mandant]/security/bewacherregister` — fertig
  - KRITIK umgesetzt, inklusive des VIERTEN Punkts: die Modulsperre bindet diese Route nicht an Security (einziges Recht personal.bewacher_verwalten, `personal` steht in QUERSCHNITT). securityGebucht() prueft mandant.module/module_gepflegt mit modulAktiv('security.lesen') — in der Seite UND im Handler, sonst waere der Schreibweg ohne die Seite erreichbar; false → 404 (D-377). Weiter: bewacher_eintrag traegt kein mandant_id, die Liste ist ueber `anstellung` eingegrenzt und nennt KEIN Entgeltfeld (K-05, Testschleife ueber alle Feldnamen). Personen OHNE Eintrag stehen mit in der Liste, sortiert nach Ablauf. Kein Format wird geprueft (O-40), keine Frist abgeleitet, „nicht verbunden" steht UEBER der Tabelle, kein Knopf taeuscht einen Registerabruf vor. erfasseEintrag braucht keine Migration — be_schreiben (INSERT auf personal.bewacher_verwalten) steht schon.
- `/portal/[mandant]/security/veranstaltungen/[id]` — fertig
  - Neuer Dienst findeVeranstaltung() — ladeVeranstaltung in eventbesetzung.ts ist privat und liefert KEIN Kopffeld (kein bezeichnung/beginn/ende/Ort/Leitung). KRITIK umgesetzt: der Besetzungsblock kennt DREI unterscheidbare Zustaende (nicht geprueft / geprueft ohne Schicht / besetzt), weil einsatz+einsatz_zuordnung hinter dienstplan.lesen und die Nachweislage hinter personal.nachweis_lesen liegen — eine unbesetzte und eine nicht lesbare Veranstaltung saehen sonst gleich aus. Keine Ampel und kein „dringend" aus soll_besetzung (O-210), Herkunft des Eventauftrags offen (O-703). Dauer = Differenz der Instants. Nachweislage zum Stichtag der VERANSTALTUNG, nicht heute. Seed liefert jetzt zwei Veranstaltungen, eine davon mit Ort nur als Text (der Fall VeranstaltungOhneObjekt).
- `/portal/[mandant]/qualitaet/pruefungen` — fertig
  - Der Lesepfad auf qualitaetspruefung existierte gar nicht — neu: listePruefungen(filter), findePruefung, ladeBefunde, ladePruefungAuswahl. Vier Kacheln, Filter „nur mit Mangel", Erklaerzeile UEBER der Tabelle. Keine Bestanden-Pille und kein Erfuellungsgrad, wo das Verfahren keine Skala traegt (O-29) — eine leere Prozentspalte ohne Erklaerung liest sich als 0 %. objekt/kunde/revier als LEFT JOIN (andere Rechte als qualitaet.lesen; Qualitaet ist Querschnittsmodul) → fehlende Namen heissen „nicht geprueft".
- `/portal/[mandant]/qualitaet/pruefungen/[id]` — fertig
  - Kopfblatt mit Serverzeit UND Geraetezeit + zeitabweichung_sek GETRENNT (Invariante 5; dafuer wurden die Felder dem Dienst hinzugefuegt), Verfahren mit Platzhalterkennzeichen, Pruefer, mit_kunde, Bemerkung, Dokumentverweis (hinter dokument.lesen). Befunde in Reihenfolge mit Kriterium, Raum, Ergebnis, Punkten (numeric-Text), Mangel, Frist und Foto ueber den signierten Medienweg (/api/medien/[id] autorisiert auf zeit.lesen — deshalb ist das der Gate). Ueberfaellige Fristen farbig UND im Text (DESIGN §9). Statt eines Bestanden-Felds ein Satz, warum keines da ist. Blatt ist lesend: Korrekturweg offen (O-704), „Mangel wird Reklamation" wird NICHT gebaut (O-705).
- `/portal/[mandant]/qualitaet/pruefungen/neu` — fertig
  - KRITIK umgesetzt, beide Punkte: (1) Der Kommentar „die Datenbank weist es zurueck" war falsch — qp_punkte_brauchen_skala prueft die EIGENE Spalte qualitaetspruefung.max_punkte, nicht pruefverfahren.max_punkte. Der Kommentar ist berichtigt und benennt erfassePruefung als die Sperre. (2) erfassePruefung setzte NIE revier_id auf der Position; der zusammengesetzte FK (mandant_id, revier_id, revier_raum_id) laeuft als MATCH SIMPLE und war damit ungeprueft — ein Revierraum aus fremdem Revier landete stillschweigend auf dem Protokoll. Neu: pruefeAnker() weist (a) Revierraum ohne Revier am Kopf, (b) Revierraum aus fremdem Revier und (c) Raum aus fremdem Objekt mit einem SATZ ab, und revier_id wird mitgeschrieben. Formular in drei Schritten, Objekt PFLICHT (qp_ein_anker), Pruefer = eigene Anstellung ODER externer Name (nie eine Liste, §10.5), Kriterien als datalist-VORSCHLAG (kein Katalog, O-29), Befundzeilen wachsen ohne Skript ueber einen GET. Nummer und Zeit vergibt der Dienst; Geraetezeit wird getrennt gespeichert.

## src/server/registry/dienste.ts

/**
   * **Die Reinigung, Runde zwei (PR reinigung-security-qualitaet).** Alle vier
   * lesen; geschrieben wird der Abruf und die Ausnahme, und beide hinter dem
   * Recht, das die RLS ihrer Tabelle verlangt.
   *
   * `reinigung/turnusvorschau` ist REIN — keine Datenbank, kein `now()`: sie
   * rechnet aus Regel, Anker und Feiertagskarte die Termine samt Instant und
   * DST-Befund. Deshalb `schreibend: false` ohne Gewissensfrage.
   *
   * `reinigung/sonderleistung` schreibt ZWEI Tabellen mit zwei Rechten:
   * `sonderleistung` hinter `reinigung.schreiben`, der Zeitwert einer
   * Katalogzeile hinter `katalog.schreiben`. Im Register steht das striktere
   * der beiden Module; die Aufteilung steht im Handler.
   */
  { modul: 'reinigung', pfad: 'reinigung/turnus', schreibend: true, schreibRecht: 'reinigung.schreiben' },
  { modul: 'reinigung', pfad: 'reinigung/turnusvorschau', schreibend: false },
  { modul: 'reinigung', pfad: 'reinigung/sonderleistung', schreibend: true, schreibRecht: 'reinigung.schreiben' },
  { modul: 'reinigung', pfad: 'reinigung/uebersicht', schreibend: false },
  /*
   * Der turnus-verankerte und der serien-verankerte Blick auf dieselben zwei
   * Zahlen („wie viele Termine", „geplant bis") — eine Quelle, zwei Seiten.
   * Rein lesend: geschrieben wird eine Serie in `dienstplan/serie`.
   */
  { modul: 'dienstplan', pfad: 'dienstplan/serienliste', schreibend: false },
  /*
   * Der Lesepfad des Nachweisregisters, gehoben aus
   * `app/portal/[mandant]/personal/nachweise/daten.ts`: der Modulkopf der
   * Sicherheit braucht dieselbe Auskunft und darf nicht die `daten.ts` einer
   * anderen Seite lesen.
   */
  { modul: 'personal', pfad: 'nachweis/register', schreibend: false },
  /**
   * **Die Sicherheit, Runde zwei.** `security/bewacherregister` schreibt —
   * und zwar unter `personal.bewacher_verwalten`, nicht unter
   * `security.schreiben`: `bewacher_eintrag` traegt kein `mandant_id`, der
   * Eintrag haengt am MENSCHEN (D-09), und die Policies `be_schreiben` /
   * `be_aendern` verlangen genau dieses Recht. Das Modul ist deshalb
   * `personal`.
   *
   * `security/uebersicht` und `security/veranstaltung` lesen nur.
   */
  { modul: 'personal', pfad: 'security/bewacherregister', schreibend: true, schreibRecht: 'personal.bewacher_verwalten' },
  { modul: 'security', pfad: 'security/uebersicht', schreibend: false },
  { modul: 'security', pfad: 'security/veranstaltung', schreibend: false },

## src/server/auth/route-manifest.ts

{
    pfad: 'api/reinigung/turnus',
    recht: 'reinigung.schreiben',
    grund:
      'CLN-02, CLN-03. Ein EIGENER Handler neben `api/dienstplan/serien`, und zwar wegen '
      + 'eines Rechtebruchs: jener autorisiert hart auf `dienstplan.schreiben`, die Route '
      + '`/portal/[mandant]/reinigung/turnus/neu` verlangt laut Manifest aber '
      + '`reinigung.schreiben` — eine Reinigungsleitung ohne Dienstplanrecht sah eine Seite, '
      + 'die ihr Recht anzeigt, und bekam hinter dem Knopf einen Fehler ueber ein anderes. '
      + 'Zwei Oberflaechen, zwei Rechte, EIN Dienst: dieser Handler prueft das Recht der '
      + 'Route und ruft `legeTurnusSerieAn`. Fuer die SERIE und die Schichten wird zusaetzlich '
      + '`dienstplan.schreiben` verlangt (RLS von `planungsserie`/`einsatz`); fehlt es, '
      + 'bricht die Transaktion ab und es entsteht auch kein Turnus — ein Turnus ohne Serie '
      + 'erzeugt keine Schicht und waere eine Regel, die aussieht, als gaelte sie. Die '
      + 'Ausnahme (`turnus_ausnahme`) braucht das zweite Recht nicht.',
  },
  {
    pfad: 'api/reinigung/sonderleistungen',
    recht: 'reinigung.schreiben',
    grund:
      'CLN-05, OPS-06. Vier Vorgaenge, EINE Adresse, ZWEI Rechte: Abruf erfassen, Zustand '
      + 'setzen und stornieren laufen auf `sonderleistung` und damit auf '
      + '`reinigung.schreiben`; der Zeitwert einer Katalogzeile laeuft auf '
      + '`leistungskatalog_position` und damit auf `katalog.schreiben` — dem Recht, das das '
      + 'Routenmanifest der Seite als Schreibrecht fuehrt. Der Handler autorisiert je Vorgang '
      + 'auf das Recht der TABELLE; ein gemeinsames Recht fuer beide Haelften waere eine '
      + 'erfundene Vereinfachung. Der Zustand `abgerechnet` kommt hier nicht durch: diesen '
      + 'Stempel setzt die Rechnungsuebernahme (`positionsquelle.ts`), und ein Weg zurueck '
      + 'auf `erbracht` machte den Abruf ein zweites Mal abrechenbar.',
  },
  {
    pfad: 'api/security/bewacherregister',
    recht: 'personal.bewacher_verwalten',
    grund:
      'SEC-03, LEG-04. Dasselbe Recht, das die Policies `be_schreiben` und `be_aendern` '
      + 'verlangen — und NICHT `security.schreiben`: `bewacher_eintrag` traegt kein '
      + '`mandant_id`, der Eintrag haengt am Menschen (D-09). Der Handler prueft zusaetzlich '
      + 'die MODULBUCHUNG (`securityGebucht`), weil die zentrale Modulsperre hier nicht '
      + 'greift: das einzige Recht dieser Route ist `personal.bewacher_verwalten`, und '
      + '`personal` steht in QUERSCHNITT. Ohne die Pruefung waere der Schreibweg in einer '
      + 'Gesellschaft ohne Security erreichbar. Kein Abgleich, kein Abruf, keine simulierte '
      + 'Antwort: `quelle` bleibt per Pruefbedingung `manuell`, und das Format der '
      + 'Bewacher-ID wird nicht geprueft (O-40).',
  },
  {
    pfad: 'api/qualitaet/pruefungen',
    recht: 'qualitaet.schreiben',
    grund:
      'OPS-11, SPEC §22. `qualitaet.schreiben` und nicht `reinigung.schreiben`: eine Pruefung '
      + 'an einem Wachobjekt ist dieselbe Zeile wie eine an einem Reinigungsrevier, und das '
      + 'Modul ist ein Querschnittsmodul (04-SEITENKARTE.md §5.6) — dasselbe Recht wie bei '
      + '`api/qualitaet/reklamationen` daneben. Nummer und Pruefzeitpunkt vergibt der Dienst '
      + '(`erfassePruefung`, Ausloeser `kern.qualitaetspruefung_feldzeit` auf `now()`); eine '
      + 'Zeit aus der Anfrage waere eine rueckdatierbare Pruefung (Invariante 5). Der KUNDE '
      + 'kommt vom Objekt und der PRUEFER aus der Sitzung — beides aus der Anfrage waere ein '
      + 'Protokoll im falschen Kundenkonto bzw. eines, das jemand einem Kollegen unterschiebt.',
  },

## src/server/db/schema/rls.ts

Keine neue Tabelle, keine neue Loeschsperre, kein neuer Trigger — `src/server/db/schema/rls.ts` braucht keinen Eintrag.

Alle acht benutzten Tabellen (turnus, turnus_ausnahme, sonderleistung, leistungskatalog_position, qualitaetspruefung, qualitaetspruefung_position, pruefverfahren, bewacher_eintrag, veranstaltung) stehen samt RLS und Archivregeln in der laufenden Datenbank; nachgemessen in pg_policies und \d.

NEBENBEFUND zur Kenntnis (keine Aenderung von mir): `bewacher_eintrag` traegt KEINE `loeschsperre`-Spalte, aber sehr wohl `trg_bewacher_eintrag_kein_hard_delete` und `trg_bewacher_eintrag_kein_truncate`. Falls rls.ts die Loeschsperren ueber die Spalte fuehrt, fehlt diese Tabelle dort — das ist eine Registerfrage, nicht eine dieser Domaene.

## src/server/registry/navigation.ts

Zwei Menuepunkte zeigen ausdruecklich deshalb auf eine Unterseite, weil die Modulwurzel fehlte. Beide sind jetzt gebaut — die Pfade gehoeren auf die Wurzeln, und die Begruendungen im Kommentar sind damit ueberholt.

ERSETZEN (bisher navigation.ts:214–226, Kommentar plus Zeile):

  /**
   * `security`, nicht `security/posten`: die Modulübersicht der Seitenkarte
   * (§5.8, Zeile 1) ist gebaut — drei Kacheln (unterbesetzte Posten, gesperrte
   * oder ablaufende § 34a-Nachweise, Vorkommnisse der letzten sieben Tage) und
   * die Wege des Moduls, jeder unter dem Recht seines Ziels.
   *
   * `gruppe: false` — und das ist eine Entscheidung, keine Auslassung. Der
   * Modulkopf liest `einsatz`, `nachweis` und `wachbuch_eintrag`; das Wachbuch
   * hat KEINEN Gruppenlesepfad (§1.7), und `/portal/gruppe/security` gibt es
   * nicht. Eine Gruppenleitung liest keine Vorkommnismeldungen einer anderen
   * Gesellschaft.
   */
  { schluessel: 'security', label: 'Security', pfad: 'security', recht: 'security.lesen', icon: 'security' },

ERSETZEN (bisher navigation.ts:227–238, Kommentar plus Zeile):

  /**
   * `reinigung`, nicht `reinigung/reviere`: die Modulübersicht hat mit dem
   * Turnus-Gesundheitsblatt ihren Inhalt bekommen — heutige Schichten, offene
   * Leistungsnachweise und die Serien, deren Generator stehen geblieben ist.
   * Die letzte ist die Auskunft, wegen der es die Seite gibt: ein leerer
   * Dienstplan sieht aus wie ein ruhiger Tag.
   *
   * Das Icon bleibt `reinigung` aus dem geschlossenen Satz (DESIGN §5).
   */
  { schluessel: 'reinigung', label: 'Reinigung', pfad: 'reinigung', recht: 'reinigung.lesen', icon: 'reinigung' },

Der eigene Punkt „Bewacherregister" (PR 42, weiter unten in derselben Datei) kann bleiben: die Route ist erreichbar und prueft die Modulbuchung jetzt selbst. Wo er auf `personal.bewacher_verwalten` bewacht ist, ist er korrekt — nur zeigt er in einer Gesellschaft ohne gebuchtes Security jetzt auf eine 404. Wenn das stoeren soll, braucht der Punkt `security.lesen` als ZWEITES Recht; das ist eine Registerentscheidung und keine Seitenentscheidung.

## Sonstiges

## docs/architecture/04-SEITENKARTE.md

- §5.7 Zeile `/reinigung/sonderleistungen`: die Zeile beschreibt „Katalogeintraege mit eigenen Zeitwerten" und vergibt `katalog.schreiben`, der Datenbestand dahinter sind aber ZWEI Dinge (`leistungskatalog_position` und `sonderleistung`). Die Seite fuehrt bis zur Antwort BEIDE Haelften getrennt und beschriftet; bitte O-702 an der Zeile vermerken.
- §5.8: es gibt weiterhin keine Route `/security/veranstaltungen/neu`, und woher ein Eventauftrag kommt, ist offen — bitte O-703 an der Zeile `/security/veranstaltungen` vermerken.
- §5.8 Zeile `/security/bewacherregister`: die Route traegt als einziges Recht `personal.bewacher_verwalten`; `personal` ist Querschnittsmodul, die zentrale Modulsperre greift also nicht. Die Seite UND der Handler pruefen die Modulbuchung jetzt selbst (`securityGebucht`). Bitte als Bauart notieren oder `security.lesen` als zweites Leserecht ins Manifest nehmen.
- §5.6 Zeilen `/qualitaet/pruefungen*`: bitte O-704 (Korrekturweg einer falsch erfassten Pruefung) und O-705 (was auf einen Mangel mit Frist folgt) vermerken.
- §5.7 Zeile `/reinigung/turnus/[id]`: bitte O-701 (Wirkung einer Regelaenderung auf bereits materialisierte Schichten) vermerken.

## docs/DESIGN.md

§5 fuehrt ein geschlossenes Pillenvokabular, und drei Wortsaetze dieser Domaene stehen nicht darin. Abgebildet statt erfunden — der Klartext steht als WORT daneben (§9). Zur Ergaenzung beantragt:

- `sonderleistung_status`: „Beauftragt" und „Erbracht" fehlen. Abgebildet auf Wartet / Offen / Geplant / Bereit / Abgeschlossen / Archiviert.
- `bewacher_status`: „Registriert", „Beantragt", „Erloschen", „Gesperrt" fehlen. Abgebildet auf Aktiv / Wartet / Archiviert / Fehler / Abgelehnt / Inaktiv.
- Ein Wort fuer „unbestaetigter Katalogwert" fehlt weiterhin (03-GEWERKE.md §2.3 Nr. 5 beantragt es schon); bis dahin steht es als Text in `--warning`.

Ausserdem fehlt ein Wort fuer den Zustand „nicht geprueft" (Recht fehlt, es gibt keine Aussage). Er kommt in dieser Domaene an sechzehn Stellen vor und ist konsequent als Text `nicht geprueft` in `--text-muted` gesetzt, nie als Farbe allein.

## src/server/db/seed/index.ts — schon eingebaut, hier zur Kenntnis

Zwei Aufrufe sind ergaenzt (Import in Zeile 25 und 27, Aufrufe nach `seedWachbuch` bzw. nach `seedReinigung`):

  const reg = await seedBewacherUndEvents(sql, ids, sec.objektId);
  const sonder = await seedSonderUndQualitaet(sql, ids);

Falls ein anderer Agent dieselbe Datei aendert und es kollidiert: beide Funktionen sind exportiert (`seed/security.ts`, `seed/reinigung.ts`), idempotent und steigen einzeln aus. Die Protokollzeilen stehen unmittelbar daneben im Diff.

## Zeilen für docs/DECISIONS.md, Abschnitt „Offen"

| O-700 | **Ist ein Ausfall eines Reinigungsturnus vom Pauschalbetrag abzuziehen, und ist ein Zusatztermin zusaetzlich zu berechnen — oder gleicht die Pauschale beides aus?** `turnus_ausnahme.abrechnungsrelevant` ist nullbar, und der Dienst leitet den Wert NICHT aus der Art ab: `art = 'ausfall' ? true : false` waere plausibel und waere eine Vertragsaussage, die niemand getroffen hat. Bis zur Antwort bleibt die Spalte leer, wenn niemand sie setzt; das Anlegeformular hat „offen — noch nicht entschieden" als Vorgabe und nicht „nein", und die Ausnahmeliste zeigt `offen (O-700)`. | CLN-02, CLN-03, FIN-01, `turnus_ausnahme.abrechnungsrelevant`, `services/reinigung/turnus.ts` |
| O-701 | **Was geschieht mit den bereits erzeugten Schichten, wenn Regel, Beginn oder Dauer eines laufenden Turnus geaendert werden — werden kuenftige Schichten nachgezogen, bleibt der Bestand unveraendert, oder wird die Serie beendet und eine neue angelegt?** An den materialisierten `einsatz`-Zeilen haengen Check-in-Links, Leistungsnachweise und Rechnungen. Eine still gewaehlte Variante veraendert rueckwirkend bezahlte Schichten — und zwar lautlos. `/reinigung/turnus/[id]` ist deshalb lesend gebaut und sagt es; rueckwirkungsfrei bleibt der Weg, den 0069 vorsieht: eine Ausnahme fuer einen einzelnen Tag. | CLN-02, TIM-02, TIM-03, `turnus`, `planungsserie`, `einsatz`, `services/dienstplan/generator.ts` |
| O-702 | **Pflegt die Seite „Sonderleistungen" die Katalogzeilen (Glas, Sonderreinigung, Warenraeumung mit ihren Zeitwerten) oder die einzelnen Abrufe je Objekt — oder beides, und wer pflegt dann den Leistungskatalog?** 04-SEITENKARTE.md §5.7 beschreibt Katalogeintraege und vergibt `katalog.schreiben`; dahinter liegen ZWEI Tabellen mit zwei Rechten (`leistungskatalog_position` / `katalog.lesen`+`katalog.schreiben`, `sonderleistung` / `reinigung.lesen`+`reinigung.schreiben`), und `/leistungskatalog` (Phase 4) gibt es noch nicht. Bis zur Antwort fuehrt die Seite beide Haelften getrennt und beschriftet, jede hinter ihrem Recht. Der LISTENPREIS wird dort ausdruecklich nicht geaendert: er geht in Angebote und Rechnungen, und zwei Seiten, die dieselbe Preisspalte schreiben, sind eine zu viel. | CLN-05, OPS-06, FIN-01, `leistungskatalog_position`, `sonderleistung`, `services/reinigung/sonderleistung.ts` |
| O-703 | **Woher entsteht ein Veranstaltungsauftrag — aus einer Auftragsleistung, aus dem Vertrieb oder handerfasst von der Wachleitung, und wer darf ihn anlegen?** Im ganzen Baum gab es keinen Anlegeweg fuer `veranstaltung`, und 04-SEITENKARTE.md §5.8 fuehrt keine Route `/veranstaltungen/neu`. Davon haengt ab, welche Felder Pflicht sind (`auftrag_leistung_id`? `dienstanweisung_id`?) und wer sie fuellt. `/security/veranstaltungen/[id]` ist deshalb ohne Anlegeknopf gebaut; der Seed schreibt zwei Zeilen handerfasst und OHNE `auftrag_leistung_id`, damit die Seite belegbar ist, ohne eine Herkunft zu behaupten. | SEC-08, OPS-05, `veranstaltung`, `services/security/veranstaltung.ts`, `db/seed/security.ts` |
| O-704 | **Wie wird eine falsch erfasste Qualitaetspruefung berichtigt — durch eine ersetzende Pruefung mit Verweis auf die alte (wie im Wachbuch), durch Archivieren mit Grund, oder ist eine Korrektur der Felder zulaessig?** `qualitaetspruefung` traegt `archiviert_am` und `loeschsperre`, aber KEIN `ersetzt_durch_id` — es gibt also keine Stelle, an der eine Richtigstellung auf ihren Vorgaenger zeigen koennte. Geloescht wird ohnehin nie (Invariante 8). Bis zur Antwort ist `/qualitaet/pruefungen/[id]` lesend, und eine Korrektur entsteht als neue Pruefung ohne Verweis. | OPS-11, SPEC §22, LEG-01, `qualitaetspruefung`, `wachbuch_eintrag.ersetzt_durch_id` als Vorbild |
| O-705 | **Was folgt auf einen Mangel mit Frist — entsteht daraus automatisch eine Reklamation oder eine Aufgabe, und wer ist verantwortlich, wenn die Frist verstreicht?** `qualitaetspruefung_position` traegt `mangel_beschreibung` und `frist_am`, aber keinen Schluessel auf `reklamation` oder `aufgabe`; in der ANDEREN Richtung gibt es einen (`reklamation.qualitaetspruefung_position_id`). Eine Verknuepfung „Mangel wird Reklamation" zu bauen hiesse zu entscheiden, WANN das geschieht und WER es tut — und eine verstrichene Frist waere dann ein Versprechen an den Kunden, das niemand gegeben hat (dieselbe Lage wie O-14 bei `reklamation.faellig_am`). Das Pruefblatt markiert eine ueberfaellige Frist farbig und im Text und sagt, dass daraus nichts von selbst folgt. | OPS-11, FIN-18, `qualitaetspruefung_position.frist_am`, `reklamation`, `aufgabe` |

## Befunde des Prüfers (14)

- **blockierend** · `/home/user/cse-platform/src/server/services/reinigung/turnus.ts` — `planungsserieId` wird — anders als `generiertBis` und `einsaetze` — NICHT auf `null` gesetzt, wenn `dienstplan.lesen` fehlt. `planungsserie` liegt hinter `dienstplan.lesen` (pg_policies: t_mandant → app.hat_recht('dienstplan.lesen', …)), der LEFT JOIN liefert dann still NULL. Zwei Oberflächen behaupten daraufhin eine Tatsache, die falsch ist: (1) /reinigung zeigt in Warnfarbe „Keine Serie — der Generator hat diesen Turnus noch nie gesehen" für JEDEN Turnus, (2) /reinigung/turnus zeigt die Kachel „Ohne Serie" mit der Zahl aller Turnusse. Genau der Fehler, den die KRITIK abstellen sollte — nur in die andere Richtung (Fehlalarm statt Fehlentwarnung). Erreichbar ist der Fall über `benutzer_mandant.module` (AUT-01, Schnittmenge in app.hat_recht_fuer): eine Reinigungsleitung mit `module = {reinigung}` hält `reinigung.lesen`, aber nicht `dienstplan.lesen`.
  - Behebung: In `alsZeile` (turnus.ts:167) `planungsserieId: planbar ? z.planungsserie_id : null` setzen und den Typ auf „`null` heisst: kein Recht ODER keine Serie" umstellen — oder besser ein eigenes Feld `serieGeprueft: planbar` einführen. Danach in reinigung/page.tsx:310 und reinigung/turnus/page.tsx:71 den Zweig „nicht geprüft" VOR „keine Serie" prüfen, wie es turnus/page.tsx:244 in der Spalte „Geplant bis" bereits richtig macht, und `ReinigungKopf.ohneSerie` (uebersicht.ts:134) auf `null` setzen, wenn `dienstplan.lesen` fehlt.
- **blockierend** · `/home/user/cse-platform/src/server/services/reinigung/qualitaet.ts` — `pruefeAnker` prüft Revierraum→Revier und Raum→Objekt, aber NICHT Revier→Objekt. Der Fremdschlüssel `qp_revier_fk` deckt das nicht ab: er lautet FOREIGN KEY (mandant_id, revier_id) REFERENCES revier(mandant_id, id) und kennt das Objekt nicht. Das Formular bietet dazu ALLE Reviere der Gesellschaft an, ungefiltert nach dem gewählten Objekt, obwohl `ladePruefungAuswahl` das `objektId` je Revier bereits mitliefert. Ergebnis: ein Prüfprotokoll mit Objekt A und Revier B wird stillschweigend gespeichert und auf der Liste als „Objekt A / Revier B" angezeigt. Das ist derselbe Defekt, den der Bauende für `revier_raum_id` ausdrücklich behoben hat — eine Ebene höher.
  - Behebung: In `pruefeAnker` eine vierte Prüfung ergänzen: bei gesetztem `revierId` `select 1 from revier where id = $1 and objekt_id = $2` gegen `eingabe.objektId`, sonst `RaumPasstNicht` mit einem Satz. Zusätzlich im Formular die Revierliste nach dem gewählten Objekt gruppieren (optgroup je `objektId`) oder das Revier erst nach Objektwahl anbieten.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/security/page.tsx` — Die Überschrift „§ 34a-Nachweise mit Frist" und die Kachel „Nachweise gesperrt oder ablaufend" (mit dem Zusatz „N sperren die Einteilung", also SEC-04) beziehen sich auf Daten, die gar nicht auf § 34a eingegrenzt sind: `ladeSecurityKopf` ruft `leseRegister(kontext, heute)`, und das liest ALLE Nachweise ALLER Qualifikationen (Erste Hilfe, Führerschein, Sachkunde …) der ganzen Gesellschaft — auch die von Reinigungskräften. Die dafür angelegte Konstante `BEWACHER_QUALIFIKATION = '34a'` wird im ganzen Baum nirgends benutzt. Ein abgelaufener Erste-Hilfe-Schein zählt so als Sperrgrund für eine Wacheinteilung.
  - Behebung: Entweder `leseRegister` um einen optionalen `qualifikationSchluessel`-Filter erweitern und in `ladeSecurityKopf` mit `BEWACHER_QUALIFIKATION` aufrufen, oder im Dienst nach `zeile.qualifikationSchluessel === BEWACHER_QUALIFIKATION` filtern. Wenn bewusst alle Qualifikationen gezeigt werden sollen, müssen Überschrift und Kachel das sagen („Nachweise mit Frist") und der SEC-04-Zusatz „sperren die Einteilung" muss weg.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/security/bewacherregister/page.tsx` — Erfundene Frist ohne Entscheidung und ohne TODO: die Kachel „Läuft in 60 Tagen ab" verwendet eine fest in der Seite stehende 60-Tage-Schwelle. `bewacher_eintrag` trägt keine Warnstufen, O-40 (Format, Pflichtfelder, Meldeereignisse) ist ausdrücklich offen, und die Datei selbst schreibt „keine Frist wird abgeleitet". Genau hier wird eine abgeleitet. Für Nachweise verlangt das Projekt die Schwellen aus `qualifikation.warnung_tage` statt aus einer Seitenkonstante — für das Bewacherregister gibt es keine solche Quelle, also ist die Zahl eine unentschiedene Geschäftsregel im Code.
  - Behebung: Die Schwelle als benannte Konstante in den Dienst heben und mit `// TODO(client, O-40): In welchem Vorlauf ist eine ablaufende Bewacher-Erlaubnis zu melden?` versehen, in `docs/DECISIONS.md` unter „Offen" eintragen — oder die Kachel bis zur Entscheidung durch eine ersetzen, die keine Schwelle braucht (z. B. „mit Ablaufdatum erfasst").
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/reinigung/turnus/neu/page.tsx` — Die zugesagte Rückmeldung des Generators erreicht niemanden. Die Seite verspricht zweimal ausdrücklich, die Serienliste melde die Zahl der erzeugten Schichten und das Übersprungene; der Handler hängt `?angelegt=…&erzeugt=N&bestand=1&uebersprungen=…` an die Weiterleitung. Die Zielseite `/portal/[mandant]/reinigung/turnus` nimmt aber gar kein `searchParams` entgegen und rendert keinerlei Erfolgs- oder Übersprungen-Hinweis. Das Ergebnis des Generatorlaufs — inklusive „0 Schichten erzeugt, weil Objekt ohne Kunde" — verschwindet lautlos. Genau das, was der Plan („statt es zu verschweigen") ausschliessen wollte.
  - Behebung: `/portal/[mandant]/reinigung/turnus` um `searchParams` erweitern und `angelegt`, `erzeugt`, `bestand` und `uebersprungen` als Hinweis über der Tabelle ausgeben (Muster: `sonderleistungen/page.tsx` mit `ok`/`fehler`). Alternativ auf das neue Turnusblatt `${liste}/${turnusId}` weiterleiten und die Meldung dort zeigen.
- **wichtig** · `/home/user/cse-platform/src/app/api/reinigung/sonderleistungen/route.ts` — Der einzige Anlegeweg für einen Abruf setzt `auftrag_leistung_id` nie — weder hat das Formular ein Feld dafür, noch reicht der Handler etwas durch. `ladeAbrufe` in der Rechnungsübernahme verbindet `sonderleistung` aber per INNER JOIN mit `auftrag_leistung`; ein Abruf ohne Vertragszeile ist damit strukturell nicht abrechenbar. Die Seite kennzeichnet dieselben Zeilen anschliessend selbst in einer `danger`-Kachel „Ohne Vertragszeile" und in einem Warnhinweis als nicht abrechenbar — sie erzeugt also genau den Zustand, den sie als Fehler meldet, und bietet keinen Weg, ihn zu beheben.
  - Behebung: Im Formular eine Auswahl der aktiven `auftrag_leistung`-Zeilen des gewählten Objekts anbieten (Nummer + Kurztext + Einheit) und `auftragLeistungId` im Handler durchreichen; `ladeAbrufAuswahl` um diese Liste erweitern (hinter `auftrag.lesen`, mit „nicht geprüft"-Fall). Wenn die Zuordnung bewusst später erfolgen soll, braucht es einen zweiten Vorgang „Vertragszeile zuordnen" — sonst ist jeder hier erfasste Abruf tote Arbeit.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/qualitaet/pruefungen/page.tsx` — Die vier Kacheln rechnen auf der GEFILTERTEN und auf 200 Zeilen begrenzten Liste. Mit aktivem Filter „Nur mit Mangel" (`?mangel=1`) zeigt die Kachel „Prüfungen (alle)" die Zahl der Prüfungen MIT Mangel, „Im laufenden Monat" und „Mängelfristen überfällig" ebenfalls nur den Ausschnitt. Die Beschriftung „alle" ist dann falsch.
  - Behebung: Die Kacheln aus einem ungefilterten Zähl-Aufruf speisen (eigene `count`-Abfrage im Dienst) oder die Beschriftungen an den aktiven Filter anpassen („Prüfungen mit Mangel"), und bei erreichtem Limit einen Hinweis „mehr als 200 — Kachelzahlen unvollständig" zeigen.
- **klein** · `/home/user/cse-platform/src/app/api/qualitaet/pruefungen/route.ts` — Lücke in der Prüferauflösung: bei `pruefer_art !== 'extern'` und fehlender eigener Anstellung lässt die Bedingung den Vorgang durch, sobald ein externer Name im Feld steht — dieser Name wird danach aber verworfen, weil `prueferExternName` nur bei `prueferArt === 'extern'` gesetzt wird. Ergebnis: eine Prüfung ohne `pruefer_anstellung_id` UND ohne `pruefer_extern_name`; die Tabelle hat dafür keine Prüfbedingung. Über die Oberfläche ist der Fall nicht erreichbar (ohne Anstellung wird „extern" vorausgewählt), über einen gleich-origin-POST schon.
  - Behebung: Den externen Namen unabhängig von `pruefer_art` übernehmen, wenn keine eigene Anstellung gefunden wurde (`prueferExternName: prueferAnstellungId === null ? externName : (prueferArt === 'extern' ? externName : null)`), oder am Ende hart abweisen, wenn beide Felder leer bleiben.
- **klein** · `/home/user/cse-platform/src/server/services/reinigung/uebersicht.ts` — Die Kachel „Schichten heute" und die Liste „Heute" filtern undokumentiert auf `e.quelle = 'turnus'`. Reinigungsschichten aus anderen Quellen (`sonderleistung`, `manuell`) fallen lautlos heraus, und die Seite schreibt dann „Für heute steht keine Reinigungsschicht im Plan." Heute fällt das nicht auf, weil es im Baum noch keinen Anlegeweg für solche Einsätze gibt — beim ersten kommt genau die stille Entwarnung zurück, gegen die die Seite gebaut wurde.
  - Behebung: Entweder auf `e.revier_id is not null or e.quelle in ('turnus','sonderleistung')` erweitern, oder den Filter in der Kachelbeschriftung benennen („Turnus-Schichten heute") und im Dienstkommentar begründen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/reinigung/turnus/[id]/page.tsx` — Der Erfolgshinweis nach dem Erfassen einer Ausnahme behauptet unbedingt: „bereits erzeugte Schichten des betroffenen Tages werden dabei storniert, nicht gelöscht". `storniereVerwaiste` storniert aber nur Einsätze mit `beginn_zeitpunkt > now()` und ohne Zeiterfassung. Für eine Ausnahme auf einen vergangenen Tag (das Datumsfeld lässt das zu, Vorgabewert ist heute) oder auf eine Schicht mit Zeiteinträgen stimmt der Satz nicht.
  - Behebung: Den Satz präzisieren („künftige Schichten des Tages werden storniert; Schichten mit erfasster Zeit bleiben stehen") und im Formular entweder `min={heute}` setzen oder beim Speichern eines vergangenen Datums darauf hinweisen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/qualitaet/pruefungen/neu/page.tsx` — Erfundener Gestaltungswert: `min-h-[88px]` auf dem Bemerkungsfeld. Der Wert steht nicht in docs/DESIGN.md und kommt im ganzen Baum genau einmal vor — alle anderen Textfelder benutzen ausschliesslich die Tokenklassen.
  - Behebung: Auf `rows={3}` allein setzen oder eine Tokenklasse verwenden; falls eine Mindesthöhe für mehrzeilige Felder gebraucht wird, sie zuerst in docs/DESIGN.md aufnehmen und dann benutzen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/reinigung/page.tsx` — `NACHWEIS_PILLE` führt den Schlüssel `gesperrt`, den es im Aufzählungstyp `leistungsnachweis_status` nicht gibt (entwurf|vorgelegt|signiert|abgelehnt|storniert). Toter Eintrag, der beim Lesen den Eindruck erweckt, es gäbe diesen Zustand.
  - Behebung: Zeile entfernen.
- **klein** · `/home/user/cse-platform/src/server/registry/routen.generiert.ts` — Manifest und gebaute Seite gehen beim Schreibrecht auseinander: `/portal/[mandant]/reinigung/sonderleistungen` führt `schreiben: ["katalog.schreiben"]`, die Seite zeigt aber drei Schreibformulare auf `sonderleistung` (Abruf erfassen, Zustand setzen, stornieren), die der Handler korrekt auf `reinigung.schreiben` autorisiert. Das Recht, unter dem die Hälfte der Seite schreibt, steht damit in keinem Routeneintrag.
  - Behebung: Registerzeile um `reinigung.schreiben` ergänzen (Entscheidung des Registerbetreuers) oder — wenn O-702 zugunsten des Katalogs entschieden wird — die Abrufhälfte von dieser Route auf eine eigene verlegen.
- **klein** · `/home/user/cse-platform/tests/kern/turnus-vorschau.test.ts` — Der vierte Pflichtfall aus CLAUDE.md („ten shifts starting at the same instant on one object") ist nicht abgedeckt. Der Test „zehn Vorschauen derselben Regel ergeben denselben Instant" ruft zehnmal dieselbe reine Funktion auf und prüft Determinismus — nicht zehn Schichten auf EINEM Objekt zum selben Instant (Eindeutigkeit von `einsatz_quelle_uk`, Besetzung, Überschneidungssperren). Der Bericht führt ihn dennoch als einen der vier Pflichtfälle.
  - Behebung: Den Fall dort abdecken, wo er entsteht — als Isolationstest gegen echtes Postgres: zehn Einsätze mit demselben `beginn_zeitpunkt` auf einem Objekt anlegen und prüfen, dass Eindeutigkeitsindex, Besetzung und ArbZG-Prüfung sich erwartungsgemäss verhalten; oder im Bericht klarstellen, dass dieser Pflichtfall noch offen ist.

**Urteil:** Solide gebaute Domäne mit echtem Inhalt: alle elf Seiten rufen wirklich Dienste, tragen Datenbankzeilen und sind nicht leer. Spaltennamen und Enumwerte habe ich gegen w_rsq geprüft — turnus, turnus_ausnahme, sonderleistung, leistungskatalog_position, qualitaetspruefung(_position), pruefverfahren, bewacher_eintrag, veranstaltung, einsatz, wachbuch_art: kein einziger Fehltreffer, `vorkommnis` statt `vorfall` ist korrigiert, `kurztext/zeitwert_minuten/standard_einzelpreis_cent` stimmen, `lkp_zeitwert_positiv` existiert wirklich. Keine neue Tabelle, keine Migration, RLS und Löschsperren stehen; `withTenant` + Rechteprüfung serverseitig, fehlendes Recht → 404 über mandantTor, die Modulsperre für das Bewacherregister ist in Seite UND Handler eingebaut. Geld bleibt bigint-Cent als Text, Zeit ist timestamptz, die Dauer kommt als Differenz zweier Instants — `turnusVorschau` ist eine reine, gut getestete Funktion (40 kern-Tests laufen grün, DST-Vor- und Rückstellnacht mit 420/540 Minuten inklusive), typecheck ist für alle Dateien dieser Domäne sauber, keine vorgetäuschte Integration, `git diff` zeigt bei den angefassten Bestandsdateien (dienstplan/serien/page.tsx, personal/nachweise/daten.ts, serie.ts, vorkommnisse.ts, generator.ts, leistungsnachweis.ts) nur Hebungen und additive Erweiterungen, nichts Entferntes.

Zwei blockierende Befunde bleiben, und beide sind Rückfälle in genau die Fehlerklasse, gegen die diese Domäne gebaut wurde. Erstens: `planungsserieId` ist als einziges der drei fremdberechtigten Felder nicht auf `null` gesetzt, wenn `dienstplan.lesen` fehlt — zwei Seiten behaupten daraufhin in Warnfarbe „Keine Serie — der Generator hat diesen Turnus noch nie gesehen\", obwohl es die Serie gibt; erreichbar über `benutzer_mandant.module` (AUT-01). Zweitens: `pruefeAnker` schliesst den Revierraum aus fremdem Revier aus, lässt aber das REVIER aus fremdem Objekt durch (`qp_revier_fk` kennt nur den Mandanten), und das Formular bietet dazu alle Reviere ungefiltert an — ein Prüfprotokoll landet am falschen Haus. Dazu vier wichtige Befunde: die §-34a-Kachel der Sicherheit zählt in Wahrheit alle Qualifikationen (die dafür angelegte Konstante `BEWACHER_QUALIFIKATION` wird nirgends benutzt), im Bewacherregister steht eine erfundene 60-Tage-Frist ohne TODO und ohne Registerzeile, die zugesagte Generator-Rückmeldung nach dem Turnusanlegen verschwindet, weil die Zielseite kein `searchParams` nimmt, und jeder über die neue Oberfläche erfasste Sonderleistungsabruf ist wegen des fehlenden `auftrag_leistung_id` strukturell nicht abrechenbar — was dieselbe Seite anschliessend selbst als roten Befund meldet. Der Isolationstest war auftragsgemäss nicht ausführbar; die Aussagen darin konnte ich nur statisch prüfen.

## Notizen des Bauender

MIGRATIONEN: keine. Mein Bereich 0285–0289 bleibt UNGENUTZT — alle acht Tabellen (turnus, turnus_ausnahme, sonderleistung, leistungskatalog_position, qualitaetspruefung(_position), pruefverfahren, bewacher_eintrag, veranstaltung) stehen samt RLS und Archivregeln in der Datenbank, und auch `be_schreiben` (INSERT auf personal.bewacher_verwalten) gab es entgegen der Planannahme schon. Der Migrationslauf wurde trotzdem viermal vollstaendig gefahren (drop/create w_rsq + pnpm db:migrate), zuletzt bis 0299 mit „Migrationen angewendet.".

ISOLATIONSSUITE NICHT AUSGEFUEHRT — und wie ich sie stattdessen geprueft habe. `pnpm test:isolation` ist untersagt, und sein global-setup baut/seedet cse_test (ebenfalls untersagt). Stattdessen habe ich in meiner eigenen Datenbank w_rsq ein tsx-Skript gefahren, das die Fixturen als Eigentuemer anlegt und dann JEDEN Dienst unter der echten Rolle `cse_app` mit denselben GUCs aufruft, die die Harness setzt (FORCE RLS aktiv): 69 Zusicherungen, alle gruen. Dazu ein zweiter Lauf fuer die Seed-Nachtraege: 18 Zusicherungen, alle gruen (inkl. Idempotenz im zweiten Durchgang). Die Skripte lagen im Projektwurzelverzeichnis (Modulauflaesung) und sind geloescht. Vier Fehler hat diese Handprobe gefunden, die ein reiner Typecheck NICHT gefunden haette: `anstellung.eintritt_am` heisst `eintritt`; `anstellung.status` kennt kein 'ausgetreten' (nur geplant|aktiv|ruhend|beendet); `mandant.farbe` heisst `farbe_token`; `revier_raum` verlangt `objekt_id` und `erstellt_von_art`. Genau die Stellen, an denen geraten wird.

BACKTICK-FALLE: ein SQL-Kommentar mit Backticks in einem Template-Literal beendet die Zeichenkette. Hat mich in bewacherregister.ts einmal getroffen (TS1005) — der Kommentar steht jetzt ohne und sagt warum.

RECHTE QUER ZUR ROUTE — die durchgaengige Bauart dieser Domaene. Die KRITIK hatte in fuenf von elf Routen denselben Befund, und ich habe ihn ueberall gleich geloest: jede Tabelle, deren RLS ein ANDERES Recht verlangt als die Route haelt, wird LEFT JOIN (nie inner — sonst verschwinden Zeilen statt Spalten), und die Seite fragt das Recht ueber das neue `rechteImKontext()` in DERSELBEN Transaktion. `null` heisst „nicht geprueft", `0` heisst „geprueft und nichts offen"; die Oberflaeche unterscheidet beides in WORTEN. Gemessene Rechte je Tabelle: objekt/raum → objekt.lesen; kunde → crm.lesen; leistungskatalog_position → katalog.lesen; einsatz/einsatz_zuordnung/planungsserie → dienstplan.lesen; leistungsnachweis → nachweis.lesen; nachweis/bewacher_eintrag → personal.nachweis_lesen; posten/veranstaltung → security.lesen; dienstanweisung → dienstanweisung.lesen; dokument → dokument.lesen. Die Alternative — die fehlenden Rechte ins Routenmanifest zu nehmen — sperrte eine Reinigungsleitung ohne Dienstplanrecht vom GANZEN Modulkopf aus (404, AUT-06) statt ihr drei von vier Auskuenften zu geben. Wenn die Registerpflege das anders will, ist es eine Zeile in routen.generiert.ts und keine Seitenaenderung.

VIER FREMDE DEFEKTE MITGENOMMEN, weil sie meine Routen unmittelbar betrafen: (1) `pruefeTurnusEingabe` liess Dauer 1440 zu, `nominalesEnde` bis 1439 — ein anlegbarer Turnus, der danach jede Nacht den Generator anhielt; MAX_DAUER_MINUTEN ist jetzt exportiert und die einzige Grenze. (2) `erfassePruefung` schrieb `revier_id` nie auf die Position; der zusammengesetzte FK laeuft MATCH SIMPLE und war damit ungeprueft — ein Revierraum aus fremdem Revier landete stillschweigend auf dem Pruefprotokoll. (3) Der Kommentar in qualitaet.ts behauptete, `qp_punkte_brauchen_skala` pruefe `pruefverfahren.max_punkte`; er prueft die EIGENE Spalte, die Sperre ist allein der Dienst — der Kommentar lud zum Umgehen ein (Invariante 6). (4) `listeNachweise` nahm nur EINEN Status, „entwurf/vorgelegt" brauchte zwei Aufrufe mit zwei `limit 200`.

VIER TOTE VERWEISE GEFUNDEN UND GESCHLOSSEN (tests/kern/verweis-rechte.test.ts, AUT-06): mein Dokumentverweis im Pruefblatt und im Bewacherregister (dokument.lesen), der Rueckweg „← Sicherheit" im Bewacherregister (security.lesen — die Route haelt nur personal.bewacher_verwalten) und der Personenname im Securitykopf, der auf `/personal/nachweise/[id]` zeigt: das EINZELBLATT verlangt `personal.nachweis_verwalten`, nicht `nachweis_lesen`. Die 19 verbleibenden Befunde dieses Tests liegen alle in fremden Seiten (bau, crm, datenschutz, einstellungen, finanzen, zeiten) und sind nicht von mir.

GESTALTUNG: keine erfundenen Werte. Nur s1…s7, die vorhandenen Farbtoken und das geschlossene Pillenvokabular aus DESIGN §5. Drei Wortsaetze fehlen dort und sind auf den naechstliegenden vorhandenen Wert abgebildet, mit dem Klartext als WORT daneben (§9) — Einzelheiten und der Ergaenzungsantrag stehen in `registry_sonstiges`. Icons ausschliesslich aus ICON_PFADE. Der Zustand „nicht geprueft" kommt sechzehnmal vor und ist ueberall Text in `--text-muted`, nie Farbe allein.

KEINE VORGETAEUSCHTEN INTEGRATIONEN: das Bewacherregister hat keinen Abgleichknopf, `quelle` bleibt per Pruefbedingung `manuell`, und „Nicht mit dem Bewacherregister verbunden" steht UEBER der Tabelle statt als Fussnote — ohne diesen Satz liest sich „Registriert" wie eine behoerdliche Auskunft.

SEED: die vier leeren Tabellen sind gefuellt, ueber die ECHTEN Dienste und damit unter RLS (nicht als Eigentuemer an den Policies vorbei). `seedSonderUndQualitaet` legt drei Katalogzeilen (Glas/Sonderreinigung/Warenraeumung, `ist_platzhalter = true`, KEIN erfundener Preis — bepreist wird ueber auftrag_leistung), vier Abrufe in vier Zustaenden (`abgerechnet` fehlt absichtlich) und zwei Qualitaetspruefungen an, eine davon mit ueberfaelliger Maengelfrist. `seedBewacherUndEvents` legt vier Bewachereintraege in vier Lagen an (gueltig, Vorwarnfenster, ABGELAUFEN, beantragt) und laesst eine Person bewusst OHNE Eintrag — genau sie ist die Luecke, die SEC-03 sichtbar machen soll — plus zwei Veranstaltungen, eine mit Objekt und Eventschicht ueber `erzeugeVeranstaltungsschicht`, eine mit Ort nur als Text (der Fall `VeranstaltungOhneObjekt`).

ZWEI HEBUNGEN mit Folgen in fremden Dateien, beide minimal: `dienstplan/serien/page.tsx` ruft jetzt `listeSerien()` statt seiner Inline-Abfrage (und `lesbareRegel` aus lib), und `personal/nachweise/daten.ts` ist ein reiner Re-Export auf `services/nachweis/register.ts`. Beide bleiben unter demselben Namen importierbar; keine zweite Fassung irgendwo.

DAS FEHLT NOCH und ist keine Seitenarbeit: `docs/DECISIONS.md` kennt O-700…O-705 noch nicht, deshalb meldet die Wache `todo-client-nicht-im-register` sechs Treffer in meinen Dateien — die Zeilen stehen fertig in `decisions_zeilen`. Ebenso fehlen die Dienstregister- und Manifesteintraege (portal-shell.test.ts und routen.test.ts sind deswegen rot); die Texte stehen in `registry_dienste` und `registry_manifest`. Typecheck, eslint und alle uebrigen Wachen sind auf meinen Pfaden sauber.
