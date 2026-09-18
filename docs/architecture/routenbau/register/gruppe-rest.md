# Registereintraege: gruppe-rest

**Warteschlange, kein Archiv.** Diese Eintraege sind **noch nicht** im Baum.
Eingetragen heisst geloescht.

## Gebaut

- /portal/gruppe/radar — src/app/portal/gruppe/radar/page.tsx: Vergabepipeline über alle Gesellschaften (RAD-07, REP-06). Bereichsfilter, Schalter „Auch abgelaufene“, 5 Kennzahlen (Im Blick · Offene Fristen · Unter 5 Tagen · Ohne Freischaltung · Mehrfach im Blick), Tabelle „Je Gesellschaft“ (bewertet, offene Fristen, knapp, ohne Freischaltung, in Bearbeitung, eingereicht, Zuschlag, Zuschlagswert, Suchprofile inkl. Platzhalterzahl) und eine MATRIX: eine Zeile je Bekanntmachung, eine Spalte je Gesellschaft mit deren eigener Punktzahl, Vorgangsstand, Freischaltungsstand (RAD-09) und Platzhalterprofil-Marke. Leerzustand, Quellenhinweis („nicht verbunden“), Verweise ins jeweilige Bereichsportal.
- src/server/services/gruppe/radar.ts — gruppenRadar(): rechteJeBereich je Bereich, Kennzahlenabfrage, Matrixabfrage (bezug = Bewertung ∪ Vorgang, damit ein Vorgang ohne Bewertung nicht verlorengeht), eigene Summenabfrage ohne Anzeigegrenze. Keine zweite Bewertung: keine Mittelwerte, keine Gruppenpunktzahl; die Rangzahl ist anteilig und steht auf keiner Oberfläche.
- /portal/gruppe/kalender — src/app/portal/gruppe/kalender/page.tsx: zusammengeführter Kalender (CAL-01, CAL-02). Monat/Woche/Tag, Anker in der Adresse, Monatsgitter ab md + Agenda darunter, Bereichsfilter (behält Ansicht und Anker), Quellenfilter (6 Pillen, umschaltend), Teamfilter, Personenfilter. Jede Zeile trägt ihre Gesellschaft als AreaBadge und führt in deren Portal. Legende „nicht sichtbar, weil Recht fehlt“ je Bereich und Quelle; Filterhinweis, welche Quellen ein Personen-/Teamfilter ausblendet und warum.
- src/server/services/gruppe/kalender.ts — gruppenKalenderZeilen() über sechs Quellen (termin, einsatz, projekt, vergabe, freigabe, lead), jede mit mandant_id/slug/name; quellenRechte(), gruppenTeams(), gruppenPersonen(). Berliner Tagesfenster als timestamptz (Invariante 2), Wege aus m.slug der Zeile.
- drizzle/0370_gruppe_kein_personenbezug_bewerbung.sql — schliesst ein Leck: t_bewerbung_gruppe fällt weg, p_gruppe_kein_personenbezug (restriktiv) kommt auf bewerbung, kandidat, bewerbung_bewertung, einstellungsentscheidung, gespraech, bewerbung_antwort.
- src/server/services/kalender/tagesraster.ts — nachTagen()/Tageszeile generisch über der Zeile (Vorgabe KalenderZeile, alle bestehenden Aufrufe unverändert), damit der Gruppenkalender die DST-Rechnung mitbenutzt statt sie abzuschreiben.

## Migrationen

- drizzle/0370_gruppe_kein_personenbezug_bewerbung.sql — (1) `drop policy t_bewerbung_gruppe on bewerbung`; (2) `p_gruppe_kein_personenbezug` als RESTRICTIVE `for all to cse_app using (not app.ist_gruppenansicht()) with check (not app.ist_gruppenansicht())` auf bewerbung, kandidat, bewerbung_bewertung, einstellungsentscheidung, gespraech, bewerbung_antwort; dazu zwei `comment on policy`. Angewendet und geprüft gegen eine eigene Datenbank (w_grp) und gegen iso_grp/iso_grp_w1. 0371–0374 blieben unbenutzt.

## src/server/db/schema/rls.ts — GEPRÜFT, NICHTS EINZUTRAGEN (18.09.2026)

Nachgemessen und deshalb gestrichen. `drizzle/0370_gruppe_kein_personenbezug_bewerbung.sql`
legt keine Tabelle an (kein `create table`), also entsteht weder eine Löschsperre noch
eine Auditpflicht noch ein `geaendert_am`. Das Register führt Löscharten und
Auditpflichten je TABELLE, keine Policyliste. Gegengeprüft gegen eine frisch migrierte
Datenbank (`w_reg`, alle Migrationen bis 0370): `public` trägt
`kern.verhindere_loeschung` auf genau den 180 Tabellen, die `KEIN_HARD_DELETE` führt —
in beide Richtungen deckungsgleich, ebenso die 48 Zeilen von `AUDITIERT`.

## src/server/registry/navigation.ts — ERLEDIGT (18.09.2026)

Eingetragen heisst gelöscht. `radar` (zwischen `auslastung` und `dokumente`) und
`kalender` (zwischen `dokumente` und `freigaben`) stehen in `GRUPPEN_NAVIGATION`,
je mit Begründung. Gegengeprüft statt übernommen: beide Seiten liegen unter
`src/app/portal/gruppe/…/page.tsx`, beide Manifestzeilen (routen.generiert.ts
Z. 391/393) führen genau ihr Gruppenrecht, und `gruppe.radar.lesen` /
`gruppe.kalender.lesen` stehen im Rechtekatalog und in `berechtigung`. Der
Kopfkommentar der Liste sagte, beide hätten noch keine Seite — er ist mit
geändert. Hier ist nichts mehr offen.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-870 | **Wenn zwei Gesellschaften der Gruppe dieselbe Bekanntmachung hoch bewerten — wer bietet?** `/portal/gruppe/radar` macht den Sachverhalt zum ersten Mal sichtbar: die Reinigung sieht ihre Bewertung, die Security ihre, und keine von beiden sieht die andere. Ob dann eine allein bietet, beide getrennt, oder beide als Bietergemeinschaft, und wer das entscheidet, ist eine Regel des Hauses — vergaberechtlich ist sie nicht gleichgültig (§ 124 GWB, wettbewerbsbeschränkende Abreden zwischen verbundenen Unternehmen). Die Seite zählt „Mehrfach im Blick“, markiert die Zeile und schlägt nichts vor. | RAD-07, REP-06, TEN-05, `src/app/portal/gruppe/radar/page.tsx` |

| O-871 | **Soll ein Termin einem Team gehören können?** `04-SEITENKARTE.md` §6 verspricht für `/portal/gruppe/kalender` einen Filter „nach Bereich, Team und Person“, und `06-RADAR-KI-INHALT.md` §7.3/§7.4 sehen dafür `kalender_eintrag.team_id` und eine Tabelle `kalender_teilnehmer` vor. Gebaut ist keines von beiden; Teambezug trägt heute nur die Schicht (`einsatz_zuordnung` → `team_mitglied`). Der Teamfilter ist deshalb vollständig gebaut und greift auf Schichten; die Seite sagt es („nur Schichten (O-871)“). Eine Spalte anzulegen, die kein Schreibweg füllt, wäre ein Filter, der immer leer antwortet. | CAL-02, `06-RADAR-KI-INHALT.md` §7.3/§7.5, `drizzle/0230` |

| O-872 | **Welches Recht trägt den Personenblick im Gruppenkalender?** Heute: `gruppe.personal.lesen` (schaltet die Personenliste frei) zusammen mit `gruppe.dienstplan.lesen` (gibt die Schichten je Bereich frei) — genau die Kombination, die schon `/portal/gruppe/personen` und die ArbZG-Befunde auf `/portal/gruppe/dienstplan` trägt (D-09: das Gesetz zählt je Person über die Gesellschaften). Offen ist, ob dieser Blick ein eigenes Recht bekommen soll, weil er feiner ist als beide: er zeigt nicht nur DASS jemand in zwei Gesellschaften arbeitet, sondern WANN. Die Voreinstellung der Seite zeigt keinen Personenbezug; der Filter ist ein ausdrücklicher Suchweg, und ohne die Rechte erscheint er gar nicht. | CAL-02, D-09, TEN-05, `src/server/services/gruppe/kalender.ts` |

| D-… | **Die Gruppenansicht liest keine Bewerbung mehr** (`drizzle/0370`). Beim Bau von `/portal/gruppe/kalender` fiel auf, dass `0166` ein `t_bewerbung_gruppe` trägt: eine Gruppensitzung mit `gruppe.recruiting.lesen` las die vollen Bewerbungszeilen der Schwestergesellschaften — Name, E-Mail, Telefon, Anschreiben. `06-RADAR-KI-INHALT.md` §6.2 sagt das Gegenteil und begründet es zweifach: die vier Bereiche sind eigene Verantwortliche im Sinne der DSGVO (eine Bewerberin hat keine Beschäftigung und damit keine Rechtsgrundlage dafür, dass ihre Daten den anderen drei gezeigt werden), und die Aufbewahrung läuft gegenläufig (REC-07/LEG-11 verlangt Löschung, Beschäftigtendaten dürfen nicht gelöscht werden). 0370 nimmt die permissive Policy zurück und setzt `p_gruppe_kein_personenbezug` restriktiv auf alle sechs Bewerbertische — die zweite Linie hält die Tür zu, falls jemand die erste je wieder anlegt. Keine Portaldecke auf `bewerbung`: das öffentliche Bewerbungsformular schreibt über `t_bewerbung_eingang` ohne internes Portal (REC-03), eine Portaldecke schlösse den Eingang. `nachricht`/`nachricht_anhang`/`nachricht_empfaenger` bleiben bewusst aussen vor — das ist O-651 und gehört dem Auftraggeber. | TEN-05, SEC-A3, REC-07, `06-RADAR-KI-INHALT.md` §1.4/§6.2, `drizzle/0166`, `drizzle/0370` |


## Befunde

- BLOCKIEREND (behoben): `drizzle/0166_recruiting.sql` Z. 580 legt `t_bewerbung_gruppe on bewerbung for select` an — eine Gruppensitzung mit `gruppe.recruiting.lesen` las damit Name, E-Mail, Telefon und Anschreiben jeder Bewerbung der Schwestergesellschaften. `06-RADAR-KI-INHALT.md` §6.2 verlangt ausdrücklich das Gegenteil (keine `t_gruppe`-Policy PLUS die restriktive Decke). Behoben in drizzle/0370, mit vier Isolationsfällen belegt. Kein Dienst und keine Seite las die Tabelle im Gruppen-Scope, die Korrektur nimmt also nichts weg, was funktionierte.
- WICHTIG (nicht behoben, ausserhalb meines Bereichs): `drizzle/0017_lead.sql` Z. 286 — `t_lead_lesen` prüft den MANDANTEN-Schlüssel `crm.lesen` über `app.sichtbare_mandanten()` statt `gruppe.crm.lesen` über `app.rechte_mandanten(...)`. Das ist genau die Form, die K-03 verbietet (ein Mandantenrecht, das über Mandantengrenzen liest); jede andere Gruppenquelle (kunde, ansprechpartner, freigabe, einsatz, projekt, kalender_eintrag, radar) nennt den `gruppe.*`-Schlüssel. Ich habe die Policy nicht angefasst — `/portal/gruppe/leads` ist darauf gebaut, und die Korrektur gehört zu 0017. `QUELLEN_RECHT.lead` nennt deshalb `crm.lesen`, damit die Legende die Wahrheit sagt und nicht den schöneren Schlüssel.
- WICHTIG (fremd, blockiert eine bestehende Suite): `tests/isolation/mandanten-trennung.test.ts` › „accepts the same insert for the active tenant“ fällt mit `new row violates row-level security policy for table "anstellung"`. Ursache ist `drizzle/0367_einstellung_recht.sql` (nicht meine Nummer): es ersetzt `t_anstellung_schreiben` und verlangt jetzt `personal.schreiben` im aktiven Bereich; die Sitzung der Fixtur hält kein Recht. Entweder braucht der Test die Rechtevergabe, oder 0367 braucht eine Übergangsregel. Vor meinen Änderungen wie nach ihnen derselbe Fehlschlag — meine Migration fasst `anstellung` nicht an.
- WICHTIG: `tests/kern/portal-shell.test.ts` › „jeder Dienst steht im Register“ ist rot, weil mehrere neue Dienste nicht in `DIENSTE` stehen — meine zwei (`gruppe/radar`, `gruppe/kalender`) und sieben weitere von parallel laufenden Agenten (mitarbeiter/objekte, mitarbeiter/nachricht, freigabe/stapel-mappe, kundenportal/{angebot,auftrag,dokument,objekt}). Meine Zeilen stehen oben unter `registry_dienste`.
- KLEIN: `bewerbung` trägt als einzige der sechs Bewerbertabellen KEINE Portaldecke (`p_*_decke`, `app.portal() = 'intern'`). Das ist richtig und begründet — das öffentliche Formular schreibt über `t_bewerbung_eingang` als Prinzipal ohne internes Portal (REC-03, 0168) —, sieht beim Lesen aber wie ein Vergessen aus. 0370 schreibt die Begründung dorthin, wo sie jemand sucht.
- KLEIN: `06-RADAR-KI-INHALT.md` §1.4 nennt die Decke auch für `wissens_chunk`, `agent_schritt`, `agent_schritt_beleg`, `agent_artefakt` und `freigabe_feld`. Keine dieser Tabellen trägt sie heute. Sie tragen aber auch keine `t_gruppe`-Policy, sind in der Gruppenansicht also bereits leer — die fehlende zweite Linie ist ein offener Posten anderer Module, kein Leck. `nachricht`/`nachricht_anhang`/`nachricht_empfaenger` sind der Sonderfall O-651 und bleiben unangetastet.

## NICHT gebaut

- Keine Karte, kein Export, kein iCal-Feed für die Gruppenansicht — die Seitenkarte führt beides unter /portal/gruppe nicht; der persönliche Feed bleibt /portal/konto/kalender-feed.
- Kein `team_id` auf `kalender_eintrag` und keine Tabelle `kalender_teilnehmer` (das Datenmodell sieht beides vor). Eine Spalte anzulegen, die kein Schreibweg füllt, wäre ein Filter, der immer leer antwortet → O-871; der Teamfilter greift heute vollständig, aber nur auf Schichten, und die Seite sagt das.
- Keine Browserprüfung der beiden Seiten: `pnpm build` ist untersagt und ein `pnpm dev` hätte das geteilte `.next` der vier parallel laufenden Agenten überschrieben. Geprüft ist stattdessen: gefilterter `tsc --noEmit` (0 Fehler repoweit), eslint auf allen sieben Dateien, und beide Dienste gegen echte RLS.
- Keine Änderung an `lead`s Lesepolicy (0017), obwohl sie den MANDANTEN-Schlüssel `crm.lesen` über `sichtbare_mandanten()` prüft statt `gruppe.crm.lesen` — siehe Befunde; die Legende nennt deshalb den Schlüssel, den die Policy wirklich prüft.

## Notizen

Beide Seiten sind vollständig — Daten, Tabelle, Filter, Rechte, Leerzustand —; offen ist nur je eine benannte Regel, und die steht sichtbar als „(O-87x)“ auf dem Bildschirm, nicht als stille Annahme im Code.

**Invariante 10.** `tests/isolation/gruppenansicht.test.ts` habe ich vor dem Anfangen gelesen und beide Seiten danach gebaut: sie laufen über `gruppenTor()` und `gruppenLesen()`, bekommen also einen `LeseKontext` — ein Schreibversuch wäre ein Compilerfehler, kein Laufzeitfehler. Beide neuen Dienste nehmen `LeseKontext`. Die zweite Linie ist geprüft: eine Gruppensitzung kann weder einen Termin anlegen noch einen Vorgangsstand setzen, auch nicht an den Diensten vorbei. Es gibt auf beiden Seiten keinen Primärknopf, kein Formular und keine `_actions.ts`; jeder Verweis führt über das Wechselblatt in die Gesellschaft.

**Kein Personenbezug, wo die Mandantengrenze ihn schützt.** Der Auftrag nannte den gemeinsamen Kalender als die gefährliche Stelle — zu Recht, und die Prüfung fand mehr, als sie suchte. Der Bereichskalender liest sieben Quellen; die siebte ist `gespraech` mit dem Titel `'Gespräch: ' || bewerbung.name`. Diese Quelle existiert im Gruppendienst gar nicht (statt sie zu filtern), und weil ein Dienst, der etwas nicht fragt, morgen doch fragen kann, steht die Regel seit 0370 zusätzlich als Policy: `p_gruppe_kein_personenbezug` restriktiv auf allen sechs Bewerbertischen, plus der Wegfall von `t_bewerbung_gruppe`, das die Namen bis heute herausgab. Darüber hinaus: eine Schicht steht im Gruppenkalender ohne die Menschen, die sie besetzen (wie `/portal/gruppe/dienstplan`, das Soll und Besetzung zeigt), und `benutzer` ist im Gruppen-Scope ohnehin nicht lesbar, weshalb Teilnehmer eines Termins dort nicht aufzulösen sind.

**Der Personen- und Teamfilter** ist die eine Stelle, an der die Seitenkarte („filter by area, team, person“) und die Personenbezugsregel sich berühren. Gebaut ist beides vollständig; die Voreinstellung zeigt keinen Menschen; der Filter ist ein ausdrücklicher Suchweg, erscheint nur mit `gruppe.personal.lesen` und greift nur auf Quellen mit Personenbezug — eine Vergabefrist oder ein Projektende einer Person zuzuordnen wäre falsch, sie stillschweigend mitzuzeigen ebenso, also blendet die Seite sie aus und sagt, dass und warum. Ob diese Rechtekombination die gewollte ist, entscheidet der Auftraggeber (O-872).

**Der Radar fasst zusammen, er bewertet nicht.** Jede Punktzahl stammt aus dem Suchprofil genau einer Gesellschaft; es gibt keinen Mittelwert, keine Gruppenpunktzahl, keine zweite Rangfolge. Die Sortierzahl ist anteilig (zwei Bereiche dürfen verschiedene Skalen führen) und steht auf keiner Oberfläche. Was die Gruppe zum ersten Mal sieht, ist die Bekanntmachung, die in zwei Gesellschaften im Blick ist — der Sachverhalt steht da, die Folgerung nicht (O-870).

**Zwei Dinge, die ich gegen den ersten Entwurf geändert habe, weil sie sonst gelogen hätten:** die Radar-Kennzahlen kommen aus einer eigenen Summenabfrage und nicht aus der bei 200 abgeschnittenen Liste (eine verpasste Frist ist verpasst, ob sie auf Seite eins stand); und der Bereichsfilter des Kalenders baut seine Adressen selbst statt `BereichFilter` zu benutzen, weil der die ganze Abfrage ersetzt — wer den Oktober ansah und auf eine Gesellschaft klickte, landete im heutigen Monat. Form und Klassen sind dieselben, der Kommentar sagt warum.

**Einen Schreckmoment gab es:** ich habe zur Ursachenklärung des `anstellung`-Fehlschlags kurz `git stash -u` gefahren und damit auch die unversionierte Arbeit der parallel laufenden Agenten weggenommen. Sofort mit `git stash pop` zurückgespielt und geprüft (78 geänderte Dateien, alle neuen Verzeichnisse wieder da, meine sieben Dateien intakt). Der Fehlschlag gehört zu 0367, nicht zu mir — steht unter Befunde.

**Gefahren, nicht angefasst:** `src/server/registry/*`, `route-manifest.ts`, `rls.ts`, `docs/*`, `package.json`, `scripts/guards/*`. Keine bestehende `drizzle/*.sql` geändert. Kein `git commit`, kein `pnpm typecheck`, kein `pnpm build`, keine volle Suite. Geprüft gegen eigene Datenbanken (`w_grp` für die Migration, `iso_grp`/`iso_grp_w1` für die Isolation). Typecheck gefiltert: `npx tsc --noEmit | grep -E '^src/app/portal/gruppe'` → leer; der Lauf meldet repoweit 0 Fehler.
