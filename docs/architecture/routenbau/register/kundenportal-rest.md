# Registereintraege: kundenportal-rest

**Warteschlange, kein Archiv.** Diese Eintraege sind **noch nicht** im Baum.
Eingetragen heisst geloescht.

## Gebaut

- /home/user/cse-platform/src/server/services/kundenportal/auftrag.ts — listeKundenauftraege, findeKundenauftrag, leistungenZumAuftrag, auftragsGesellschaften (neu)
- /home/user/cse-platform/src/server/services/kundenportal/angebot.ts — listeKundenangebote, findeKundenangebot, angebotsTexte, positionenZumAngebot, steuernZumAngebot, angebotsSummen, bindefristText, bindefristVorbei, angebotsGesellschaften (neu)
- /home/user/cse-platform/src/server/services/kundenportal/objekt.ts — listeKundenobjekte, findeKundenobjekt, raeumeZumObjekt, auftraegeZumObjekt, objektGesellschaften (neu)
- /home/user/cse-platform/src/server/services/kundenportal/dokument.ts — listeKundendokumente, findeKundendokument, dokumentKategorien, dateigroesse, dateityp, DOKUMENTE_ERREICHBAR, SIGNATUR_MINUTEN, KATEGORIE_LABEL (neu)
- /home/user/cse-platform/src/app/portal/kunde/auftraege/page.tsx (neu)
- /home/user/cse-platform/src/app/portal/kunde/auftraege/[id]/page.tsx (neu)
- /home/user/cse-platform/src/app/portal/kunde/angebote/page.tsx (neu)
- /home/user/cse-platform/src/app/portal/kunde/angebote/[id]/page.tsx (neu)
- /home/user/cse-platform/src/app/portal/kunde/objekte/page.tsx (neu)
- /home/user/cse-platform/src/app/portal/kunde/objekte/[id]/page.tsx (neu)
- /home/user/cse-platform/src/app/portal/kunde/dokumente/page.tsx (neu)
- /home/user/cse-platform/src/app/portal/kunde/dokumente/[id]/page.tsx (neu)
- /home/user/cse-platform/src/app/portal/kunde/bausteine.tsx — neu: GesellschaftsFilter, slugAus, FilterWurzel; Zurueck-Union um die vier neuen Wurzeln erweitert
- /home/user/cse-platform/src/app/portal/kunde/page.tsx — Uebersicht von sechs auf ZEHN Sprungkarten (auftraege, angebote, objekte, dokumente ergaenzt); Rechte weiterhin aus dem Routenregister
- /home/user/cse-platform/src/server/services/kundenportal/uebersicht.ts — sechs neue Zaehler (auftraege, auftraegeAktiv, angebote, angeboteOffen, objekte, dokumente) in DERSELBEN einen Abfrage
- /home/user/cse-platform/src/app/portal/kunde/rechnungen/page.tsx — auf den gemeinsamen GesellschaftsFilter/slugAus umgestellt (Markup, data-cse und Klassen unveraendert)

## Migrationen

- KEINE. Die Nummern 0355–0359 bleiben frei. Gegen eine eigene Datenbank gemessen (w_kupo2, frisch migriert, echte Kundensitzung mit `kunde_zugang`): `auftrag`, `auftrag_leistung`, `angebot`, `angebotsposition`, `angebot_steuer`, `objekt`, `raum` und `mandant` sind im Kunden-Scope vollstaendig lesbar und richtig verengt — es fehlt keine Policy, also darf keine Migration eine erfinden. Die einzige Luecke (`dokument` ohne permissive `t_kunde`) IST die offene Entscheidung O-671 und wird nicht nebenbei beantwortet.

## src/server/db/schema/rls.ts — GEPRÜFT, NICHTS EINZUTRAGEN (18.09.2026)

Nachgemessen und deshalb gestrichen: dieser Stapel legt keine Tabelle an und ändert
keine Löschsperre, also bleibt `KEIN_HARD_DELETE`, `AUDITIERT`, `GEAENDERT_AM` und
`NUR_UEBER_DEFINER` unverändert.

Die zwei gemessenen Befunde bleiben hier stehen — sie gehören nicht in dieses Register,
sondern in DIESELBE künftige Migration, sobald O-671 beantwortet ist:

1. `dokument` traegt im Kunden-Scope ZWEI restriktive Decken und KEINE permissive Policy — `p_kunde_ceiling` (0009: `sichtbar_fuer_kunde and geloescht_am is null`) und `p_kunde_dokument_zuordnung` (0297: `kunde_id is not null and kunde_id = any(app.aktuelle_kunden())`). Restriktive Policies schneiden weg und gewaehren nie; `t_mandant` greift nicht, weil `app.aktiver_mandant()` im Kunden-Scope NULL ist (K-20). Gemessen gegen eine echte Kundensitzung mit einem freigegebenen, zugeordneten, nicht geloeschten Dokument: `select count(*) from dokument` = 0. Faellt O-671 positiv aus, genuegt eine permissive `t_kunde` mit genau dem Praedikat der beiden Decken plus `app.scope() = 'kunde' and mandant_id = any(app.sichtbare_mandanten())` — Dienst und Seiten brauchen dann keine Zeile Aenderung.

2. `dokument_zugriff` ist aus dem Kunden-Scope NICHT beschreibbar: `t_dokument_zugriff_anlegen` (0139) verlangt `mandant_id = app.aktiver_mandant()` (im Kunden-Scope NULL), und der Scope ist `app.ist_readonly()`. DOC-03/SEC-A6 verlangen aber eine Zeile VOR jeder signierten Adresse. Ohne einen `security definer` (Bauart wie 0266/0325) liefert ein kuenftiger Kundenabruf Dateien aus, die niemand vermerkt hat. In der Isolationssuite als Fall (21) festgehalten.

## src/server/registry/navigation.ts — ERLEDIGT (18.09.2026)

Eingetragen heisst gelöscht. `angebote`, `objekte` und `dokumente` stehen in
`KUNDEN_NAVIGATION`, in der vorgeschlagenen Reihenfolge (uebersicht · auftraege ·
angebote · objekte · projekte · rechnungen · zahlungen · nachweise ·
reklamationen · dokumente · nachrichten), ohne `zusatzRecht`. Gegengeprüft:
routen.generiert.ts Z. 435/441/443 führen je GENAU EIN Leserecht
(`angebot.lesen`, `objekt.lesen`, `dokument.lesen`), alle drei stehen im
Rechtekatalog, und die sechs Seiten liegen unter
`src/app/portal/kunde/{angebote,objekte,dokumente}/`. Der überholte Absatz im
Kopfkommentar ist ersetzt; dass `dokumente` bis O-671 leer bleibt, steht jetzt
am Eintrag selbst.

Der Zahlenhinweis für `src/server/registry/tableiste.ts` (Kommentar am Eintrag
`kunde`) ist ebenfalls eingetragen: zehn Listen, 19 Adressen, sechs davon aus
keiner Leiste erreichbar. Die Leiste selbst bleibt unverändert bei fünf Zielen
ohne `Mehr`. Hier ist nichts mehr offen.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-840 | **Sieht ein Kundenzugang die Auftragssumme (`auftrag.auftragswert_netto_cent`) im Portal?** Sie steht im unterschriebenen Vertrag, ist also keine Neuigkeit — im Portal ist sie aber eine gepflegte Zahl neben den Rechnungen, und bei einem Rahmenvertrag mit Abrufen bedeutet sie etwas anderes als die Summe der Belege. Bis zur Antwort steht sie in KEINER Abfrage von `services/kundenportal/auftrag.ts`; die Auftragsseite nennt stattdessen die vereinbarten Leistungszeilen mit ihren Preisen (das IST der Vertragsinhalt, Position fuer Position) und verweist fuer das Berechnete auf „Rechnungen“. Dieselbe Zurueckhaltung wie bei `projekt.auftragssumme_netto_cent`, die `tests/kern/kundenportal.test.ts` namentlich fernhaelt. | `services/kundenportal/auftrag.ts`, `/portal/kunde/auftraege`, `/portal/kunde/auftraege/[id]`, `drizzle/0025`, OPS-05, CRM-06, 04-SEITENKARTE §8 |

| O-842 | **Gilt ein versendetes Angebot nach Ablauf von `gueltig_bis` automatisch als `abgelaufen` — und wer stellt das fest, ein naechtlicher Lauf oder die Sachbearbeitung?** `angebot_status` fuehrt den Wert seit 0024, und es gibt heute keinen Lauf, der ihn setzt (in `src/server/jobs/` nachgesehen, nicht vermutet). Bis zur Antwort leitet das Kundenportal aus dem Datum KEINEN Zustand ab: es zeigt den gespeicherten `status` und daneben einen rein tatsaechlichen Satz („noch 12 Tage“ / „heute letzter Tag“ / „seit 3 Tagen abgelaufen“), dessen Tageszahl die Datenbank gegen `app.berlin_heute()` rechnet (K-11). Eine Ableitung in der Seite hiesse, dass im Portal ein anderer Zustand stuende als in der Datenbank. | `services/kundenportal/angebot.ts` (`bindefristText`), `/portal/kunde/angebote`, `/portal/kunde/angebote/[id]`, `drizzle/0024`, OPS-08, K-11 |

| O-843 | **Wenn O-671 positiv beantwortet wird: wie wird ein KUNDENabruf einer Datei vermerkt?** DOC-03 und SEC-A6 verlangen, dass jede Datei nur ueber eine signierte Adresse herausgeht (`SIGNATUR_SEKUNDEN` = 15 Minuten) und dass der Abruf VOR der Adresse eine Zeile in `dokument_zugriff` hinterlaesst — Art. 15 DSGVO haengt daran. Aus dem Kunden-Scope geht das heute nicht: `t_dokument_zugriff_anlegen` (`drizzle/0139`) verlangt `mandant_id = app.aktiver_mandant()`, und der ist dort NULL (K-20); ausserdem ist der Scope `app.ist_readonly()` (gemessen, `tests/isolation/kundenportal-stapel.test.ts` Fall 21). Der Weg dafuer ist ein `security definer` wie in `drizzle/0266`/`0325`, NICHT eine gelockerte Policy — und er gehoert in DIESELBE Migration wie die Antwort auf O-671, sonst liefert das Portal Dateien aus, die niemand vermerkt hat. Bis dahin baut das Kundenportal keinen Abrufweg. | `drizzle/0139`, `drizzle/0009`, `drizzle/0297`, `services/kundenportal/dokument.ts`, `/portal/kunde/dokumente/[id]`, DOC-03, DOC-04, SEC-A6, O-671, O-736 |

| O-844 | **Bekommt das versendete Angebot einen Schnappschuss wie die Rechnung (`rechnung_snapshot`, K-12)?** Ohne ihn gibt es im Kundenportal keinen Abzug, der nachweislich derselbe ist wie der versendete: das interne Angebots-PDF (`/portal/[mandant]/angebote/[id]/pdf`) entsteht aus den HEUTIGEN Stammdaten, zwei Abzuege desselben Angebots koennen sich also unterscheiden — bei einem Dokument, das ein Vertragsangebot IST, ist das kein Schoenheitsfehler. Bis zur Antwort bietet `/portal/kunde/angebote/[id]` keinen Dateiverweis an und sagt, warum; die Angaben selbst (Kopf, Texte, Positionen, Steuerzeilen je Satzgruppe, Summen) stehen vollstaendig auf dem Blatt. | `services/kundenportal/angebot.ts`, `/portal/kunde/angebote/[id]`, `drizzle/0024`, `services/finanz/xrechnung/*`, K-12, OPS-08, FIN-11 |


## Befunde

- BLOCKIEREND fuer den Nutzen der Dokumentenseite (nicht fuer den Bau): `dokument` hat im Kunden-Scope keine permissive Policy — `select count(*) from dokument` liefert 0, obwohl die Zeile freigegeben, zugeordnet und nicht geloescht ist (mit interner Gegenprobe gemessen). Das ist O-671 und wurde bewusst NICHT nebenbei entschieden. Seite, Blatt, Projektion, Filter und Leerzustand sind vollstaendig gebaut; der Grund steht als Offen(O-671) sichtbar ueber der Liste, und der Leertext sagt ausdruecklich „nicht, weil keine Unterlagen vorliegen“ (K-18).
- NEU GEMESSEN: `dokument_zugriff` ist aus dem Kunden-Scope nicht beschreibbar (`t_dokument_zugriff_anlegen` verlangt einen aktiven Mandanten, K-20; Scope ist readonly). Ohne einen definer waere ein kuenftiger Kundenabruf eine Dateiauslieferung ohne Spur — das faellt sonst erst am Tag nach der Antwort auf O-671 auf. Als O-843 aufgeschrieben und als Isolationsfall (21) festgehalten.
- `angebot.status = 'abgelaufen'` wird von keinem Lauf gesetzt (kein Job in `src/server/jobs/`). Die Seite leitet deshalb keinen Zustand aus `gueltig_bis` ab — O-842.
- `belagsart` und `reinigungsklasse` liefern im Kunden-Scope 0 Zeilen (restriktive Decke, kein `t_kunde`, 0021). Ein `left join` im Raumbuch haette fuer JEDEN Raum „—“ ergeben und sich wie „nicht erfasst“ gelesen — die Spalten fehlen deshalb ganz. Gemessen, nicht vermutet; als Isolationsfall (14) und als verbotene Tabelle im kern-Test festgehalten.
- `objekt.kunde_id` ist nullbar: ein Veranstaltungsort ohne Kundenstamm faellt durch `= any(...)` heraus. Das sieht man einer Policy nicht an (`NULL = any(array)` ist `unknown`), deshalb steht der Fall als eigene Fixtur und Isolationsfall (12) da.
- Ein Auftrag aus einem NICHT versendeten Angebot: `auftrag.angebot_id` zeigt dann auf eine Zeile, die im Kunden-Scope unsichtbar ist. Mit `join` statt `left join` waere der eigene laufende Vertrag ganz aus der Liste gefallen — im Dienst als `left join` gebaut und begruendet.
- OFFENE ZENTRALE PFLEGE: `tests/kern/portal-shell.test.ts` bleibt rot, bis `src/server/registry/dienste.ts` die vier Zeilen bekommt (siehe registry_dienste). Der Guard `todo-client-nicht-im-register` meldet die vier neuen O-Nummern, bis `docs/DECISIONS.md` die Zeilen aus `decisions_zeilen` traegt.
- FREMDER BEFUND (nicht dieser Stapel): `tests/kern/routen.test.ts` faellt an `api/mein/nachrichten/[id]`, und `portal-shell.test.ts` meldet zusaetzlich `mitarbeiter/posteingang` und `mitarbeiter/nachricht` — beides vom parallel laufenden Mitarbeiterportal-Agenten.

## NICHT gebaut

- Kein Abrufweg fuer Kundendokumente (kein /api/kunde/dokumente/[id]/url). Zwei gemessene Gruende: (a) `dokument` liefert im Kunden-Scope null Zeilen, jede Kennung waere 404; (b) die von DOC-03/SEC-A6 verlangte Abrufspur ist aus dem Kunden-Scope NICHT schreibbar — `t_dokument_zugriff_anlegen` (0139) verlangt `mandant_id = app.aktiver_mandant()`, im Kunden-Scope NULL (K-20), und der Scope ist readonly. Ein Abruf ohne Spur waere unzulaessig, einer mit 404 wirkungslos. Sichtbar als Offen(O-671) auf Liste und Blatt, technische Haelfte als O-843.
- Keine permissive `t_kunde` auf `dokument`. Das IST O-671 (woertlich: „bekommt `dokument` eine eng gefasste permissive `t_kunde` auf `sichtbar_fuer_kunde`?“) und eine Entscheidung ueber Offenlegung, nicht ueber Policies — bewusst NICHT nebenbei getroffen (CLAUDE.md: never silently pick a plausible value for a legal rule; der Fehler ginge in die teure Richtung).
- Kein Annahme-/Ablehnungsweg fuer Angebote (O-74) — sichtbarer Platzhalter statt ausgegrautem Knopf, auf Liste UND Blatt.
- Kein Angebots-PDF im Kundenportal (O-844): das interne PDF entsteht aus den HEUTIGEN Stammdaten, nicht aus einem Schnappschuss wie K-12 ihn fuer die Rechnung verlangt — zwei Abzuege desselben Vertragsangebots koennten sich unterscheiden.
- Keine Auftragssumme auf der Auftragsseite (O-840) — dieselbe Zurueckhaltung wie bei `projekt.auftragssumme_netto_cent`.
- Keine Bautagebuch-, Nachtrags-, Dienstplan-, Zeiteintrags- oder Kalkulationsabschnitte auf der Auftragsseite (O-78, O-674, §8) und keine Belagsart/Reinigungsklasse im Raumbuch (0021) — Abfragen werden gar nicht erst gestellt, damit keine leere Liste eine Tatsache behauptet.

## Notizen

Alle acht Routen sind gebaut; die Auffangroute `src/app/portal/kunde/[...rest]/page.tsx` bleibt fuer den Rest stehen (ein Tippfehler in der Adresszeile soll „wird noch gebaut" sehen und keinen Serverfehler).

GEMESSEN STATT ANGENOMMEN. Eigene Datenbank `w_kupo2` frisch migriert, echte Kundensitzung (scope=kunde, mandant_id leer, portal=kunde, readonly) und alle vier Dienste durch den echten Code gefahren: Auftrag 1 von 1, fremder 0; Angebot versendet 1, Entwurf 0; Objekt eigen 1, fremd 0, ohne Kunde 0; Raumbuch 1; `dokument` 0; `belagsart`/`reinigungsklasse` 0. Danach dasselbe in der Isolationssuite gegen `iso_kupo2` mit FORCE RLS — 30 Faelle, alle gruen, zusammen mit der bestehenden `tests/isolation/kundenportal.test.ts` 60 gruen.

KEINE MIGRATION. 0355–0359 bleiben frei: es fehlte keine Policy. Die eine Luecke (`dokument`) ist die offene Entscheidung O-671, und eine Migration, die sie nebenbei schliesst, waere genau der Fehler, den CLAUDE.md verbietet — und er ginge in die Richtung Offenlegung, nicht in die Richtung „eine Seite bleibt leer". Ist O-671 beantwortet, genuegt EINE Migration (permissive `t_kunde` + definer fuer die Abrufspur, O-843): Dienst, Liste und Blatt liefern dann Zeilen, ohne dass eine Zeile Code geaendert wird — `DOKUMENTE_ERREICHBAR` ist die einzige Stelle, die umspringt.

STRENG LESEND, GEPRUEFT. Sechs Schreibversuche aus dem Kunden-Scope (Auftrag anlegen und aendern, Objekt, Raum, Angebot annehmen, Leistungszeile) treffen null Zeilen, und der Zustand ist danach unveraendert. Dieselbe Anmeldung im Mitarbeiterportal sieht von allen sieben Tabellen nichts (K-04).

WAS DER KUNDE NIE SIEHT — nicht durch RLS, sondern durch die Projektion (RLS wirkt zeilen-, nicht spaltenweise): keine fremde Kundennummer, kein Entwurf (bei Angebot UND Rechnung strukturell, in beiden Policies), kein interner Vermerk (`entscheidung_notiz`, `objekt.bemerkung`, `ausstattung_hinweis`), kein Zutrittshinweis, keine Koordinaten, kein Name aus dem Haus (`verantwortlich_benutzer_id`, `versendet_von`, `freigegeben_von`, `erstellt_von`), keine Besetzung (`personalbedarf_anzahl`, `wochenstunden_soll`), keine Kalkulation und keine Marge (`kalkulation`, `belagsart`, `reinigungsklasse`, `leistungswert_qm_pro_stunde`), kein Ablageort und keine Aufbewahrungsfrist. Zwei Isolationsfaelle pruefen das am ERGEBNIS (JSON enthaelt weder „INTERN" noch „4711" noch die Auftragssumme), dreizehn Spaltennamen zusaetzlich am Quelltext.

ES WIRD AUF KEINER SEITE GERECHNET. `gesamtpreis_cent` ist in beiden Faellen eine erzeugte Spalte der Datenbank, `netto_cent` pflegt ein Ausloeser, die Umsatzsteuer steht je Steuersatzgruppe in `angebot_steuer` (beim Versand geschrieben, danach unveraenderlich), die Bruttosumme und die Flaechensumme entstehen in Postgres in `bigint` bzw. `numeric`. Geld laeuft als Ganzzahltext, Mengen als `numeric`-Text (R-15, K-16); die einzige Umrechnung in der Oberflaeche (Signaturfrist in Minuten) ist in den Dienst gewandert und wird dort geprueft.

UNBEDINGT MITNEHMEN: die vier Registerzeilen in `dienste.ts` und die vier DECISIONS-Zeilen — ohne sie bleiben `portal-shell.test.ts` und der Guard `todo-client-nicht-im-register` rot. Die drei Navigationszeilen sind kein Testblocker, aber ohne sie sind Angebote, Objekte und Dokumente nur ueber die Sprungkarten der Uebersicht erreichbar (die in diesem Stapel dafuer von sechs auf zehn erweitert wurden).
