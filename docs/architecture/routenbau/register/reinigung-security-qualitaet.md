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
- Behebung: 13 behoben, 1 widerlegt, 6 offen

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

## src/server/registry/dienste.ts

UNVERAENDERT gegenueber dem Bauschritt. Die Eintraege stehen woertlich in
`docs/architecture/routenbau/register/reinigung-security-qualitaet.md` und gelten weiter:

  { modul: 'reinigung', pfad: 'reinigung/turnus', schreibend: true, schreibRecht: 'reinigung.schreiben' },
  { modul: 'reinigung', pfad: 'reinigung/turnusvorschau', schreibend: false },
  { modul: 'reinigung', pfad: 'reinigung/sonderleistung', schreibend: true, schreibRecht: 'reinigung.schreiben' },
  { modul: 'reinigung', pfad: 'reinigung/uebersicht', schreibend: false },
  { modul: 'dienstplan', pfad: 'dienstplan/serienliste', schreibend: false },
  { modul: 'personal', pfad: 'nachweis/register', schreibend: false },
  { modul: 'personal', pfad: 'security/bewacherregister', schreibend: true, schreibRecht: 'personal.bewacher_verwalten' },
  { modul: 'security', pfad: 'security/uebersicht', schreibend: false },
  { modul: 'security', pfad: 'security/veranstaltung', schreibend: false },

Kein neuer Dienst, keine geaenderte Modulzuordnung, kein geaendertes Schreibrecht. Der
Behebungsschritt hat nur BESTEHENDE Dienste erweitert:

- `reinigung/turnus`: `TurnusZeile` traegt zusaetzlich `serieGeprueft: boolean`; `planungsserieId`
  ist ohne `dienstplan.lesen` jetzt `null`.
- `reinigung/uebersicht`: `ReinigungKopf.ohneSerie` ist jetzt `readonly TurnusZeile[] | null`.
- `reinigung/sonderleistung`: `AbrufAuswahl` traegt zusaetzlich `vertragszeilen` (hinter
  `auftrag.lesen`, mit „nicht geprueft\"-Fall); `ladeAbrufAuswahl` fragt `auftrag.lesen` mit.
- `reinigung/qualitaet`: neu `zaehlePruefungen()` und `PRUEFUNG_GRENZE` (beide lesend, kein
  eigener Registereintrag noetig — dieselbe Datei, derselbe Pfad).
- `security/uebersicht`: `BEWACHER_QUALIFIKATION` (Wert `'34a'`, traf keine Katalogzeile) ist
  ersetzt durch `BEWACHER_QUALIFIKATIONEN` mit den drei echten Schluesseln; `NachweisLage`
  traegt zusaetzlich `bewacher: boolean`.
- `security/bewacherregister`: neu exportiert `BEWACHER_VORWARNUNG_TAGE` (Platzhalter, O-707).

## src/server/auth/route-manifest.ts

## src/server/registry/routen.generiert.ts (GENERIERTER BLOCK — von mir nicht angefasst)

Eine Zeile aendern, Zeile 127. Grund: die Seite `/portal/[mandant]/reinigung/sonderleistungen`
fuehrt ZWEI Haelften mit ZWEI Rechten — die Katalogzeilen unter `katalog.schreiben`, die
Abrufe (erfassen, Zustand setzen, stornieren) unter `reinigung.schreiben`. Der Handler
autorisiert das bereits je Vorgang korrekt (`api/reinigung/sonderleistungen/route.ts:78-85`);
im Register stand bisher nur die Kataloghaelfte, also schrieb die halbe Seite unter einem
Recht, das in keinem Routeneintrag vorkommt.

BISHER:

  { pfad: "/portal/[mandant]/reinigung/sonderleistungen", beschreibung: "Glas · Sonderreinigung · Warenräumung as catalogue entries with their own time values", bewachung: {"art":"recht","lesen":["reinigung.lesen"],"schreiben":["katalog.schreiben"],"aal2":false}, scope: "M1", spec: ["CLN-05","OPS-06"], phase: 5, abschnitt: "5.7 Trade module — Reinigung (CLN-01…CLN-05)", zeile: 1096 },

NEU:

  { pfad: "/portal/[mandant]/reinigung/sonderleistungen", beschreibung: "Glas · Sonderreinigung · Warenräumung as catalogue entries with their own time values", bewachung: {"art":"recht","lesen":["reinigung.lesen"],"schreiben":["reinigung.schreiben","katalog.schreiben"],"aal2":false}, scope: "M1", spec: ["CLN-05","OPS-06"], phase: 5, abschnitt: "5.7 Trade module — Reinigung (CLN-01…CLN-05)", zeile: 1096 },

Alternative, falls O-702 zugunsten des Katalogs entschieden wird: die Abrufhaelfte auf eine
eigene Route verlegen. Das ist eine Registerentscheidung, keine Seitenentscheidung.

## src/server/auth/route-manifest.ts

UNVERAENDERT gegenueber dem Bauschritt — die vier Eintraege (`api/reinigung/turnus`,
`api/reinigung/sonderleistungen`, `api/security/bewacherregister`, `api/qualitaet/pruefungen`)
stehen woertlich in `docs/architecture/routenbau/register/reinigung-security-qualitaet.md`
und gelten weiter. Der Behebungsschritt hat kein Recht und keine Adresse verschoben.

## src/server/db/schema/rls.ts

## src/server/db/schema/rls.ts

KEIN Eintrag noetig — unveraendert gegenueber dem Bauschritt. Der Behebungsschritt hat keine
Tabelle, keine Policy, keine Loeschsperre und keinen Ausloeser angelegt oder geaendert; es gibt
auch keine neue Migration (Bereich 0285–0289 bleibt unbenutzt).

NEBENBEFUND aus dem Bauschritt, unveraendert zur Kenntnis: `bewacher_eintrag` traegt KEINE
`loeschsperre`-Spalte, hat aber `trg_bewacher_eintrag_kein_hard_delete` und
`trg_bewacher_eintrag_kein_truncate`. Fuehrt `rls.ts` die Loeschsperren ueber die Spalte, fehlt
diese Tabelle dort. Registerfrage, nicht Domaenenfrage.

NEUER NEBENBEFUND aus dem Behebungsschritt (keine Aenderung von mir, aber fuer den
Registerbetreuer wichtig): `qualitaetspruefung` hat KEINE Pruefbedingung, die einen Pruefer
verlangt — `qp_akteur_stimmig` prueft den ERFASSER (`erstellt_von_art`/`erstellt_von`), nicht
`pruefer_anstellung_id`/`pruefer_extern_name`. Eine Zeile ohne beides ist auf Datenbankebene
erlaubt. Der Dienstweg schliesst das jetzt (Befund 8), eine Pruefbedingung waere die zweite
Verteidigungslinie — das ist eine Migration und gehoert damit nicht in meinen Nummernbereich.

## src/server/registry/navigation.ts

## src/server/registry/navigation.ts

UNVERAENDERT gegenueber dem Bauschritt — die beiden ERSETZEN-Bloecke stehen woertlich in
`docs/architecture/routenbau/register/reinigung-security-qualitaet.md` und gelten weiter
(`security` statt `security/posten`, `reinigung` statt `reinigung/reviere`, jeweils mit
Kommentar).

EINE Korrektur am Kommentartext des ersten Blocks, weil die Seite jetzt anders heisst: dort
steht „drei Kacheln (unterbesetzte Posten, gesperrte oder ablaufende § 34a-Nachweise,
Vorkommnisse der letzten sieben Tage)\". Die mittlere Kachel heisst jetzt „Nachweise abgelaufen
oder ablaufend\" und ist nicht auf § 34a eingegrenzt (Befund 3, O-706). Bitte im Kommentar
ersetzen durch: „abgelaufene oder ablaufende Nachweise\". Der Eintrag selbst — Pfad, Recht,
Icon, `gruppe: false` — bleibt wie er ist.

Der eigene Punkt „Bewacherregister\" (PR 42) bleibt unveraendert gueltig, inklusive der offenen
Registerfrage aus dem Bauschritt, ob er `security.lesen` als ZWEITES Recht braucht.

## Sonstiges

## docs/architecture/04-SEITENKARTE.md

Unveraendert aus dem Bauschritt:
- §5.7 Zeile `/reinigung/sonderleistungen`: O-702 an der Zeile vermerken (die Zeile beschreibt
  Katalogeintraege und vergibt `katalog.schreiben`, dahinter stehen aber ZWEI Tabellen).
- §5.8: O-703 an der Zeile `/security/veranstaltungen` vermerken (es gibt weiterhin keine
  Route `/security/veranstaltungen/neu`).

Neu aus dem Behebungsschritt:
- §5.7 Zeile `/reinigung/sonderleistungen`: zusaetzlich O-708 vermerken — die Vertragszeile
  laesst sich beim Erfassen setzen, aber nicht nachtraeglich zuordnen.
- §5.8 Zeile `/security` (Modulkopf): die Liste heisst nicht mehr „§ 34a-Nachweise\", sondern
  „Nachweise mit Frist\", und zeigt alle Qualifikationen der Gesellschaft; O-706 an der Zeile
  vermerken.
- §5.8 Zeile `/security/bewacherregister`: O-707 an der Zeile vermerken (Vorwarnvorlauf).

## Warteschlangendatei

`docs/architecture/routenbau/register/reinigung-security-qualitaet.md` traegt im Abschnitt
„Stand\" noch „Behebung: 0 behoben, 0 widerlegt, 0 offen\" und den Satz „Der Behebungsschritt
lief noch nicht.\" Beides ist jetzt ueberholt: 13 behoben (12 Befunde plus ein Eigenbefund an
der Testfixtur), 1 widerlegt, 1 als Registereintrag zurueckgegeben. Ich habe die Datei nicht
angefasst, weil sie die gemeinsame Warteschlange ist.

## Arbeitsbaum, ausserhalb meiner Aenderungen

`vitest.rsq.tmp.config.ts` erscheint als geloescht (` D`). Es war MEINE Notizdatei (eine Kopie
von `vitest.isolation.config.ts` ohne `globalSetup`, um die Isolationszusagen gegen die eigene
Datenbank zu fahren, solange der gemeinsame Vorlagenbau haengt). Ein paralleler Agent hat sie
mit Commit 8151634 („Die Warteschlange traegt jetzt auch die Befunde …\") versehentlich
mitcommittet; ich habe sie geloescht. Die Loeschung ist richtig und soll bleiben.

## Zeilen für docs/DECISIONS.md, Abschnitt „Offen"

| O-706 | **Zeigt der Sicherheits-Modulkopf nur die Bewachernachweise oder alle Nachweise mit Frist?** Die Liste hiess „§ 34a-Nachweise mit Frist" und war auf nichts eingegrenzt: `leseRegister` kennt keinen Qualifikationsfilter und liefert jede Zeile der Gesellschaft. Die dafuer angelegte Konstante `BEWACHER_QUALIFIKATION = '34a'` wurde nirgends benutzt — und haette, benutzt, KEINE Katalogzeile getroffen: im plattformweiten Katalog heissen sie `34a_sachkunde`, `34a_unterrichtung` und `bewacherausweis`. Ein Filter darauf haette die Liste still geleert und „nichts abgelaufen" gemeldet. **Heute gebaut:** die Liste zeigt weiter ALLE Nachweise mit Frist — weil SEC-04 nicht an der Qualifikation haengt, sondern an `einsatzanforderung.zwingend` des jeweiligen Postens (`app.einsatz_qualifikation_erfuellt`), also auch eine abgelaufene Unterweisung sperren kann —, Ueberschrift und Kachel sagen das jetzt, der unbelegte Zusatz „N sperren die Einteilung" ist weg, und `BEWACHER_QUALIFIKATIONEN` traegt die drei echten Schluessel und MARKIERT die betroffenen Zeilen mit „§ 34a". Die Frage ist fachlich: soll der Modulkopf der Sicherheit auf die Bewacherqualifikationen verengt werden — mit dem Preis, dass eine abgelaufene, aber zwingend geforderte Erste-Hilfe- oder Unterweisungszeile dort nicht mehr auffaellt? | SEC-02, SEC-04, `services/security/uebersicht.ts`, `services/nachweis/register.ts`, `db/seed/qualifikation.ts` |
| O-707 | **In welchem Vorlauf ist eine ablaufende Bewacher-Erlaubnis zu melden?** Die Kachel „Laeuft in 60 Tagen ab" rechnete gegen eine blanke `60` in der Seite. `bewacher_eintrag` traegt — anders als `qualifikation`, wo `warnung_tage` die Schwellen als Daten fuehrt und `lageVon` sie ausliest — KEINE Warnstufen, und O-40 deckt nur Format, Pflichtfelder und Meldeereignisse ab. Damit war die Zahl eine unentschiedene Geschaeftsregel im Code, in einem Register, das ueber die Einsetzbarkeit eines Menschen entscheidet. **Heute gebaut:** die Schwelle heisst `BEWACHER_VORWARNUNG_TAGE` und steht EINMAL im Dienst, ausdruecklich als Platzhalter; die Kachel nennt die Zahl UND kennzeichnet sie als offen, und darueber steht ein Hinweis, dass gegen einen Platzhalter gerechnet wird. Die Frage hat zwei Haelften: welcher Vorlauf gilt, und gehoert die Schwelle in den Eintrag (wie `qualifikation.warnung_tage`) oder gilt eine feste Frist fuer alle? Kommen Warnstufen in die Tabelle, tritt die Konstante ersatzlos zurueck. | SEC-03, LEG-04, O-40, `services/security/bewacherregister.ts` |
| O-708 | **Laesst sich die Vertragszeile eines bereits erfassten Abrufs nachtraeglich zuordnen — und nach `abgerechnet` noch?** Die Rechnungsuebernahme verbindet `sonderleistung` per INNER JOIN mit `auftrag_leistung` (`finanz/abrechnungsart/einzelabruf.ts`); ein Abruf ohne `auftrag_leistung_id` ist damit strukturell nicht abrechenbar. Der einzige Anlegeweg setzte das Feld nie — weder hatte das Formular es, noch reichte der Handler etwas durch —, und dieselbe Seite meldete die so entstandenen Zeilen anschliessend selbst als „Ohne Vertragszeile". **Heute gebaut:** das Formular bietet die lebenden Vertragszeilen an (nach Objekt gruppiert, Rahmenzeilen ohne Objektbezug in eigener Gruppe), hinter `auftrag.lesen` mit „nicht geprueft"-Fall, und der Handler reicht sie durch. Die Angabe bleibt FREIWILLIG, weil ein Abruf oft vor dem Nachtrag entsteht, der die Zeile ueberhaupt erst schafft. Ein zweiter Vorgang „Vertragszeile zuordnen" ist bewusst NICHT gebaut: ob eine solche Nachtragung zulaessig ist, wer sie darf, und ob sie nach dem Stempel `abgerechnet` noch erlaubt sein soll, ist eine Vertrags- und Buchungsfrage — eine still gewaehlte Antwort schluege einen bereits abgerechneten Abruf einer anderen Vertragszeile zu. | CLN-05, OPS-06, FIN-07, `services/reinigung/sonderleistung.ts`, `finanz/abrechnungsart/einzelabruf.ts` |
| O-700 | **Ist ein Ausfall eines Reinigungsturnus vom Pauschalbetrag abzuziehen und ein Zusatztermin zusaetzlich zu berechnen, oder gleicht die Pauschale beides aus?** (aus dem Bauschritt, unveraendert) `turnus_ausnahme.abrechnungsrelevant` bleibt `null` — UNBEANTWORTET, nicht „nein": ein vorausgewaehltes „nein" waere eine Vertragsaussage, die niemand getroffen hat. Das Feld im Formular fuehrt „offen — noch nicht entschieden (O-700)" als Vorgabe. | CLN-02, CLN-03, `services/reinigung/turnus.ts`, `api/reinigung/turnus/route.ts` |
| O-701 | **Was geschieht mit den bereits erzeugten Schichten, wenn Regel, Beginn oder Dauer eines laufenden Turnus geaendert werden — werden kuenftige Schichten nachgezogen, bleibt der Bestand unveraendert, oder wird die Serie beendet und eine neue angelegt?** (aus dem Bauschritt, unveraendert) An den erzeugten Schichten haengen Check-in-Links, Leistungsnachweise und Rechnungen; eine still gewaehlte Variante veraenderte rueckwirkend bezahlte Schichten. Regel, Beginn und Dauer sind auf dem Turnusblatt deshalb NICHT aenderbar, sichtbar als „offen (O-701)"; fuer einen einzelnen Tag gibt es die Ausnahme. | CLN-02, TIM-02, `portal/[mandant]/reinigung/turnus/[id]/page.tsx` |
| O-702 | **Pflegt die Seite „Sonderleistungen" die Katalogzeilen oder die einzelnen Abrufe je Objekt — oder beides, und wer pflegt dann den Leistungskatalog?** (aus dem Bauschritt, unveraendert) Die Seite fuehrt bis zur Antwort BEIDE Haelften getrennt und beschriftet, jede hinter dem Recht ihrer Tabelle (`leistungskatalog_position` → `katalog.schreiben`, `sonderleistung` → `reinigung.schreiben`). Der Registereintrag der Route fuehrt darum jetzt beide Schreibrechte. | CLN-05, OPS-06, `services/reinigung/sonderleistung.ts` |
| O-703 | **Woher entsteht ein Veranstaltungsauftrag — aus einer Auftragsleistung, aus dem Vertrieb oder handerfasst von der Wachleitung, und wer darf ihn anlegen?** (aus dem Bauschritt, unveraendert) Es gibt weiterhin keine Route `/security/veranstaltungen/neu`; der Seed legt zwei Veranstaltungen an, eine davon mit Ort nur als Text. | SEC-08, `services/security/veranstaltung.ts`, SEITENKARTE §5.8 |
| O-704 | **Wie wird eine falsch erfasste Qualitaetspruefung berichtigt — durch eine ersetzende Pruefung mit Verweis auf die alte (wie im Wachbuch), durch Archivieren mit Grund, oder ist eine Korrektur der Felder zulaessig?** (aus dem Bauschritt, unveraendert) Das Pruefblatt ist lesend; die Tabelle traegt keinen Korrekturweg. | OPS-11, `portal/[mandant]/qualitaet/pruefungen/[id]/page.tsx` |
| O-705 | **Was folgt auf einen Mangel mit Frist — entsteht daraus automatisch eine Reklamation oder eine Aufgabe, und wer ist verantwortlich, wenn die Frist verstreicht?** (aus dem Bauschritt, unveraendert) Es entsteht heute NICHTS von selbst; die ueberfaellige Frist wird farbig UND im Text gezeigt, mehr nicht. | OPS-11, OPS-12, `portal/[mandant]/qualitaet/pruefungen/[id]/page.tsx`, `db/seed/reinigung.ts` |

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

## Vom Behebenden WIDERLEGT (Befund war falsch)

- [KLEIN 14] „Der vierte Pflichtfall aus CLAUDE.md ist nicht abgedeckt" — WIDERLEGT, Code unveraendert. Der Pflichtfall „ten shifts starting at the same instant on one object" IST gegen echtes Postgres abgedeckt, nur nicht in der vom Pruefer gelesenen Datei: `tests/isolation/dienstplan-generator.test.ts:242-279`, Abschnitt „(5) zehn Serien zur selben Sekunde an einem Objekt (TIM-04)" — eine Serie plus NEUN weitere Reviere/Turnusse/Serien auf DEMSELBEN Objekt mit derselben Anfangszeit, danach `select count(*) from einsatz where objekt_id = $1 and beginn_zeitpunkt = (select zeitpunkt from app.loese_ortszeit(date '2027-01-04','06:00','Europe/Berlin'))` mit `expect(z!.anzahl, 'zehn Schichten, zehn Zeilen').toBe(10)`. Die strukturelle Haelfte (kein `exclude using`, kein eindeutiger Index ueber `objekt_id` + `beginn_zeitpunkt`) haelt `tests/kern/dienstplan-schema.test.ts:58-80` unter „TIM-04". Der Dateikopf von `tests/kern/turnus-vorschau.test.ts` sagt seit dem Bauschritt selbst, der Fall sei „zur Haelfte hier … und zur Haelfte im Isolationstest" — die Behauptung, der Bericht fuehre den Determinismus-Test als den ganzen Pflichtfall, trifft die Datei nicht. Zutreffend war allein, dass der `describe`-Name aus dem Zusammenhang gerissen ueberzogen klingt; er heisst jetzt „Pflichtfall 4, Haelfte 1 von 2 — die Aufloesung ist deterministisch" und der Kommentar nennt Datei und Abschnitt der anderen Haelfte. GEPRUEFT: beide Dateien laufen gruen (44 Zusagen).

## Nach der Behebung noch offen

- [KLEIN 13] `src/server/registry/routen.generiert.ts:127` — Befund BESTAETIGT, aber nicht von mir geaendert: die Datei ist ein GENERIERTER Block und steht auf der Nichtanfassen-Liste. Die Seite zeigt drei Schreibformulare auf `sonderleistung` unter `reinigung.schreiben` (Abruf erfassen, Zustand setzen, stornieren), der Registereintrag fuehrt als `schreiben` nur `katalog.schreiben`. Ersatzzeile steht unter `registry_manifest` — bitte zentral einsetzen.
- O-706 (neu): Umfang der Nachweiskachel/-liste im Sicherheits-Modulkopf. Heute: ALLE Nachweise der Gesellschaft mit Frist, die Bewacherqualifikationen markiert.
- O-707 (neu): Vorwarnvorlauf fuer eine ablaufende Bewacher-Erlaubnis. Heute: benannter Platzhalter `BEWACHER_VORWARNUNG_TAGE = 60`, in der Kachel als offen gekennzeichnet.
- O-708 (neu): nachtraegliche Zuordnung/Aenderung der Vertragszeile eines Abrufs, und ob das nach `abgerechnet` zulaessig ist. Heute: Zuordnung nur beim Erfassen; ein zweiter Vorgang „Vertragszeile zuordnen" ist bewusst NICHT gebaut.
- FREMDDOMAENE, blockiert die Isolations-Suite: `pnpm db:seed` bricht derzeit in `legeKatalogHierarchieAn` (`src/server/db/seed/vertrieb.ts:541-576`) mit `42501 new row violates row-level security policy for table "leistungskatalog_position"` ab. Ursache liegt in der parallel laufenden Katalogarbeit (`drizzle/0298_leistungskatalog_status.sql` ungetrackt, `src/server/db/seed/vertrieb.ts` und `src/server/services/stammdaten/katalog.ts` geaendert, `src/server/services/katalog/` neu): der einzige Katalog steht auf `status = 'entwurf'`, die Policy `leistungskatalog_position.t_mandant` verlangt `katalog.schreiben`. NACHGEWIESEN NICHT MEINE AENDERUNG: der Seedschritt meiner Domaene laeuft davor durch („4 Einzelabrufe …, 2 Qualitaetspruefungen") und `seedVertrieb` importiert keine meiner Dateien. Folge: `tests/isolation/global-setup.ts` kann die Vorlagen nicht bauen, also laeuft `pnpm test:isolation` fuer NIEMANDEN. Gehoert dem Eigner der Katalogdomaene.
- FREMDDOMAENE: `tests/isolation/reinigung.test.ts` > „eine neu angelegte Gesellschaft bekommt ihre Platzhalterzeile" faellt mit „Fuer den Bereich pruef-<zufall> gibt es kein Identitaetstoken in DESIGN §1" (`trg_mandant_identitaet_anlegen`). Der Test legt bewusst einen Mandanten mit Zufalls-Slug an; eine neuere Identitaets-Migration laesst das nicht mehr zu. Vorbestehend, nicht von mir beruehrt, und die Entscheidung (Test-Slug mit Token, oder Ausloeser fuer Testslugs durchlaessig) gehoert zur Identitaetsarbeit.

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

## Notizen des Behebender

PRUEFSTAND. `pnpm typecheck` sauber. `npx eslint .` sauber. `pnpm guards` meldet nur `todo-client-nicht-im-register` (83 Treffer im ganzen Baum, davon 9 aus dieser Domaene — das ist genau die Warteschlange, die zentral eingetragen wird; keine einzige Verletzung einer Gestaltungs- oder Farbregel). Migration nach der letzten Aenderung erneut gegen die eigene Datenbank geprueft: `drop/create w_rsq` + `cse.fenster_schluessel` + `pnpm db:migrate` → „Migrationen angewendet\" bis `0304`. KEINE neue Migration; der Bereich 0285–0289 bleibt unbenutzt, weil kein Befund eine Schemaaenderung verlangte.

TESTS. kern: `turnus-vorschau`, `dienstplan-schema`, `nachweis`, `reinigung-schnappschuss`, `reinigung-sollzeit`, `reinigung-turnus-regel`, `security-umgehungsweg`, `sonderleistung-status` — 89 Zusagen gruen. isolation `reinigung-security-qualitaet.test.ts` — 23 von 23 gruen (21 vorhandene + 2 neue Regressionszusagen). Beide neuen Zusagen sind GEGENGEPRUEFT: mit zurueckgenommenem Fix faellt jeweils genau sie und nur sie.

WARUM DIE ISOLATIONSLAEUFE UEBER EINE EIGENE KONFIGURATION LIEFEN. `pnpm test:isolation` startet ueber `tests/isolation/global-setup.ts` einen vollstaendigen `pnpm db:seed` fuer die Vorlagendatenbank — und der bricht derzeit in der KATALOGDOMAENE ab (siehe „offen\"). Damit laesst sich die Suite zurzeit fuer keine Domaene fahren. Ich habe deshalb eine Notizkopie der Konfiguration ohne `globalSetup` benutzt und gegen eine selbst angelegte, migrierte und bis zum Abbruchpunkt geseedete Datenbank gefahren; die Notizkopie ist wieder geloescht. Die Zusagen selbst sind unveraendert die des Baums.

ZWEI FUNDE, DIE DIE KRITIK NICHT HATTE UND DIE WICHTIGER SIND ALS DIE HALBE LISTE:
(1) `BEWACHER_QUALIFIKATION = '34a'` traf KEINE Katalogzeile. Der Pruefer schlug als ersten Weg vor, `leseRegister` damit zu filtern — das haette die Liste still geleert und aus einer falschen Ueberschrift eine falsche Entwarnung gemacht, also den Fehler verschlimmert. Die echten Schluessel (`34a_sachkunde`, `34a_unterrichtung`, `bewacherausweis`) sind nachgemessen; zwei davon tragen ausserdem `laeuftAb: false`, ein Filter auf „§ 34a mit Frist\" waere also ohnehin fast immer leer gewesen.
(2) `tests/isolation/reinigung-security-qualitaet.test.ts` konnte seit dem Bauschritt NIE laufen (Fixtur gegen abgeschaltete Ausloeser). Alle 22 Zusagen dieser Domaene waren tot, ohne dass es auffiel — weil die Suite als Ganzes am Vorlagenbau haengt. Behoben; deshalb stehen jetzt ueberhaupt erst Zahlen hinter „23 gruen\".

ZUR SCHWERE VON BEFUND 1. Der Pruefer nennt es „Fehlalarm statt Fehlentwarnung\" und hat recht, aber die Reparatur ist nicht symmetrisch zur Entwarnung: `planungsserieId === null` bedeutet nach dem Fix „kein Recht ODER keine Serie\" und ist als Spalte allein KEINE Auskunft mehr. Ein blosses `planbar ? … : null` haette die Oberflaechen still auf „keine Serie\" stehen lassen. Deshalb das zusaetzliche Feld `serieGeprueft` — es ist der einzige Weg, auf dem eine Seite die beiden Faelle noch auseinanderhalten kann, und die Regressionszusage prueft genau das (sie faellt naemlich NICHT an `planungsserieId`, sondern an `ohneSerie`).

GESTALTUNG. Keine neuen Werte. Entfernt wurde `min-h-[88px]`; verwendet wurden ausschliesslich vorhandene Tokenklassen (`text-micro`, `text-text-subtle`, `tracking-[0.08em]` — letzteres steht im Baum bereits mehrfach, u. a. auf dem Turnusblatt). Alle neuen Oberflaechentexte sind deutsch. Fehlendes Recht fuehrt weiterhin zu 404, nicht 403 (AUT-06); Routenhandler bleiben duenn (autorisieren → Dienst → zurueck), die neue Zaehlung der Qualitaetskacheln und die Ankerpruefung liegen im Dienst, nicht in der Komponente.

GEAENDERTE DATEIEN (alle absolut):
/home/user/cse-platform/src/server/services/reinigung/turnus.ts
/home/user/cse-platform/src/server/services/reinigung/uebersicht.ts
/home/user/cse-platform/src/server/services/reinigung/qualitaet.ts
/home/user/cse-platform/src/server/services/reinigung/sonderleistung.ts
/home/user/cse-platform/src/server/services/security/uebersicht.ts
/home/user/cse-platform/src/server/services/security/bewacherregister.ts
/home/user/cse-platform/src/app/portal/[mandant]/reinigung/page.tsx
/home/user/cse-platform/src/app/portal/[mandant]/reinigung/turnus/page.tsx
/home/user/cse-platform/src/app/portal/[mandant]/reinigung/turnus/[id]/page.tsx
/home/user/cse-platform/src/app/portal/[mandant]/reinigung/sonderleistungen/page.tsx
/home/user/cse-platform/src/app/portal/[mandant]/security/page.tsx
/home/user/cse-platform/src/app/portal/[mandant]/security/bewacherregister/page.tsx
/home/user/cse-platform/src/app/portal/[mandant]/qualitaet/pruefungen/page.tsx
/home/user/cse-platform/src/app/portal/[mandant]/qualitaet/pruefungen/neu/page.tsx
/home/user/cse-platform/src/app/api/reinigung/sonderleistungen/route.ts
/home/user/cse-platform/src/app/api/qualitaet/pruefungen/route.ts
/home/user/cse-platform/tests/kern/turnus-vorschau.test.ts
/home/user/cse-platform/tests/isolation/reinigung-security-qualitaet.test.ts
Geloescht: /home/user/cse-platform/vitest.rsq.tmp.config.ts (meine Notizdatei, von einem parallelen Agenten versehentlich mitcommittet).
