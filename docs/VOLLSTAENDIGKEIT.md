# Vollständigkeitsregister — was die Plattform *nicht* kann

**Aufgenommen am 21.09.2026.** Grundlage: ein achtfacher Suchlauf über den
gesamten Baum (Arbeiterportal · Zeitkette · Erreichbarkeit · Dienste ohne
Knopf · Routen ohne Aufrufer · Platzhalter · Zustände ohne Erzeuger ·
Verwaltungslücken), jeder Befund anschließend gegengeprüft: *Gibt es eine
dokumentierte Begründung für das Fehlen?* Sechs Befunde wurden so **widerlegt**
und stehen deshalb nicht in der Liste — sie sind bewusste, begründete
Auslassungen (§ 9).

**136 bestätigte Befunde** aus dem Suchlauf: 75 *blockiert* · 59 *behindert* · 2 *Schönheit*. Dazu **fünf nachgetragene** (§ 8a), die beim Bauen auffielen.

Ein Befund ist keine Meinung. Jeder trägt Datei und Zeile, und jeder wurde mit
einer Gegenprobe belegt — meist ein `grep`, der zeigt, dass der gesuchte
Schreibweg **nirgends** existiert.

## Was die drei Schweregrade bedeuten

| Grad | Bedeutung |
|---|---|
| **blockiert** | Ein Vorgang, den der Betrieb braucht, ist **gar nicht** ausführbar. Kein Umweg. |
| **behindert** | Es geht, aber nur über einen Umweg, den niemand von selbst findet (Adresszeile, Seed, `psql`). |
| **Schönheit** | Gebaut, korrekt, ungenutzt. Kein Betriebsschaden. |

## Wie dieses Blatt geführt wird

Jede Zeile hat eine Nummer `V-NNN`. Die Nummer wird **nie wiederverwendet**.
Ist ein Befund behoben, wird die Zeile **nicht gelöscht**, sondern auf
`erledigt` gesetzt, mit dem Commit daneben. Ein Register, aus dem man Zeilen
entfernt, ist nach drei Wochen eine Liste der Dinge, an die sich jemand
erinnert hat.

---

## 1. Was sich nicht anlegen lässt

Der schwerste Block. Diese Zeilen entstehen **ausschließlich im Seed** — d. h.
die Plattform kann heute nur das verwalten, was die Demo-Daten ihr
mitgegeben haben. Ein echter Betrieb kann nicht anfangen.

| Nr | Was | Beleg | Grad | Stand |
|---|---|---|---|---|
| V-001 | **Objekt** (Gebäude/Gelände) | `src/app/portal/[mandant]/objekte/neu/page.tsx:21` ist ein ausdrücklicher Platzhalter; `insert into objekt` nur in `src/server/db/seed/operations.ts:459` | blockiert | **erledigt** — D-619, `services/objekt/anlegen.ts`, `api/objekt`, Knopf auf der Liste |
| V-002 | **Revier** (Reinigungsfläche) | `src/app/portal/[mandant]/reinigung/reviere/neu/page.tsx:25` Platzhalter; `src/server/services/reinigung/revier.ts:42` nennt „anlegen" und „archivieren" als Lösung — beide gibt es nicht | blockiert | **erledigt** — `legeRevierAn` / `aendereRevier` / `archiviereRevier`, `api/reinigung/reviere`, zweisprachige Seite und Knopf auf der Liste; 18 Prüfungen in `tests/isolation/revier-anlegen.test.ts` |
| V-003 | **Bauprojekt** | `src/server/db/seed/bau.ts:564`; `src/app/api/auftrag/route.ts:126` kennt keinen Anlegezweig — zwanzig gebaute Projektseiten sind für neue Vorhaben unerreichbar | blockiert | **erledigt** — `services/bau/projekt.ts`, `api/bau/projekte`, zweisprachige Seite und Knopf; Nummer und Kunde kommen aus dem AUFTRAG (O-351), die Vertragsgrundlage hat bewusst keinen Vorgabewert; 15 Prüfungen in `tests/isolation/projekt-anlegen.test.ts` |
| V-004 | **Veranstaltung** (Security) | `src/server/db/seed/security.ts:356` — der dritte Einsatz-Ursprung ist tot | blockiert | **erledigt** — `services/security/veranstaltung-anlegen.ts`, `api/security/veranstaltungen`, zweisprachige Seite und Knopf; Ort als Objekt ODER Text, Zeiten als Berliner Wanduhrzeit über `at time zone` (Invariante 2); 18 Prüfungen in `tests/isolation/veranstaltung-anlegen.test.ts` |
| V-005 | **Angebot für Security und Bau** | `src/app/api/angebot/route.ts:39` — der einzige Entstehungsweg ist die Reinigungs-Kalkulation aus dem Raumbuch | blockiert | offen |
| V-006 | **Lieferant** | `src/app/portal/[mandant]/finanzen/eingangsrechnungen/neu/page.tsx:271` hat ein Pflichtfeld „Lieferant", dessen Tabelle niemand befüllen kann | blockiert | offen |
| V-007 | **Bankkonto** | `src/server/services/finanz/zahlung/index.ts:103` — „Eingegangen auf" kennt nur Seed-Konten | blockiert | offen |
| V-008 | **Stundenkonto** | `src/server/services/zeit/stundenkonto.ts:313` — `eroeffneKonto` hat weder Route noch Knopf; der angekündigte Rollover-Lauf ist nicht registriert | blockiert | **erledigt** — der Lauf `konten_rollover` (`jobs/kontenRollover.ts`, täglich 00:30) öffnet je aktiver Anstellung das Konto des laufenden BERLINER Monats und setzt den Vortrag aus einem gesperrten Vormonat; `schliesseMonatAb` trägt den Saldo beim Sperren selbst weiter (`uebertrageSaldo`, mit Jahreswechsel). Ein gesperrter Folgemonat bleibt unberührt. Keine Sollzeit erfunden (O-18). 12 Prüfungen in `tests/isolation/konten-rollover.test.ts` |
| V-009 | **Urlaubskonto und Urlaubsanspruch** | `src/server/services/zeit/urlaubskonto.ts:236` — beide Schreibfunktionen ohne Aufrufer | blockiert | offen |
| V-010 | **Qualifikationsnachweis** (Sachkunde § 34a, Führungszeugnis, Erste Hilfe) | `drizzle/0030_nachweis_qualifikation.sql:590`, `src/server/db/seed/qualifikation.ts:268` — das Register kann warnen, nie aufnehmen | blockiert | offen |
| V-011 | **Betriebsausgabe** (FIN-14/FIN-17) | `drizzle/0180_ausgabe.sql:646`, `src/server/services/finanz/ausgabe.ts:33` — reine Leseansicht: weder erfassen noch freigeben, buchen, ablehnen | blockiert | offen |
| V-012 | **Einzelner Raum** | `src/server/services/raumbuch/raum.ts:277` — `speichereRaum` ändert nur Vorhandenes; der einzige Weg ist ein CSV-Import | behindert | offen |
| V-013 | **Einzelne Schicht** | `src/server/services/dienstplan/generator.ts:230` — ein Einsatz entsteht nur aus Serie oder Veranstaltung | blockiert | offen |
| V-014 | **Telefonanmeldung einer Arbeiterin** (`mitarbeiter_zugang`) | `drizzle/0113_mitarbeiter_zugang.sql:193` — weder anlegen noch sperren noch entsperren | blockiert | offen |
| V-015 | **Agentenbudget** | `src/app/portal/[mandant]/agenten/budget/page.tsx:97` rein lesend — ohne Budget läuft kein Agent | blockiert | offen |
| V-016 | **Radar-Suchprofil** | `src/server/services/radar/profil.ts:488` — nur ändern, nicht anlegen | behindert | offen |

---

## 2. Was sich nicht mehr ändern lässt

Angelegt und danach in Stein. Kein Tippfehler ist korrigierbar.

| Nr | Was | Beleg | Grad | Stand |
|---|---|---|---|---|
| V-017 | **Kundenstammdaten** | `src/server/services/crm/anlegen.ts:77` — kein schreibender Änderungsdienst | blockiert | **erledigt** — `services/crm/aendern.ts`, `api/crm/kunde` (`aktion=kunde_aendern`) |
| V-018 | **Kunde archivieren** | `drizzle/0020_crm_identitaet.sql:176` — Spalte da, nichts schreibt sie | behindert | **erledigt** — `archiviereKunde`, weist bei laufenden Aufträgen ab |
| V-019 | **Ansprechpartner korrigieren / als ausgeschieden markieren** | `drizzle/0020_crm_identitaet.sql:261` — nur die Rechtsgrundlage ist änderbar | behindert | **erledigt** — `aendereKontakt` + `scheideKontaktAus` |
| V-020 | **Objekt bearbeiten oder archivieren** | `src/app/portal/[mandant]/objekte/[id]/page.tsx:148` zeigt „Archiviert" an — nichts kann den Zustand erzeugen | blockiert | **erledigt** — D-619/D-620, `objekte/[id]/bearbeiten` |
| V-021 | **Planungsserie ändern, beenden, archivieren** | `src/server/services/dienstplan/serie.ts:226` | blockiert | offen |
| V-022 | **Verwaltungskonto entziehen oder deaktivieren** | `src/app/portal/[mandant]/einstellungen/benutzer/[id]/page.tsx:32` — einladen ja, zurücknehmen nie | blockiert | **erledigt** — `app.konto_deaktivieren` und `app.konto_reaktivieren` (`drizzle/0379`), auf dem Benutzerblatt als „Zugang entziehen" und „Zugang wiedergeben". **Kein Löschen** (Invariante 8): `audit_log` benennt dieses Konto als Handelnden, dauerhaft. Der Rückweg geht auf `aktiv` und nicht auf `eingeladen` — die Anmeldung besteht, entzogen war nur der Zugang. Das eigene Konto ist ausgenommen: wer sich selbst entzieht, sperrt sich in derselben Sekunde aus |
| V-023 | **Rollen und Rechte pflegen** | `src/app/portal/[mandant]/einstellungen/rollen/[rolle]/page.tsx:135` zeigt „Abweichung dieser Gesellschaft" — keine Oberfläche erzeugt sie | behindert | offen |
| V-024 | **Abrechnungskonfiguration beenden** | `src/app/api/abrechnung/route.ts:161` — `aktion=beenden` existiert in der Route, in keinem Formular | behindert | offen |
| V-025 | **Abwesenheit durch die Verwaltung erfassen** („die Krankmeldung am Telefon um 05:40") | `src/server/services/abwesenheit/index.ts:220` — die Dienstfunktion hängt an der Mitarbeiterroute | blockiert | **erledigt** — `/portal/[mandant]/personal/abwesenheiten/erfassen` und `POST /api/personal/abwesenheit`. **Weder Recht noch Policy fehlten:** `t_mandant_schreiben` auf `abwesenheit` (`0073`) verlangt `zeit.abwesenheit_melden`, und `admin` wie `leitung` halten es seit je — gefehlt hat der Weg. Der Satz „die Krankmeldung am Telefon um 05:40" stand wörtlich im Kopf der Dienstfunktion, die genau einen Aufrufer hatte: die Route der Arbeiterin. Wer um 05:40 anruft, hat kein Telefon in der Hand, mit dem er sich meldet. Die Zeile entsteht als `erfasst` (zur Kenntnis genommen, nicht genehmigt) und trägt in `erstellt_von` den Menschen aus dem Büro. Die Anstellung prüft die Route NICHT: `ab_anstellung_fk (mandant_id, anstellung_id)` lässt keine fremde Gesellschaft zu. **Nebenbefund, im selben Zug behoben:** alle sieben Abwesenheitsarten tragen `bezahlt = null` (O-139), und `pruefeArt` weist sie deshalb ab — ohne Vorwarnung erst beim Absenden. Die Liste zeigt sie jetzt nicht wählbar mit dem Grund daneben, statt die Aufnehmende das Formular umsonst ausfüllen zu lassen. Offen bleibt O-893 (Urlaubsantrag im Namen einer Arbeiterin). 5 Prüfungen in `tests/isolation/abwesenheit-aufnehmen.test.ts` |
| V-026 | **Dokument nach Ablauf der Aufbewahrungsfrist löschen** | `src/server/services/dokument/loeschung.ts:54` — das Recht `dokument.archivieren` prüft keine Seite | behindert | offen |
| V-027 | **DATEV-Stapel als übergeben vermerken oder verwerfen** | `drizzle/0133_datev_export.sql:39` — Trigger, Constraint und Anzeige sind gebaut | behindert | offen |

---

## 3. Gebaut, aber ohne Weg hin

Diese Seiten und Masken **existieren und funktionieren**. Sie stehen nur in
keiner Leiste und auf keiner anderen Seite. Wer die Adresse nicht auswendig
kennt, findet sie nie. Das ist die teuerste Sorte Lücke: bezahlt, gebaut,
unbenutzt.

| Nr | Was | Beleg | Grad | Stand |
|---|---|---|---|---|
| V-028 | **Ausschreibungsradar — acht Seiten** | `src/server/registry/navigation.ts:488` | blockiert | **erledigt** — Sidebar-Punkt `radar`, Gruppe „aussen" |
| V-029 | **Berichtsmodul — Index plus REP-01…REP-06** | `src/app/portal/[mandant]/berichte/page.tsx:37` | blockiert | **erledigt** — Sidebar-Punkt `berichte` |
| V-030 | **Datenschutz-Posteingang** | `src/server/registry/navigation.ts:72` — in keiner Navigation und keiner Sprungkarte | blockiert | **erledigt** — Sidebar-Punkt `datenschutz`, am Recht des Posteingangs |
| V-031 | **Eine Betroffenenanfrage liess sich nur durch das öffentliche Formular erzeugen** — und die Befundzeile dieses Eintrags war falsch | Ursprünglich notiert als „`datenschutz/page.tsx:116` — kein Auslöser" für Art. 15/16/17. **Nachgemessen stimmt das nicht:** die drei Unterseiten gibt es (`datenschutz/[id]/auskunft`, `…/berichtigung`, `…/loeschung`), sie tragen fertige Formulare gegen `/api/datenschutz/berichtigung` und `…/loeschung`, und `Vorgangskopf.tsx:201` verweist auf alle drei, gefiltert nach Recht. Der echte Befund liegt eine Stufe davor: `betroffenenanfrage` hatte **genau einen Erzeuger**, `/api/datenschutz/anfrage`, und dessen INSERT-Policy verlangt `formular.schreiben` — das Recht des Eingangsprinzipals. Wer im Büro `datenschutz.auskunft_erstellen` hält, konnte lesen, entscheiden, verlängern, zuordnen und **keine Zeile anlegen**. Art. 12 Abs. 1 DSGVO kennt diese Beschränkung nicht: der Antrag geht „schriftlich oder in anderer Form", der mündliche ausdrücklich eingeschlossen. Ein Brief löste dieselbe Monatsfrist aus wie das Formular und hatte in der Plattform, die diese Frist überwacht, keinen Platz | blockiert | **erledigt** — `/portal/[mandant]/datenschutz/aufnehmen` mit `nimmAnfrageAuf`, Policy `t_betroffenenanfrage_aufnahme` und den Spalten `eingangsweg`/`erfasst_von` (`drizzle/0378`). **Der Eingangszeitpunkt ist eine Angabe, nicht die Uhr des Erfassers:** der Brief vom Ersten, am Zwanzigsten erfasst, hat noch zehn Tage — nicht noch einen Monat. Nach vorn geht es nicht, denn nur diese Richtung verschaffte eine Frist, die niemand gewährt hat; `kern.betroffenenanfrage_frist()` weist sie ab. Die beiden Wege trennt nicht die Policy, sondern der CHECK: `admin` und `leitung` halten `formular.schreiben` ohnehin, und erlaubende Policies werden verodert — was unbedingt gilt, ist die PAARUNG von Weg und Aufnehmendem. Damit ist an jeder Zeile ablesbar, ob ihre Frist gemessen oder protokolliert wurde. 12 Prüfungen in `tests/isolation/anfrage-aufnehmen.test.ts`; offen bleibt O-892 (Anfrage ohne E-Mail-Adresse) |
| V-032 | **Gemeldete Barrieren (BFSG-Meldeweg)** | `src/app/portal/[mandant]/datenschutz/barrieren/page.tsx:15` — das öffentliche Formular schreibt hinein, niemand liest | blockiert | **erledigt** — Verweis auf dem Datenschutz-Posteingang, an `referenz.schreiben` (dem Tor der Liste). Beides ist derselbe Schreibtisch — und ein Meldeweg, an dessen anderem Ende niemand sitzt, ist nach BFSG keiner |
| V-033 | **Ausgabe der Check-in-Marken** | `src/app/portal/[mandant]/zeiten/checkin-links/page.tsx:259` | blockiert | **erledigt** — Sprungpunkt auf `/zeiten`, an `zeit.checkin_verwalten` (dem Recht des Ziels, AUT-06) |
| V-034 | **Nacherfassung** | `src/app/portal/[mandant]/zeiten/page.tsx:167` — und die Wächtermeldung zeigt auf `zeit/nacherfassung` statt `zeiten/nacherfassung` (`src/server/services/waechter/benachrichtigung.ts:50`) | blockiert | **erledigt** — Sprungpunkt an `zeit.nacherfassung_pruefen`; beide toten Meldungsziele berichtigt (siehe V-112) |
| V-035 | **Maske „Neuer Kunde"** | `src/app/portal/[mandant]/crm/kunden/page.tsx:114` — fertig, kein Knopf | blockiert | **erledigt** — Knopf und Leerzustand-Verweis, zweisprachig |
| V-036 | **Maske „Neuer Lead"** | `src/app/portal/[mandant]/crm/leads/page.tsx:127` — fertig, kein Knopf | blockiert | **erledigt** — Knopf und Leerzustand-Verweis, zweisprachig |
| V-037 | **Antwort an eine Bewerberin (Zusage/Absage, § 22 AGG)** | `src/app/portal/[mandant]/recruiting/bewerbungen/[id]/antwort/page.tsx:61` — kein eingehender Verweis | blockiert | **erledigt** — Verweis „Antwort schreiben“ auf dem Bewerbungsblatt. Das Register verlangt für die Seite BEIDE Rechte (`recruiting.bewerbung_bewerten` UND `recruiting.entscheiden`), der Verweis prüft deshalb beide |
| V-038 | **Eigene Kontoseite** | `src/app/portal/konto/[[...rest]]/page.tsx:139` — nur über die Arbeiter-Leiste am Telefon; die Kontowurzel führt drei **gebaute** Seiten unter „Noch nicht gebaut" | blockiert | **erledigt** — Die Kontowurzel führt jetzt ihre vier Seiten auf, statt zu behaupten, es gebe sie nicht. Drei davon waren seit ihren Phasen fertig — der Absatz „Noch nicht gebaut“ war der einzige Text an dieser Stelle und führte aktiv in die Irre |
| V-039 | **`/portal/konto/sicherheit`** (Kennwort, zweiter Faktor, aktive Sitzungen) | `src/server/registry/routen.generiert.ts:451` — existiert nicht, und kein Verweis führt auf die Ersatzseiten | blockiert | **erledigt** — `/portal/konto/sicherheit` gebaut: Verweise auf Kennwortwechsel, zweite Stufe und Wiederherstellungscodes (alle drei Seiten gab es, von nirgendwo erreichbar) — und die Liste der EIGENEN Anmeldungen, jede einzeln beendbar. `benutzer_sitzung` hatte dafür seit je zwei Policies für `cse_app`, die niemand benutzte. Die laufende Anmeldung trägt „diese hier“ und keinen Knopf: sie zu beenden liesse das Sitzungsplätzchen auf etwas zeigen, das es nicht mehr gibt. Vier Sprachen. 7 Prüfungen in `tests/isolation/eigene-sitzungen.test.ts` |
| V-040 | **Kalender und Kalender-Feed** | `src/server/registry/navigation.ts:505` — verweisen nur aufeinander | blockiert | **erledigt** — Sidebar-Punkt `kalender`, Gruppe „heute" |
| V-041 | **Buchhaltungs-Index** | `src/app/portal/[mandant]/buchhaltung/page.tsx:106` — geschlossene Insel | blockiert | **erledigt** — Sidebar-Punkt `buchhaltung` (Gruppe „Geld“, an `buchhaltung.lesen`). Er öffnet zwölf Unterseiten, von denen nur drei in der Leiste standen |
| V-042 | **Finanzen-Index** | `src/server/registry/tableiste.ts:81` — nur in der Telefon-Leiste, und dort nur für Rollen, die weder `admin` noch `leitung` sind | blockiert | **erledigt** — Sidebar-Punkt `finanzen` (Gruppe „Geld“, an `finanzen.lesen`). Er öffnet elf Unterseiten, von denen fünf in keiner Leiste standen |
| V-043 | **Navigationsbaum des Kundenportals** | `src/server/registry/navigation.ts:560` — vollständig gebaut, von keiner Komponente gerendert: sechs fertige Kundenbereiche in keiner Leiste | behindert | **erledigt** — Alle drei Stellen lesen jetzt den dritten Baum: Schiene (`PortalRahmen`), `Mehr`-Blatt (`TabLeiste`) und Rechtekarte (`zugang.ts`, samt `zusatzRecht` für die zwei Routen, die ZWEI Leserechte verlangen). Sechs fertige Kundenbereiche sind damit erreichbar. 7 Prüfungen in `tests/kern/kundenbaum.test.ts` |
| V-044 | **Neun von zehn Reitern der Objektübersicht** | `src/app/portal/[mandant]/objekte/[id]/page.tsx:183` — sechs der neun fehlenden Module sind längst gebaut | behindert | offen |
| V-045 | **Detailseite einer Veranstaltung** | `src/app/portal/[mandant]/security/veranstaltungen/page.tsx:94` — die Liste springt daran vorbei | behindert | **erledigt** — der Titel führt jetzt auf das Blatt (`security.lesen`, dasselbe Recht wie die Liste); die Besetzung bekam einen eigenen Verweis an ihrem eigenen Recht |
| V-046 | **Wissensquellen der Agenten** | `src/app/portal/[mandant]/agenten/wissen/page.tsx:54` | behindert | **erledigt** — Verweis „Woher das Wissen kommt“ auf der Agentenseite, an `agent.werkzeug_verbinden`. Dieselbe Nachbarschaft wie die Richtlinien: wer wissen will, was ein Agent antwortet, fragt als nächstes, woher er es hat |
| V-047 | **Knopf „Neues Angebot"** | `src/app/portal/[mandant]/angebote/page.tsx:104` — der einzige Weg führt über das Raumbuch eines Objekts | behindert | **erledigt** — Knopf „Neues Angebot“ auf der Liste, an `angebot.schreiben`. Der einzige Weg führte über das Raumbuch eines Objekts — richtig für die Reinigung, wo die Kalkulation aus Flächen entsteht, unbrauchbar für Sicherheit und Bau, wo es kein Raumbuch gibt |
| V-048 | **Die beiden Schaltstellen der Zeiterfassung** | `src/app/portal/[mandant]/zeiten/page.tsx:149` | behindert | **erledigt** — zusammen mit V-033 und V-034: beide Sprungpunkte stehen in der Leiste über der Wochenliste |

---

## 4. Arbeiterportal — was die Kraft am Telefon nicht kann

| Nr | Was | Beleg | Grad | Stand |
|---|---|---|---|---|
| V-049 | **Eine Schicht zusagen oder absagen.** Der Zustand `zugesagt` wird im ganzen Baum **von niemandem** geschrieben | `src/app/portal/mein/schichten/[zuordnungId]/page.tsx:100`; Gegenprobe: der einzige `UPDATE` auf `einsatz_zuordnung.status` ist `dienstplan/einteilung.ts:757` (`abgesagt`, durch das Büro) | blockiert | **erledigt** — D-622, `drizzle/0374`, `api/mein/schicht`, Baustein `Zusagefeld` in vier Sprachen |
| V-050 | **Folge von V-049:** die Besetzungswarnung zählt Zusagen (`waechter/benachrichtigung.ts:62`) und meldet darum für **jede** Schicht null; der Pillenzweig „Bereit" (`bausteine.tsx:155`) ist unerreichbar | siehe V-049 | blockiert | **erledigt** — geprueft an der ZAHL, nicht am Spaltenwert (`tests/isolation/schicht-zusage.test.ts` §5) |
| V-051 | **Die Entscheidung über den eigenen Einwand erreicht die Mitarbeiterin nirgends** — weder Begründung noch Meldung | `src/app/portal/mein/zeiten/[id]/einwand/page.tsx:181` | blockiert | **erledigt** — zwei Hälften: die Seite zeigt Zustand (vier Sprachen), Entscheidungsdatum und Begründung; und `entscheideEinwand` stellt eine Benachrichtigung zu (`drizzle/0377`, Art `zeit.einwand_entschieden`). `in_pruefung` und `zurueckgezogen` schweigen. 9 Prüfungen in `tests/isolation/einwand-entscheidung-meldung.test.ts` |
| V-052 | **Den eigenen Einwand zurückziehen.** Der Dienst erlaubt es ausdrücklich, es gibt keinen Weg dorthin | `src/server/services/zeit/einwand.ts:41`, `src/app/api/zeit/einwand/entscheidung/route.ts:39` | behindert | offen |
| V-053 | **Einen anderen Monat ansehen.** „Meine Zeiten" liest `?monat=`, kein Bedienelement erzeugt den Parameter | `src/app/portal/mein/zeiten/page.tsx:47` | blockiert | **erledigt** — ein `Monatswechsler` in `mein/bausteine.tsx` auf allen DREI Lesern (Zeiten, Stundenkonto, Monatsnachweis); beschriftet in vier Sprachen statt nackter Pfeile, 44 px, nicht in die leere Zukunft, gewählte Beschäftigung wandert mit. Sperrklinke: `tests/kern/monatswechsel.test.ts` |
| V-054 | **Ein anderes Jahr ansehen · Urlaub beantragen** | `src/app/portal/mein/urlaub/page.tsx:46` — liest `?jahr=` ohne Bedienelement, kein Weg zum Antrag | behindert | offen |
| V-055 | **Monatsnachweis:** keine Portalhülle, kein Monatswechsel, keine Wahl der Beschäftigung, „Drucken" als Wort ohne Knopf | `src/app/portal/mein/monatsnachweis/page.tsx:134` | behindert | offen |
| V-056 | **Eine gemeldete Abwesenheit korrigieren oder zurücknehmen** — die Zeilen sind nicht einmal anklickbar | `src/app/portal/mein/antraege/page.tsx:142` | blockiert | offen |
| V-057 | **Halbe Abwesenheitstage und der Vermerk „AU-Bescheinigung liegt vor"** — Regel, Spalten und Lohnexport sind gebaut, die Route liest vier Felder, kein Formular sendet sie | `src/app/portal/mein/abwesenheit/neu/page.tsx:97`, `src/app/api/mein/abwesenheit/route.ts:111` | blockiert | offen |
| V-058 | **Zwei Leistungsnachweise auf einem Objekt und Tag:** das Unterschriftsblatt verschwindet dauerhaft, das Anlegeformular kommt zurück | `src/app/portal/mein/schichten/[zuordnungId]/leistungsnachweis/page.tsx:101` | blockiert | offen |
| V-059 | **Eine vierte Positionszeile im Leistungsnachweis** — es gibt genau drei und keinen Knopf „Zeile hinzufügen" | `…/leistungsnachweis/page.tsx:130` | behindert | offen |
| V-060 | **Die Gerätezeit wird nie gefüllt** — das Wachbuch schickt ein leeres Feld, die Kenntnisnahme gar keines; die Abweichung steht immer auf „—" | `src/app/portal/mein/schichten/[zuordnungId]/wachbuch/page.tsx:266` | behindert | offen |
| V-061 | **Die Nachweisseite nennt die Sperre und keinen nächsten Schritt** — kein Einreichen, kein Ansprechpartner, kein Link | `src/app/portal/mein/nachweise/page.tsx:119` | behindert | offen |
| V-062 | **Rohe Datenbankwerte auf einem Bildschirm, der vier Sprachen können muss** — obwohl die Übersetzung daneben schon liegt | `src/app/portal/mein/antraege/[id]/page.tsx:81` | behindert | offen |
| V-063 | **Bautagebuch:** Tagesfotos werden aufgelistet, können vom Arbeiterportal aber nie entstehen; die eigene Mannstundenzeile lässt sich nicht stornieren | `src/app/portal/mein/schichten/[zuordnungId]/bautagebuch/page.tsx:414` | behindert | offen |

---

## 5. Zeitwirtschaft — die Verwaltungsseite

| Nr | Was | Beleg | Grad | Stand |
|---|---|---|---|---|
| V-064 | **Ein laufender Zeiteintrag lässt sich von der Verwaltung weder schließen noch stornieren noch korrigieren** | `src/server/services/zeit/korrektur.ts:160` | blockiert | **erledigt** — `services/zeit/laufender-eintrag.ts` (`schliessen` / `stornieren`), `POST /api/zeit/laufend`, Formular an jeder Karte auf `/zeiten/live` hinter `zeit.korrigieren`. Die gesetzte Zeit bleibt als GESETZT erkennbar (`nacherfasst`, `quelle_ende`, `behauptet_ende`), Begründung Pflicht. 11 Prüfungen in `tests/isolation/laufender-eintrag.test.ts` |
| V-065 | **Die Ausgleichsbuchung hat keinen einzigen Aufrufer** — ohne sie entsteht in einem gesperrten Monat **keine** Korrektur | `src/app/api/zeit/korrektur/route.ts:143`, `src/server/services/zeit/stundenkonto.ts:503` | blockiert | **erledigt** — `korrigiereZeiteintrag` bucht sie selbst, wenn der Eintrag gesperrt ist: Differenz aus `dauer_netto_minuten`, Ziel ist der erste OFFENE Monat, der gesperrte bleibt gesperrt. Offen bleibt der Fall ohne Minutendifferenz (O-891). 4 Prüfungen in `tests/isolation/korrektur-ausgleich.test.ts` |
| V-066 | **„Nacherfassen" ohne Offline-Anspruch ist unmöglich**, obwohl zwei Stellen der Plattform genau das verlangen | `src/server/services/zeit/offline.ts:291` | blockiert | **erledigt** — `services/zeit/nacherfassung.ts` — eine Arbeitszeit eintragen, zu der es KEIN Gerätereignis gibt. `POST /api/zeit/nacherfassung`, Formular auf `/zeiten/nacherfassung`. Vier Spalten halten fest, dass ein MENSCH die Zeit behauptet hat (`nacherfasst`, `quelle_*`, `behauptet_*`); EMP-07 gilt auch hier: niemand erfasst die eigene Zeit nach. 9 Prüfungen in `tests/isolation/nacherfassung-frei.test.ts` |
| V-067 | **Ein anerkannter Einwand der Art „Eintrag fehlt" führt ins Leere** — kein Verweis, keine Handlung | `src/app/portal/[mandant]/zeiten/einwaende/[id]/page.tsx:439` | blockiert | **erledigt** — Auf dem Einwandblatt steht jetzt bei `eintrag_fehlt` der Verweis „Zeit nacherfassen“ — mit der Person vorbelegt, die ZEITEN leer (§1.8: eine vorbelegte Behauptung wäre von einer Entscheidung nicht mehr zu unterscheiden). Der neue Eintrag wird in die Entscheidungsbegründung des Einwands geschrieben, damit die Meldung ihre Antwort trägt |
| V-068 | **Es gibt keinen Knopf, der eine Ausstempel-Marke ausgibt** — die Oberfläche kennt nur `zweck="checkin"` | `src/app/portal/[mandant]/zeiten/checkin-links/page.tsx:263` | blockiert | **erledigt** — zweiter Knopf mit `zweck="checkout"`, sichtbar erst nach dem EINLÖSEN der Einstempel-Marke: `app.checkin_verbrauchen` weist eine Ausstempel-Marke ohne offenen Eintrag ab, und ein Knopf, der einen Fehler erzeugt, ist schlechter als keiner |
| V-069 | **Die Meldung „Morgen unbesetzt" zeigt auf `/portal/<slug>/dienstplan` — diese Route gibt es nicht** | `src/server/services/waechter/benachrichtigung.ts:67` | blockiert | **erledigt** — Ziel ist jetzt `/dienstplan/tag`: von den vier Ansichten ist die Tagesansicht die Disposition, und dort wird nachbesetzt. Die Wochenansicht verlangte einen zweiten Klick an genau der Stelle, an der jemand um sechs Uhr schnell sein muss |
| V-070 | **Der Monatsabschluss nennt die Zahl der nicht freigegebenen Einträge und keinen Weg zu ihnen** | `src/app/portal/[mandant]/personal/stundenkonten/abschluss/page.tsx:201` | behindert | offen |
| V-071 | **Das Zeiteintragsblatt lädt Freigabe-, Abrechnungs- und Sperrzustand und zeigt keinen davon** | `src/app/portal/[mandant]/zeiten/[id]/page.tsx:221` | behindert | offen |
| V-072 | **Die Kachel „Aktuell im Einsatz" (DSH-05) fehlt**; ihr fertiger Dienst hat keinen Aufrufer | `src/server/services/zeit/live.ts:33` | Schönheit | offen |
| V-073 | **Der nächtliche Abgleich des Stundenkontos gegen sein Journal ist gebaut und läuft nie** | `src/server/services/zeit/stundenkonto.ts:686` | Schönheit | offen |

---

## 6. Zustände, die niemand erzeugt

Ein Zustandswert, den kein Code schreibt, ist ein Versprechen an die
Oberfläche, das nie eingelöst wird. Filter darauf liefern immer leer; Pillen
dafür erscheinen nie.

| Nr | Zustand | Beleg | Grad | Stand |
|---|---|---|---|---|
| V-074 | `benutzer.status = 'gesperrt'` ist eine **Einbahnstraße** — die Brute-Force-Sperre setzt sie, nichts setzt sie zurück | `drizzle/0007_benutzer_auth.sql:414` | blockiert | **erledigt** — `app.konto_entsperren` (`drizzle/0379`). **Und die Entsperrung musste auch WIRKEN:** die Sperrdauer (30 Min) ist länger als das Zählfenster (15 Min), also fand der nächste Fehlversuch die zehn alten Zeilen noch im Fenster und sperrte sofort wieder — ein Knopf, der manchmal still nichts tut. `benutzer.entsperrt_am` setzt jetzt den Beginn des Fensters. Die Versuchszeilen bleiben stehen (Invariante 8): sie sind die Spur, an der ein Angriff abgelesen wird. Die IP-Schwelle bleibt am vollen Fenster — eine Entsperrung gilt einem KONTO, nicht einer Adresse, hinter der gerade fünfzig andere durchprobiert werden |
| V-075 | `benutzer.status = 'deaktiviert'` hat keinen Erzeuger; der Zugangsentzug für interne Konten hat eine Policy ohne Aufrufer | `drizzle/0102_benutzer_mandant_entzug.sql:41` | blockiert | **erledigt** — mit V-022 in derselben Änderung. Der Entzug beendet die offenen Anmeldungen mit: `app.sitzung_aufloesen` verlangt ohnehin `status = 'aktiv'`, aber eine Liste, die „läuft bis …" zeigt, behauptete einen Zugang, den es nicht mehr gibt |
| V-076 | Das Recht `system.sitzung_widerrufen` ist vergeben — **kein Code prüft es, kein Bildschirm bietet den Widerruf an** | `src/server/auth/katalog.generiert.ts:226` | blockiert | **erledigt** — `app.sitzungen_widerrufen` (`drizzle/0379`), auf dem Benutzerblatt als „Alle Anmeldungen beenden". Das Blatt sagte wörtlich, der Widerruf „kommt mit" diesem Recht; er kam nie. **Am KLEINEREN Recht, und mit Absicht:** ein Widerruf nimmt ein Plätzchen aus dem Verkehr, keinen Menschen aus dem Betrieb — wer widerrufen ist, meldet sich sofort wieder an. Deshalb ist er bis `leitung` bindbar, während der Entzug `system.benutzer_verwalten` verlangt. Die eigenen Anmeldungen gehen diesen Weg nicht: sie stehen unter `/portal/konto/sicherheit` (V-039) |
| V-077 | `lead.status` lässt sich nirgends setzen: die Route nimmt `status` entgegen, kein Formular sendet es | `src/app/api/crm/lead/route.ts:56` | blockiert | offen |
| V-078 | `nachgetragen` (Wachbuch, Schlüsselquittung) wird an sechs Stellen **angezeigt**, von keinem Formular gesetzt, von keiner SQL-Zeile geschrieben | `src/app/api/sicherheit/wachbuch/route.ts:104` | blockiert | offen |
| V-079 | Eine **Wiedervorlage** lässt sich niemandem zuweisen — die Route liest `zustaendigBenutzerId` und `leadId`, kein Formular sendet beides | `src/app/api/crm/wiedervorlage/route.ts:67` | blockiert | offen |
| V-080 | Die Akquise-Handlung „ansehen" hat keinen Auslöser; `geprueft` wird angezeigt, von nichts erzeugt | `src/app/api/akquise/ziel/route.ts:68` | behindert | offen |
| V-081 | `auftrag.status`: **`aktiv`, `pausiert`, `storniert`** erzeugt nichts | `drizzle/0025_auftrag.sql:35` | behindert | offen |
| V-082 | `einsatz.status`: **`laufend`, `abgeschlossen`** werden nie gesetzt, obwohl das Arbeiterportal sie anzeigt | `drizzle/0028_dienstplan.sql:425` | behindert | offen |
| V-083 | `zeiteintrag.status = 'offen_nacherfassung'` hat keinen Erzeuger, steht aber als Filter und als Pille in **vier** Oberflächen | `drizzle/0034_zeiteintrag.sql:78` | behindert | offen |
| V-084 | `mahnung.status = 'erledigt'` hat keinen Erzeuger, obwohl der Übergang ausdrücklich erlaubt ist | `drizzle/0130_pruefbefunde_finanzen.sql:475` | behindert | offen |
| V-085 | `angebot.status = 'abgelaufen'` hat keinen Erzeuger — der Lauf, für den `gueltig_bis` und ein eigener Teilindex gebaut wurden, fehlt | `drizzle/0024_angebot.sql:119` | behindert | offen |
| V-086 | `formular_eingang.status`: erzeugt wird ausschließlich `verarbeitet` — **`neu`, `spam`, `verworfen` nie** | `src/server/services/lead/annahme.ts:210` | behindert | offen |
| V-087 | `kunde.status = 'gesperrt'` ist die **UWG-Werbesperre** und lässt sich nirgends setzen; `inaktiv` ebenfalls nicht | `drizzle/0020_crm_identitaet.sql:173` | behindert | **erledigt** — `setzeKundeStatus`, eigener Weg statt Auswahlfeld |
| V-088 | `betroffenenanfrage.status = 'identitaet_offen'` hat keinen Erzeuger, obwohl zwei Oberflächen ihn beschriften | `drizzle/0176_betroffenenanfrage.sql:49` | behindert | offen |
| V-089 | Der in der Migration benannte nächtliche Statuslauf **„gültig → abgelaufen"** für Nachweise existiert nicht | `drizzle/0030_nachweis_qualifikation.sql:595` | behindert | offen |

---

## 7. Felder, die kein Formular sendet

Die Route liest sie. Die Spalte ist da. Nur schickt sie niemand.

| Nr | Was | Beleg | Grad | Stand |
|---|---|---|---|---|
| V-090 | **Der § 48-EStG-Einbehalt kann nie gebucht werden** — `bucheBauabzug` hat weder Route noch Knopf | `src/server/services/finanz/zahlung/index.ts:435` | blockiert | offen |
| V-091 | **Posten gegen Posten ausgleichen** (§ 7.4) ist gebaut, aber nicht auslösbar | `src/server/services/finanz/zahlung/index.ts:530` | behindert | offen |
| V-092 | **Der nach § 7 Abs. 3 Nr. 4 UWG vorgeschriebene Widerspruchslink wird von keinem Weg ausgegeben** | `src/server/services/datenschutz/werbewiderspruch.ts:142` | behindert | offen |
| V-093 | **Das einseitige Aufmass ist eine Sackgasse** — die Erhebungsart ist wählbar, die dafür verlangte Ankündigung nirgends eintragbar | `src/app/portal/[mandant]/bau/projekte/[id]/aufmass/neu/page.tsx:218` | blockiert | offen |
| V-094 | **Die Gegenzeichnung des Auftragnehmers am Leistungsnachweis** ist gebaut, aber beide Unterschriftswege setzen die Rolle fest auf `auftraggeber` | `src/server/services/reinigung/leistungsnachweis.ts:125` | blockiert | offen |
| V-095 | **Eine falsche Mannstunden- oder Positionszeile im Bautagebuch** ist über die Oberfläche nicht korrigierbar | `src/app/api/bau/bautagebuch/route.ts:188` | behindert | offen |
| V-096 | **Eine Aufgabe lässt sich mit keinem Vorgang verknüpfen** — die Route nimmt fünf Bezugsfelder, das Formular sendet keines | `src/app/portal/[mandant]/aufgaben/page.tsx:246`, `src/app/api/aufgaben/route.ts:136` | behindert | offen |
| V-097 | **Der Hauptkontakt eines Kunden lässt sich nicht bestimmen**, obwohl die Seite das Etikett anzeigt | `src/app/portal/[mandant]/crm/kunden/[id]/page.tsx:300`, `src/app/api/crm/kunde/route.ts:69` | behindert | offen |
| V-098 | **Eine Mahnstufe lässt sich nur ohne Folgeaktion bestätigen** — das Formular hat kein Feld dafür | `src/app/portal/[mandant]/einstellungen/mahnwesen/page.tsx:171` | behindert | offen |
| V-099 | **Brief-, Rechnungs- und Angebotsfußzeile sind pflegbar, erreichen aber kein einziges Dokument** (K-12) | `src/app/portal/[mandant]/einstellungen/identitaet/page.tsx:244` | behindert | offen |
| V-100 | **Logo, Avatar und Titelbild einer Gesellschaft lassen sich auf keinem Weg setzen** — weder Behälter noch Feld | `src/app/portal/[mandant]/einstellungen/identitaet/page.tsx:154` | behindert | offen |
| V-101 | **`sendeNachAussen` ist gebaut und getestet, aber keine Route ruft es** — auch der zugesagte Endpunkt `POST /api/crm/nachrichten` fehlt | `src/server/services/kern/nachricht.ts:532` | behindert | offen |
| V-102 | **Die Systemmeldungen im Posteingang sind hart deutsch** — auch die Ablaufwarnung, die eine Sperre ankündigt | `src/server/services/nachweis/benachrichtigung.ts:53` | behindert | offen |

---

## 8. Reihenfolge der Reparatur

Nicht nach Modul, sondern nach der Frage: **Kann ein Betrieb am Montag
anfangen?**

**R1 — Ohne diese kann niemand anfangen.** Ein Betrieb legt zuerst Orte und
Kunden an, dann plant er. **Geschlossen.**
V-001 Objekt · V-002 Revier · V-003 Bauprojekt · V-004 Veranstaltung ·
V-035/V-036 die Knöpfe zu den fertigen Kunden- und Lead-Masken ·
V-017 Kunde ändern

**R2 — Die Zeitkette schließen.** Das ist die Kette, an der Lohn und § ArbZG
hängen; der Mandant hat sie ausdrücklich benannt. **Geschlossen.**
V-049 Schicht zusagen ✓ · V-051 Entscheidung erreicht die Kraft ✓ · V-053 Monat
wechseln ✓ · V-064 laufenden Eintrag schließen ✓ · V-065 Ausgleichsbuchung ✓ ·
V-008 Stundenkonto eröffnen ✓ · V-068 Ausstempel-Marke ✓

**R3 — Sichtbarkeit.** Gebaut und unerreichbar ist teurer als nicht gebaut,
weil niemand danach sucht.
V-028 Radar · V-029 Berichte · V-030 Datenschutz-Posteingang · V-033
Check-in-Marken · V-034 Nacherfassung · V-038/V-039 Konto · V-041/V-042
Buchhaltung und Finanzen · V-043 Kundenportal-Leiste · V-044 Objektreiter

**R4 — Personal und Recht.**
V-010 Qualifikationsnachweis · V-014 Telefonanmeldung

**R5 — Finanzen.**
V-006 Lieferant · V-007 Bankkonto · V-011 Ausgabe · V-090 § 48 EStG ·
V-091 Postenausgleich · V-027 DATEV · V-084 Mahnung erledigt

**R6 — Der Rest**, in Registerreihenfolge.

---

## 8a. Nachgetragen: gefunden, während anderes gebaut wurde

Diese Befunde standen in keinem Suchlauf. Sie sind beim Bauen aufgefallen und
stehen hier, weil ein Befund ohne Nummer ein Befund ist, den niemand wiederfindet.

| Nr | Was | Beleg | Grad | Stand |
|---|---|---|---|---|
| V-103 | **Der Stichtag war der UTC-Tag, nicht der Berliner.** `benutzer_mandant.gueltig_ab` wird mit `app.berlin_heute()` gestempelt, `app.ist_mitglied` prüfte gegen `CURRENT_DATE` in einer UTC-Sitzung. Zwischen 00:00 und 02:00 Berliner Zeit ist damit **jede neu angelegte Mitgliedschaft für bis zu zwei Stunden unwirksam** — wer in diesem Fenster eine Leitung einlädt, legt ein Konto an, das sich anmelden kann und nichts sieht. Dieselbe Vorgabe stand in `app.katalog_positionen` und `app.leistungswerte_lesen`, wo ein **Preis** daran hängt. | Aufgefallen, weil der Seed um 23:23 UTC mit „Der Verantwortliche gehoert nicht zu dieser Gesellschaft" abbrach — derselbe Seed war Stunden zuvor durchgelaufen | blockiert | **erledigt** — `drizzle/0375`, plus eine Sperrklinke: `tests/isolation/stichtag-berlin.test.ts` §3 verlangt, dass **keine** Funktion in `app`/`kern` mehr auf `CURRENT_DATE` vorgibt |
| V-104 | **Neun rote Knöpfe auf einem Bildschirm.** `/dev/anmelden` gab jeder Kontozeile einen `primary`-Knopf. DESIGN §5: „one primary button per view" — Rot ist knapp, und ein Bildschirm mit neun roten Knöpfen hat **gar keine** Hauptaktion. | `src/app/dev/anmelden/page.tsx` | Schönheit | **erledigt** — die ganze Zeile ist der Knopf (DESIGN §5 „Chooser rows") |
| V-105 | **Das Wechselblatt belegte 9 % des Bildschirms.** Eine Überschrift, ein Satz, ein Knopf — der Rest schwarz. Und es liess den Leser rekonstruieren, was er verlässt: der Bereichswechsel ist die Handlung, die eine Rechnung in die falsche GmbH legt. | `src/components/portal/Wechselblatt.tsx` | behindert | **erledigt** — zeigt jetzt **beide** Seiten mit ihrem Zeichen und ihrer Identitätsfarbe, mit einem Pfeil dazwischen |
| V-106 | **Sieben gleich aussehende graue Wörter in der Kopfzeile.** „Bereich wechseln · Konto · Website · Deutsch English · Abmelden" — alles gleich gewichtet heisst nichts gewichtet; nichts sagte, dass zwei davon eine Wahl sind. | `src/components/portal/PortalRahmen.tsx` | behindert | **erledigt** — drei Gruppen mit Haarlinie (wohin · wie · raus), Sprache als Schiene, Abmelden in `danger-soft` |
| V-107 | **Der Windows-Start brach zweimal an PowerShell ab**, nicht an der Datenbank: erst am Init-Server des Postgres-Abbilds, dann daran, dass PowerShell 5.1 jede stderr-Zeile eines nativen Befehls zu einem terminierenden Fehler macht. | `scripts/windows-start.ps1` | blockiert | **erledigt** — Warten über TCP, Umleitung **im** Behälter, `Continue` für die Dauer der Schleife |

| V-108 | **Von 311 Verwaltungsseiten trugen ZWEI einen Rückweg.** Der Mandant hat es selbst gefunden: er klickte in der Beschäftigungsliste auf eine Person und stand auf einem Blatt ohne Ausgang; er öffnete das Stundenkonto und fand keinen Weg zurück. | `find "src/app/portal/[mandant]" -name page.tsx \| wc -l` → 311; mit Rückweg → 2 | blockiert | **erledigt** — der Rückweg wird jetzt aus der ADRESSE abgeleitet (`server/registry/rueckweg.ts`), vom Tor gegen die Rechte seines Ziels geprüft (AUT-06) und von der Hülle gezeichnet. **256 Seiten** haben ihn damit, 54 sind Modulwurzeln und sollen keinen haben. 11 Prüfungen in `tests/kern/rueckweg.test.ts` |
| V-109 | **Die Bedienfelder zeigten die Bordmittel des Browsers.** `<select>` mit Systempfeil (84 Dateien), `<input type="date">` mit einem Kalendersymbol, das auf dunklem Grund **schwarz auf schwarz** steht und damit unsichtbar ist (55 Dateien), Häkchen im Systemblau. DESIGN §5 „Forms" beschrieb das Feld seit jeher — nirgends stand es als Regel. | `grep -rl 'type="date"' src/app` → 55 · `grep -rl '<select' src/app` → 84 | behindert | **erledigt** — Grundregel in `globals.css`, `:where()` mit Spezifität null: greift überall, überschreibt nichts |

| V-112 | **Kein Test sah, ob ein Meldungsziel überhaupt existiert.** V-034 und V-069 sind zwei Ausprägungen DESSELBEN Fehlers: ein Zielauflöser schreibt eine Adresse hin, und niemand prüft sie. NOT-03 verlangt „a link to the thing“; geprüft wurde bis hierher nur, dass ein Ziel **nicht leer** ist — beide toten Verweise liefen deshalb jede Nacht ins Leere. | `tests/kern/benachrichtigung.test.ts` hatte sechs Prüfblöcke, keinen über Erreichbarkeit | behindert | **erledigt** — §7 prüft JEDES registrierte Ziel Segment für Segment gegen das Routenregister. Die beiden Befunde selbst stehen unter ihren eigenen Nummern (V-034, V-069) |

| V-113 | **`eroeffneKonto` verlor die Sollzeit still.** `on conflict do nothing` hiess: legt der Nachtlauf das Monatskonto mit `soll_minuten = 0` an (die Sollzeit ist offen, O-18), läuft jeder spätere Aufruf MIT einer Sollzeit ins Leere. Der Monat behielt 0, der Saldo war um die ganze Sollzeit falsch, und nichts wurde rot. Der Befund entstand erst dadurch, dass es den Rollover-Lauf überhaupt gibt (V-008). | Gefunden von `tests/isolation/stundenkonto.test.ts` §3, die den Vortrag über zwölf Monate auf die Minute nachrechnet: erwartet 3, erhalten 483 | blockiert | **erledigt** — `on conflict … do update`, aber nur für Felder, die der Aufrufer AUSDRÜCKLICH mitgibt, und nur solange der Monat offen ist |

| V-114 | **Das `Mehr`-Blatt gab Kundenkonten den INTERNEN Baum.** Der Kommentar an `KUNDEN_NAVIGATION` sagte beruhigend, die Kundenleiste trage kein `Mehr` — `OHNE_MEHR` führt aber nur `mitarbeiter` und `gruppe`. Das Blatt gab es also, und weil `MehrZelle` genau zwei Bäume kannte, fiel das Kundenportal auf `NAVIGATION`: ein Kundenkonto mit `objekt.lesen` sah dort interne Punkte, die unter `/portal/kunde` auf 404 führen, und jeder davon verriet die Existenz dessen, was er nicht zeigen darf (AUT-06). | `registry/tableiste.ts:172` gegen den Kommentar in `registry/navigation.ts:600` | blockiert | **erledigt** — mit V-043 in derselben Änderung: die Rechtekarte wird für `kunde` aus `KUNDEN_NAVIGATION` gebaut, interne Schlüssel stehen nicht mehr darin, und `=== true` blendet sie aus |

| V-111 | **Der abgeleitete Rückweg stand auf 46 Seiten ZWEIMAL.** Die Reparatur von V-108 zeichnet ihn in der Hülle; 46 Seiten trugen ihren eigenen weiter als `<nav aria-label="Zurück">` im Inhalt. Zwei Pfeile untereinander, die dasselbe sagen, lassen den Leser prüfen, ob sie dasselbe Ziel haben — ein doppelter Ausgang ist schlechter als ein fehlender. | `grep -rl 'aria-label="Zurück"' src/app/portal` → 46, keine davon mit `zurueck=`-Eigenschaft | behindert | **erledigt** — alle 46 in die Eigenschaft `zurueck` gehoben (Ziel und Wortlaut unverändert, Antippfläche jetzt 44 px); Sperrklinke: `tests/kern/rueckweg.test.ts` §6 verlangt, dass `aria-label="Zurück"` **nur** in `components/portal/Zurueck.tsx` vorkommt |

| V-110 | **Wer ausgeschieden ist, blieb erreichbar.** `app.darf_kontaktiert_werden` prüft Widerspruch, Werbewiderspruch, Archivierung, Anonymisierung, den Einwilligungskanal und die ganze Kundenseite — aber **nicht**, ob die Person das Unternehmen verlassen hat. Eine Einwilligung gehört der Person, nicht dem Stuhl; und vertragliche Post an eine ausgeschiedene Person liest ihr Nachfolger (Art. 5 Abs. 1 lit. d DSGVO). | `grep -n ausgeschieden_am` → nur die Spalte in `drizzle/0020`, in keiner Bedingung. Gefunden, weil ein Test es behauptete und nachmass | blockiert | **erledigt** — `drizzle/0376`, beide Zweige |

---

## 9. Was geprüft und **widerlegt** wurde

Sechs Beobachtungen sahen aus wie Lücken und sind begründete Entscheidungen.
Sie stehen hier, damit sie nicht in drei Monaten erneut als Befund auftauchen.

1. **Der Einwand `eintrag_fehlt` hat sehr wohl ein Formular.** Die Behauptung
   war am Code falsch; sie beruhte zusätzlich auf einer Fehldeutung des
   NULL-Zwecks. (Deshalb ist in § 4 nur die *Entscheidung* (V-051) offen,
   nicht das Formular.)
2. **Der fehlende Zustand `zugesagt` ist im Migrationskopf von
   `drizzle/0028_dienstplan.sql` beschrieben** — als Vokabular, das die
   Oberfläche später füllt. Das Fehlen ist dokumentiert. **Es bleibt trotzdem
   V-049**, denn dokumentiert heißt nicht gebaut, und die Besetzungswarnung
   rechnet heute falsch.
3. Ein weiterer Befund war die wörtlich dokumentierte Folge einer offenen
   Kundenfrage (`TODO(client, …)`) — kein Fehler, sondern eine Frage, die
   niemand beantwortet hat.

Die übrigen drei Gegenproben ergaben **„keine Begründung gefunden"** und
bestätigen damit ihren Befund.

---

## 10. Was dieses Blatt **nicht** behauptet

- Es behauptet nicht, vollständig zu sein. Es behauptet, dass **diese 136
  Befunde real sind** — jeder mit Datei, Zeile und Gegenprobe.
- Es behauptet nicht, dass alles Übrige funktioniert. Acht Suchläufe finden
  nicht, wonach sie nicht gesucht haben.
- Es misst **Erreichbarkeit und Existenz**, nicht Richtigkeit. Dass ein Weg
  existiert, heißt nicht, dass er das Richtige rechnet. Dafür sind die Tests da.
