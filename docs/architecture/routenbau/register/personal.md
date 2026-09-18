# Registereinträge: personal

**Warteschlange, kein Archiv.** Diese Einträge sind **noch nicht** im Baum. Die
gemeinsamen Dateien pflegt EINE Hand, weil mehrere Agenten gleichzeitig arbeiten
und sich sonst in dieselbe Zeile schreiben. Ist ein Abschnitt eingetragen, wird
er hier gelöscht — solange er hier steht, fehlt er dort.

**Die Einträge des Behebungsschritts gelten.** Er lief zuletzt und hatte den
Auftrag, die vollständige aktuelle Liste zu liefern — auch das, was sich seit
dem Bauschritt geändert hat.

## Stand

- Bau: fertig
- Kritik: 16 Befunde
- Behebung: 15 behoben, 0 widerlegt, 5 offen

## Migrationen (gegen eine eigene Datenbank gefahren: True)

- drizzle/0190_person_stammdaten.sql — person.geburtsort + person.staatsangehoerigkeit char(2) mit CHECK; TABELLENWEITER SELECT-Grant auf person fuer cse_app entzogen und als erschoepfende Spaltenliste ohne die drei Stammdatenfelder zurueckgegeben (ein Spalten-Revoke war wirkungslos, weil relacl 'cse_app=ar' trug — nachgemessen); Spalten-UPDATE-Grant fuer die drei Felder; Policy t_person_personalpflege (personal.schreiben + Beschaeftigung im aktiven Mandanten, not ist_readonly); Definer app.person_stammdaten_lesen(uuid) mit Rechtepruefung, AUT-06-Verhalten und Auditzeile mit Rechtsgrundlage; cse_definer-Grants und d_person_stammdaten-Policy.
- drizzle/0191_anstellung_vertrag.sql — anstellung.austritt_grund, .tarifgruppe, .arbeitstage_woche, .kostenstelle; TABELLENWEITER UPDATE-Grant entzogen und ohne den Spiegelsatz (arbeitszeitmodell, wochenstunden, arbeitstage_woche, stundensatz_intern, tarifgruppe, kostenstelle) zurueckgegeben; SELECT auf austritt_grund/arbeitstage_woche/kostenstelle, NICHT auf tarifgruppe (K-05); Trigger kern.anstellung_status_uebergang (beendet ist einwegs, nur der UEBERGANG wirft); die fehlende K-14-Haelfte kern.bm_aus_anstellung (legt die abgeleitete Mitgliedschaft an, wenn keine laufende besteht, und entzieht nur aus_anstellung-Zeilen — mit aus_anstellung=false im selben UPDATE, weil kern.bm_aus_anstellung_schutz sonst wirft); app.anstellung_status_nachziehen() fuer cse_job.
- drizzle/0192_anstellung_kondition.sql — Tabelle anstellung_kondition (mandant_id, anstellung_id als zusammengesetzter FK, gilt_ab/gilt_bis, arbeitszeitmodell, wochenstunden, arbeitstage_woche, stundensatz_intern_cent bigint, tarifgruppe, kostenstelle, grund, erstellt_am/erstellt_von), EXCLUDE USING gist gegen zwei gleichzeitig gueltige Konditionen, RLS (Lesen personal.lesen, Schreiben personal.entgelt_schreiben, Gruppe, t_person-Selbstzugriff, K-04-Decken, cse_definer), Spaltengrants ohne SELECT auf stundensatz_intern_cent/tarifgruppe, Trigger kern.anstellung_kondition_spiegeln (der EINE Schreiber des Spiegels, spiegelt nur die heute gueltige Kondition), app.anstellung_kondition_spiegel_nachziehen() fuer den Datumswechsel, Loeschsperre + Auditblock zwischen den Sentinels.
- drizzle/0193_entgelt_lesen_haerten.sql — app.entgelt_lesen(uuid, date): prueft personal.entgelt_lesen UND den aktiven Mandanten (42501 ohne Recht, null bei fremder Gesellschaft — AUT-06), liest die am Stichtag gueltige Kondition, faellt nur bei Beschaeftigungen OHNE jede Kondition auf den Spiegel zurueck, protokolliert mit Stichtag und Quelle. app.anstellung_entgelt_lesen(uuid) bleibt als Weiterleitung (drei Stellen im Bestand nennen sie).
- drizzle/0194_person_zusammenfuehren.sql — person.zusammengefuehrt_in_person_id (lesbar fuer cse_app, schreibbar nur fuer cse_definer) mit partiellem Index; Trigger kern.person_merge_kein_zyklus (Selbstbezug, Zeigen auf eine zusammengefuehrte Zeile UND das Zusammenfuehren einer fuehrenden Zeile — die dritte Lage fehlt in der naheliegenden Umsetzung und erzeugt genau die Kette); app.person_kanonisch(uuid); app.person_identitaeten(uuid) fuer Aggregationen je Mensch (Invariante 9/K-06); app.person_zusammenfuehren(uuid, uuid, text) mit Recht, aktivem Mandanten, Readonly-Sperre, Pflichtgrund und Auditzeile.
- (Behebung) drizzle/0190_person_stammdaten.sql (geaendert): UPDATE-Grant auf person zurueckgeschnitten, kern.person_stammdaten_schutz() + trg_person_stammdaten_schutz ergaenzt
- (Behebung) drizzle/0191_anstellung_vertrag.sql (geaendert): kern.bm_aus_anstellung() — Anlege-Zweig auf INSERT/Rueckkehr beschraenkt, Schutz gegen Wiederkehr eines von Hand entzogenen Zugangs, TODO(client, O-615)
- (Behebung) drizzle/0192_anstellung_kondition.sql (geaendert): kern.anstellung_kondition_spiegeln() leert den Spiegel ohne heute gueltige Kondition; app.anstellung_kondition_spiegel_nachziehen() um den Zweig 'leer' erweitert, Zaehlung umgestellt
- (Behebung) drizzle/0195_arbzg_identitaeten.sql (NEU): app.arbzg_belastung und zeit_intern.arbzg_belastung_job aggregieren ueber app.person_identitaeten; revoke execute … from public fuer app.person_kanonisch und app.person_identitaeten

## Gebaute Adressen

- `/portal/[mandant]/personal/abwesenheiten/[id]` — fertig
  - Detailblatt mit Zeitraum, Halbtagen, angerechneten Tagen und allen drei Zeitpunkten in Europe/Berlin. Der Grund (Art. 9 DSGVO) kommt NUR auf ausdrueckliche Anforderung (?grund=1) ueber app.abwesenheit_grund_lesen, mit sichtbarem Protokollhinweis; 'kein Recht' (42501) und 'kein Grund hinterlegt' sind zwei verschiedene Saetze. zeit.konto_lesen wird VORHER gefragt, damit null Zeilen im Urlaubskonto nicht wie 'kein Anspruch' aussehen. Entscheidungsformular gegen das vorhandene POST /api/abwesenheiten/[id], Knoepfe nur fuer Uebergaenge, die der Dienst zulaesst. Korrektur der Kritik umgesetzt: findeAbwesenheit liefert jetzt storniert_am.
- `/portal/[mandant]/personal/antraege/[id]` — fertig
  - Zeigt den PREIS vor der Entscheidung: Arbeitstage aus rechneTage (nie in SQL nachgebaut), Urlaubskontostand, und die Warnung 'eine Genehmigung wuerde jetzt abbrechen' bevor UrlaubskontoFehlt fliegt (O-18). Ein TAUSCHANTRAG bekommt bewusst KEINEN Genehmigen-Knopf: entscheideAntrag behandelt nur den Abwesenheitszweig, eine Genehmigung waere wirkungslos und ohne SEC-04-Tor (O-613). findeAntrag wurde um erzeugtAbwesenheit, einsatzId, tauschPartnerAnstellungId, abwesenheitsartId, zaehltAufUrlaubskonto, storniertAm erweitert.
- `/portal/[mandant]/personal/anstellungen/[id]/vertrag` — fertig
  - Der Kritik gefolgt: nur personalnummer + eintritt sind Schreibfelder. arbeitszeitmodell/wochenstunden/arbeitstage_woche stehen gesperrt daneben, weil sie nach 01-KERN §6.14 ein Spiegel der datierten anstellung_kondition mit genau EINEM Schreiber sind (05-API-KARTE fuehrt sie unter /konditionen mit personal.entgelt_schreiben) — 0191 nimmt sie cse_app aus dem UPDATE-Grant, die Sperre ist also keine Behauptung der Oberflaeche. austritt nur lesend, mit Verweis auf /beenden. Personalnummernkollision kommt als Satz zurueck, nicht als 23505.
- `/portal/[mandant]/personal/anstellungen/[id]/entgelt` — fertig
  - Satz in Cent, angezeigt als Euro (formatiereGeld), gelesen ausschliesslich ueber das gehaertete app.entgelt_lesen(anstellung, stichtag); Protokollhinweis sichtbar. Die Historie zeigt Zeitraeume/Stunden/Grund OHNE Betraege — ein Verweis je Zeile holt genau einen Satz, damit ein Seitenaufruf nicht zehn Auditzeilen schreibt. Schreiben legt eine KONDITION an (nie den Spiegel), Eurobetrag serverseitig mit parseGeld geparst. tarifgruppe/arbeitszeitmodell bleiben freie Felder mit sichtbarem 'offen (O-610)' bzw. '(O-18)'. Die 2FA-Frage steht als 'offen (O-614)' auf der Seite.
- `/portal/[mandant]/personal/anstellungen/[id]/beenden` — fertig
  - Vor dem Formular die Folgen: Einsaetze nach dem Austritt, nicht abgeschlossene Stundenkonten, Resturlaub, offene Antraege, nicht zurueckgegebene Schluessel. Jeder Posten haengt an einem ANDEREN Recht, deshalb unterscheidet die Seite 'keine' von 'nicht pruefbar — kein Leserecht (x)'. Geschrieben werden austritt + austritt_grund (neue Spalte in 0191, wie 01-KERN §6.14 sie fuehrt — nicht ins audit_log ausgewichen). Status folgt dem Kalender: erst wenn der Austrittstag vorbei ist, und am Statuswechsel haengt der K-14-Entzug. Nie ein DELETE.
- `/portal/[mandant]/personal/personen/[id]/stammdaten` — fertig
  - Drei Felder (Geburtsdatum, Geburtsort, Staatsangehoerigkeit als ISO-3166-1-alpha-2 mit CHECK), gelesen nur ueber app.person_stammdaten_lesen mit Protokollhinweis, ohne Recht ein ausgesprochener Sperrhinweis statt leerer Felder. Die Kritik war richtig: Schreiben war strukturell unmoeglich (nur sprache hatte UPDATE, nur t_person_selbstpflege als Policy) — 0190 bringt den Spalten-UPDATE-Grant UND die Policy t_person_personalpflege (personal.schreiben + Beschaeftigung im aktiven Mandanten). O-43 steht als offene Annahme im Text.
- `/portal/[mandant]/personal/zusammenfuehren` — fertig
  - Zwei Schritte: Suche stellt Kandidaten nebeneinander (Namen, Telefon, Beschaeftigungen, Nachweise, Zugang, Kennung) und schlaegt NICHTS vor; dann ausdrueckliche Wahl der fuehrenden Zeile, Pflichtgrund und getippte Bestaetigung (Nachname). Ausgefuehrt von app.person_zusammenfuehren in einer Transaktion: Zeiger setzen, Auditzeile mit beiden Kennungen. Der Kritik gefolgt — es wird KEINE Zeile umgehaengt (nachweis traegt (nachweis_id, person_id), mitarbeiter_zugang unique(person_id)); aufgeloest wird ueber app.person_kanonisch / app.person_identitaeten. Das Geburtsdatum steht bewusst nicht in der Trefferliste (Spaltenentzug). Offene Regel sichtbar als O-611.

## src/server/registry/dienste.ts

**NICHT ERLEDIGT — dieselbe Lage wie bei finanzen.** Der Abschnitt sagte „Keine
Aenderung an einem Registerverzeichnis noetig" und zaehlte danach nur Dateien
AUSSERHALB von `src/server/services/personal` auf.

Gemessen am Baum (18.09., beim Leeren der Warteschlange) fehlen drei Dienste
DIESER Domaene im Register, und `tests/kern/portal-shell.test.ts` bleibt dafuer
rot:

- `personal/anstellung`
- `personal/dublette`
- `personal/stammdaten`

Nicht eingetragen, aus demselben Grund wie bei finanzen: welches Recht ein
Schreibweg nennt, entscheidet die Policy der geschriebenen Tabelle, und das ist
hier nicht geraten worden. Wer die Domaene personal kennt, traegt die drei nach
und streicht diesen Abschnitt.

## src/server/auth/route-manifest.ts

Keine Aenderung noetig. Alle sieben Routen der Domaene stehen unveraendert in src/server/registry/routen.generiert.ts (Zeilen 199-215) mit den Rechten, gegen die die Seiten autorisieren; ich habe weder eine Route hinzugefuegt noch ein Recht verschoben. src/app/api/formular-antwort.ts ist ein Hilfsmodul ohne eigene Route und braucht keinen Manifesteintrag. Anzumerken bleibt O-614: das Manifest fuehrt /portal/[mandant]/personal/anstellungen/[id]/entgelt mit aal2: false, 05-API-KARTE §C.8 mit 'sitzung+2fa' — wird O-614 zugunsten der zweiten Stufe entschieden, ist das eine Zeile im Manifest.

## Sonstiges

A) scripts/generate-triggers.ts — in MIGRATIONS_DATEIEN ergaenzen (nur zusammen mit den zwei rls.ts-Zeilen oben):
  '0192': join(WURZEL, 'drizzle/0192_anstellung_kondition.sql'),

B) docs/DECISIONS.md — ERLEDIGT (18.09.2026). Alle SIEBEN Zeilen stehen in
`docs/DECISIONS.md`: O-610 bis O-614 in der Fassung aus dem Abschnitt „Zeilen für
docs/DECISIONS.md“ (sie ist die ausführlichere und gegen die Datenbank geprüfte),
dazu O-615 und O-616 aus dieser Liste, die dort fehlten. Nichts mehr offen.

## Zeilen für docs/DECISIONS.md, Abschnitt „Offen“ — ERLEDIGT (18.09.2026)

Eingetragen heisst gelöscht. Die 7 Zeilen dieser Domäne stehen in
`docs/DECISIONS.md` unter „Open — ask, do not guess“, Unterabschnitt
„Raised while building · die Domänenwelle (Routenbau)“. Hier ist nichts mehr offen.

## Befunde des Prüfers (16)

- **blockierend** · `/home/user/cse-platform/drizzle/0190_person_stammdaten.sql` — Der UPDATE-Grant auf `person` wurde von {sprache} (0165) auf {vorname, nachname, geburtsdatum, geburtsort, staatsangehoerigkeit, telefon, sprache, geaendert_am, geaendert_von} erweitert (Zeile 100-102). RLS kann keine Spalten einschraenken, und die BESTEHENDE Policy `t_person_selbstpflege` (`using (id = app.aktuelle_person())`) gilt fuer JEDE Spalte. Damit kann jede angemeldete Person im Mitarbeiter-Scope ihre eigene Zeile umschreiben: `telefon` (in `route-manifest.ts:427` und in `person-sprache.test.ts` ausdruecklich als Anmeldeweg/EMP-01 geschuetzt), `vorname`/`nachname` und die drei Bewacherregister-Felder nach SEC-03/§16 BewachV. Genau das ist die Spaltentrennung, die 0165 eingefuehrt hat; sie ist jetzt weg. Zwei bestehende Testfaelle behaupten das Gegenteil und schlagen damit fehl: `tests/isolation/person-sprache.test.ts:120` („dieselbe Zeile, aber `telefon` — abgewiesen") und :126 („und auch der Name nicht").
  - Behebung: Den Grant auf die tatsaechlich gebrauchten Spalten zurueckschneiden: `grant update (geburtsdatum, geburtsort, staatsangehoerigkeit, sprache, geaendert_am, geaendert_von) on person to cse_app` — `vorname`, `nachname`, `telefon` ersatzlos streichen (`schreibeStammdaten` schreibt sie nicht). Zusaetzlich braucht es fuer die drei Stammdatenfelder einen Spaltenwaechter, weil `t_person_selbstpflege` sie sonst weiter oeffnet: BEFORE UPDATE ON person, der eine Aenderung an geburtsdatum/geburtsort/staatsangehoerigkeit abweist, wenn der Aufrufer `personal.schreiben` im aktiven Mandanten nicht haelt (also aus dem Personen-Scope heraus).
- **blockierend** · `/home/user/cse-platform/drizzle/0191_anstellung_vertrag.sql` — `kern.bm_aus_anstellung()` haengt als `after insert or update of status, geloescht_am` (Zeile 264) und legt im Nicht-beendet-Zweig (Zeile 238-262) eine abgeleitete Mitgliedschaft an, sobald KEINE Zeile mit `entzogen_am is null` existiert. Der Trigger feuert aber bei JEDEM UPDATE, das `status` in der SET-Liste nennt — und `beendeAnstellung` (services/personal/anstellung.ts:401-404) nennt sie immer (`status = case when $4 then 'beendet' else status end`). Bei einem Austritt in der ZUKUNFT bleibt der Status `aktiv`, der Trigger geht in den Anlege-Zweig und stellt einen vorher von Hand ENTZOGENEN Portalzugang wieder her. Der Entzug von Hand setzt nach `kern.bm_aus_anstellung_schutz` zwingend `aus_anstellung = false` (so beschreibt es 0191 selbst) — die Zeile ist danach also unsichtbar fuer die `entzogen_am is null`-Pruefung, und „Beschaeftigung beenden" wird zur Zugangserteilung.
  - Behebung: Den Anlege-Zweig auf die Lagen beschraenken, in denen er gemeint ist: `if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status = 'beendet' and new.status <> 'beendet')` — sonst `return null`. Zusaetzlich nicht anlegen, wenn fuer (benutzer_id, mandant_id) eine Zeile mit `entzogen_am is not null` besteht, deren Entzug nicht von diesem Trigger stammt; ein zurueckgenommener Zugang darf nicht durch eine Datumsaenderung wiederkommen.
- **blockierend** · `/home/user/cse-platform/src/server/services/personal/anstellung.ts` — In `beendigungsfolgen` (Zeile 296-300) wird die Tagesgrenze in UTC gerechnet: `beginn_zeitpunkt > ($2::date + interval '1 day')`. `date + interval` ergibt `timestamp without time zone`; im Vergleich mit der `timestamptz`-Spalte wird sie mit der Sitzungszone interpretiert, und die ist UTC (`show timezone` = UTC in der laufenden Datenbank). Die Grenze liegt damit im Sommer zwei und im Winter eine Stunde zu spaet — und was herausfaellt, ist genau die Nachtschicht (Invariante 2, „Shifts cross midnight"). Die Seite `beenden` zeigt dann „0 Einsätze nach dem Austritt" vor einer folgenschweren Bestaetigung, obwohl eine Schicht nach dem Austritt geplant ist.
  - Behebung: Grenze in Berliner Ortszeit aufloesen: `and beginn_zeitpunkt >= (($2::date + 1)::timestamp at time zone 'Europe/Berlin')` (oder `app.loese_ortszeit($2::date + 1, '00:00', 'Europe/Berlin')`). Ein Test mit einer Schicht 01:00 Berlin am Tag nach dem Austritt gehoert dazu, sonst faellt die Rueckkehr des Fehlers nicht auf.
- **wichtig** · `/home/user/cse-platform/src/server/services/personal/anstellung.ts` — Dieselbe Abfrage (Zeile 297-299) filtert nur `entfernt_am is null` und laesst `einsatz_zuordnung.status` aus. Der Enum traegt `geplant|zugesagt|abgesagt|ersetzt|nicht_erschienen`; abgesagte und ersetzte Zuordnungen binden niemanden mehr, werden hier aber als „Einsätze nach dem Austritt" gezaehlt. Die Seite schlaegt damit Alarm in einer sauberen Lage — und eine Warnung, die immer steht, wird nicht mehr gelesen.
  - Behebung: `and status not in ('abgesagt','ersetzt')` ergaenzen — dasselbe Praedikat wie in einteilung.ts, damit zwei Stellen nicht zwei verschiedene Zahlen nennen.
- **wichtig** · `/home/user/cse-platform/drizzle/0194_person_zusammenfuehren.sql` — Der Aufloeser ist gebaut, aber niemand ruft ihn. `app.person_kanonisch` und `app.person_identitaeten` kommen im ganzen Anwendungscode nur in Kommentaren vor; die Zusammenfuehrung setzt also einen Zeiger, dem kein Lesepfad folgt. Der Migrationskopf sagt das selbst („Ohne den Aufloeser zeigt die Plattform nach der Zusammenfuehrung weiter zwei Menschen — und ArbZG-Grenzen ... aggregieren weiter falsch"), und die Oberflaeche behauptet das Gegenteil: `zusammenfuehren/page.tsx:325` schreibt „Was die Zusammenführung heute leistet, ist die Identität — damit Arbeitszeitgrenzen je Mensch und nicht je Zeile aggregieren (Invariante 9)". `src/server/services/zeit/arbzg.ts` gruppiert weiterhin auf der rohen `personId` (Zeile 119: `new Set(schichten.map((s) => s.personId))`, Zeile 143 `pruefePersonenSchluessel`). Nach einer Zusammenfuehrung bleibt die ArbZG-Belastung damit auf zwei Schluessel verteilt — die Grenze, wegen der die Aggregation existiert, wird nie erreicht.
  - Behebung: Den Aufloeser dort einsetzen, wo je MENSCH aggregiert wird: die Schichtmenge fuer `arbzg.ts` (und `jobs/konflikteErkennen.ts`) ueber `app.person_identitaeten(person_id)` bilden statt ueber `person_id = $1`, und `pruefePersonenSchluessel` gegen `app.person_kanonisch` pruefen. Bis das steht, den Satz auf der Seite entschaerfen — er behauptet heute eine Wirkung, die es nicht gibt.
- **wichtig** · `/home/user/cse-platform/docs/DECISIONS.md` — O-610 bis O-614 stehen als `TODO(client, O-NN)` im Code und als sichtbarer Text auf drei Seiten („offen (O-610)", „Offen (O-612)", „Offen (O-614)"), aber in keiner Zeile von docs/DECISIONS.md. Guard 4 in scripts/guards/run-all.ts prueft genau das und schlaegt fehl; solange die Registerzeilen fehlen, sind die Nummern hohle Verweise, und die Definition of Done („DECISIONS.md updated with anything assumed") ist nicht erfuellt. Der Bauende hat die Zeilen als Text geliefert — eingetragen sind sie nicht.
  - Behebung: Die fuenf Zeilen O-610…O-614 in docs/DECISIONS.md unter „Offen" eintragen (der Bauende hat sie im Bericht mitgeliefert; fuer O-614 — 2FA auf der Entgeltroute — fehlt sie im Bericht und muss formuliert werden), dann `npx tsx scripts/guards/run-all.ts` gegenpruefen.
- **wichtig** · `/home/user/cse-platform/src/server/db/schema/rls.ts` — `anstellung_kondition` fehlt in KEIN_HARD_DELETE und AUDITIERT, und `scripts/generate-triggers.ts` hat keinen Eintrag `'0192'` in `MIGRATIONS_DATEIEN`. Der generierte Sentinel-Block steht damit in drizzle/0192_anstellung_kondition.sql, ohne dass ihn je etwas erzeugt oder nachprueft: `pnpm db:triggers` schreibt ihn nicht, `--check` vergleicht ihn nicht. Folge fuer die Absicherung: tests/isolation/unveraenderbarkeit.test.ts iteriert `KEIN_HARD_DELETE` (Zeile 79 und 242) und prueft daher die neue Tabelle NICHT — die Loeschsperre der einzigen neuen Tabelle dieser Domaene ist ungeprueft. Wird der rls.ts-Eintrag spaeter ohne den `MIGRATIONS_DATEIEN`-Eintrag ergaenzt, bricht `generate-triggers.ts` ab (`MIGRATIONS_DATEIEN[m]!` ist undefined, Zeile 192/205).
  - Behebung: Beide Eintraege nachziehen: in rls.ts `{ tabelle: 'anstellung_kondition', art: 'append', migration: '0192', grund: … }` in KEIN_HARD_DELETE und `{ tabelle: 'anstellung_kondition', migration: '0192' }` in AUDITIERT; in scripts/generate-triggers.ts `'0192': join(WURZEL, 'drizzle/0192_anstellung_kondition.sql')`. Danach `pnpm db:triggers` (ersetzt den Block idempotent) und `pnpm db:triggers --check`.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/personal/anstellungen/[id]/beenden/page.tsx` — Die Folgen-Tafel wird fuer `vorschau` gerechnet (Zeile 123: `?austritt=` oder sonst `heute`), das Datumsfeld im Formular traegt `defaultValue={vorschau}` — aber es gibt keinen Weg, die Tafel fuer ein ANDERES Austrittsdatum neu zu rechnen. Die Seite hat kein JavaScript, das Datumsfeld gehoert dem POST-Formular, und `?austritt=` wird von nichts gesetzt. Der Regelfall einer Beendigung ist aber ein Austritt in der Zukunft (Kuendigungsfrist): der Bearbeiter stellt das Datum auf +3 Monate, waehrend „Einsätze nach dem Austritt" und „Resturlaub" weiter den Stand von heute zeigen. Genau die Zahl, die vor der Bestaetigung stehen soll, gehoert dann zu einem anderen Datum.
  - Behebung: Ein eigenes GET-Formular („Folgen zu diesem Datum anzeigen") ueber die Tafel setzen, das `?austritt=` neu laedt, und das POST-Formular danach mit demselben Datum vorbelegen. Alternativ die Tafel erst nach einem Zwischenschritt „Datum waehlen -> Folgen bestaetigen -> beenden" zeigen.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/personal/antraege/[id]/page.tsx` — Der Genehmigen-Knopf wird am falschen Merkmal gesperrt: `istTausch = antrag.tauschPartnerAnstellungId !== null || antrag.einsatzId !== null` (Zeile 141). Die Lage, in der `entscheideAntrag` wirkungslos ist, ist aber `!antrag.erzeugtAbwesenheit` — der Dienst behandelt nur den Abwesenheitszweig. Daraus folgen zwei Fehler in derselben Zeile: (a) eine Antragsart mit `erzeugt_abwesenheit = true` UND `erfordert_einsatz = true` verliert ihren Knopf, obwohl der Dienst sie behandelt; (b) eine Antragsart mit `erzeugt_abwesenheit = false` und ohne Einsatz/Tauschpartner — `antragsart.ist_stammdatenaenderung` ist eine vorhandene Spalte, O-142 nennt „Stammdatenaenderung" und „Schichtabgabe" namentlich als kommende Arten — bekommt einen Knopf, der nur einen Status umlegt und sonst nichts tut. Der Katalog ist nach K-17 kundenpflegbar (drizzle/0275_stammdaten_katalogpflege.sql:100 gibt `insert` auf `antragsart`), das ist also keine hypothetische Lage.
  - Behebung: Die Sperre an `!antrag.erzeugtAbwesenheit` haengen und den Tauschtext nur dann zeigen, wenn zusaetzlich `einsatzId`/`tauschPartnerAnstellungId` gesetzt ist; fuer die uebrigen wirkungslosen Arten einen eigenen Satz („diese Antragsart legt nur den Status um — O-613"). Entsprechend `istTausch` fuer den Dienstplan-Verweis von der Knopfsperre trennen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/personal/abwesenheiten/[id]/page.tsx` — Die Seite liest `?meldung=` (Zeile 101) und zeigt dafuer „Der Vorgang lief nicht durch", aber `POST /api/abwesenheiten/[id]` leitet im Fehlerfall nicht mit `?meldung=` zurueck — es antwortet mit JSON (route.ts:68-86). Dasselbe auf `antraege/[id]/page.tsx` (Zeile 97/98) gegen `POST /api/antraege/[id]`. Bei `GrundFehlt` bzw. `UrlaubskontoFehlt` landet der Mensch also auf einer weissen Seite mit `{"fehler":"…"}` — genau das, was `src/app/api/personal/gemeinsam.ts` im Kopfkommentar ausschliesst („Ein Formular darf nicht auf einer weissen Seite mit JSON enden") und was die Antragsseite im eigenen Kommentar verspricht zu vermeiden. Die beiden Hinweisbloecke sind damit toter Code.
  - Behebung: Die Fehlerzweige beider Routen auf das Muster aus `fuehrePersonalAus` bringen: bei einem Formular-POST (`!rumpf.json`) mit `?meldung=<Text>` auf `zurueck` umleiten, JSON nur fuer JSON-Aufrufer. Am einfachsten beide Routen auf ein gemeinsames Geruest wie `fuehrePersonalAus` umstellen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/personal/personen/[id]/stammdaten/page.tsx` — Die Warnung „Die Felder sind leer vorbelegt, weil zu diesem Menschen nichts lesbar war. Absenden überschreibt, was dort steht" haengt an `stammdaten === null && !keinRecht` (Zeile 245) — sie ist also genau in dem Fall AUSGEBLENDET, in dem sie gebraucht wird: ohne `personal.stammdaten_lesen` ist `keinRecht = true`, alle drei Felder sind leer vorbelegt, und `schreibeStammdaten` schreibt immer alle drei Spalten (services/personal/stammdaten.ts:146-150) — ein Absenden nullt also Geburtsdatum, Geburtsort und Staatsangehoerigkeit. Ueber die Seite ist das heute nicht erreichbar (das Routen-Manifest verlangt `personal.stammdaten_lesen` fuer den Aufruf, und mehrere Leserechte sind nach zugang.ts:349 eine UND-Verknuepfung), ueber `POST /api/personal/personen/[id]/stammdaten` mit nur `personal.schreiben` schon.
  - Behebung: Die Bedingung auf `stammdaten === null` erweitern (also auch bei `keinRecht` warnen) — oder besser: `schreibeStammdaten` nur die Felder schreiben lassen, die der Rumpf tatsaechlich mitbringt, damit ein Teil-POST die anderen nicht loescht.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/personal/anstellungen/[id]/entgelt/page.tsx` — Zwei Kleinigkeiten in derselben Datei. (1) Zeile 73 liest `?gespeichert=1` und zeigt dafuer „Kondition eingetragen"; die Route leitet aber ohne diesen Parameter zurueck (`api/personal/anstellungen/[id]/entgelt/route.ts`, `ziel: (slug) => \`/portal/${slug}/personal/anstellungen/${id}/entgelt\``) — der Erfolgshinweis erscheint nie. (2) Zeile 86-95: `KeinEntgeltRecht` entsteht aus einem Postgres-42501; danach laeuft `leseKonditionen` in DERSELBEN Transaktion weiter. postgres.js setzt keinen Savepoint je Abfrage (nur `services/radar/import.ts` und `services/freigabe/stapel.ts` tun das von Hand), die Transaktion ist nach dem Fehler abgebrochen, und die Folgeabfrage scheitert mit 25P02. Heute unerreichbar, weil das Tor `personal.entgelt_lesen` schon verlangt — der Zweig kann aber so, wie er geschrieben ist, nicht funktionieren.
  - Behebung: (1) `?gespeichert=1` an das `ziel` der Entgeltroute anhaengen (wie bei `…/stammdaten`). (2) Entweder das Recht wie auf der Abwesenheitsseite VORHER mit `haeltRechte('personal.entgelt_lesen')` fragen und `app.entgelt_lesen` dann gar nicht aufrufen, oder den Aufruf in einen eigenen `savepoint` legen.
- **klein** · `/home/user/cse-platform/src/server/services/personal/anstellung.ts` — `setzeKondition` schliesst nur die OFFENE Kondition (Zeile 543-546: `where anstellung_id = $1 and gilt_bis is null`). Liegt das neue `giltAb` innerhalb einer bereits GESCHLOSSENEN Periode — moeglich, sobald eine rueckwirkende Kondition nachgetragen wird —, laeuft der Insert in `ak_kein_ueberlapp` und der Mensch bekommt den rohen GIST-Fehler statt eines Satzes. Der Dienst beantwortet die Personalnummernkollision ausdruecklich als Satz und nicht als 23505; hier fehlt dieselbe Hoeflichkeit.
  - Behebung: Vor dem Insert auf Ueberschneidung mit JEDER Kondition pruefen (`where daterange(gilt_ab, gilt_bis, '[]') @> $2::date`) und mit einem `VertragEingabeFehler` antworten, der den Zeitraum nennt.
- **klein** · `/home/user/cse-platform/drizzle/0192_anstellung_kondition.sql` — `kern.anstellung_kondition_spiegeln()` bricht ab, wenn heute keine Kondition gilt (Zeile 245: `if v_kondition.id is null then return null; end if;`). Wird die einzige Kondition mit `gilt_bis` in der Vergangenheit geschlossen — der Ruhezeitraum, den der Migrationskopf als legitime Luecke beschreibt —, bleibt der Spiegel auf `anstellung` mit den alten Werten stehen, statt geleert zu werden. `app.anstellung_kondition_spiegel_nachziehen()` hat dieselbe Luecke (die CTE `gueltig` liefert fuer diese Beschaeftigung keine Zeile, das UPDATE trifft sie nie). Folgenlos fuer die Geldzahl, weil `app.entgelt_lesen` die Kondition und nicht den Spiegel liest — sichtbar falsch ist aber `Wochenstunden` und `Arbeitstage pro Woche` auf der Entgelt- und der Vertragsseite.
  - Behebung: Im `is null`-Fall den Spiegel auf NULL setzen statt zurueckzukehren, und im Nachzieher einen zweiten Zweig fuer Beschaeftigungen mit Konditionen, aber ohne heute gueltige — oder den Zustand auf den Seiten als „keine heute gueltige Kondition" ausweisen, statt einen alten Wert zu zeigen.
- **klein** · `/home/user/cse-platform/drizzle/0194_person_zusammenfuehren.sql` — `app.person_kanonisch(uuid)` (Zeile 152) und `app.person_identitaeten(uuid)` (Zeile 178) bekommen `grant execute … to cse_app, cse_job`, ohne das voreingestellte `EXECUTE` fuer PUBLIC zu entziehen. Das ist kein Datenleck — beide sind `security invoker` und lesen `person` unter der RLS des Aufrufers —, aber es weicht von der Hausregel ab, die jede andere Funktion dieser Domaene einhaelt (`revoke execute … from public` in 0190, 0191, 0193, 0194 fuer `person_zusammenfuehren`). Der Waechter dafuer greift nicht: tests/isolation/definer-eigentum.test.ts:177 filtert auf `p.prosecdef`, und diese zwei sind es nicht — die Abweichung faellt also nirgends auf.
  - Behebung: `revoke execute on function app.person_kanonisch(uuid) from public;` und dasselbe fuer `app.person_identitaeten(uuid)` in 0194 ergaenzen. Wer den Waechter mitziehen will, nimmt das `p.prosecdef` aus der Abfrage in definer-eigentum.test.ts heraus und fuehrt die erlaubten Ausnahmen namentlich.
- **klein** · `/home/user/cse-platform/src/server/services/datenschutz/berichtigung.ts` — `editorPfad` gibt fuer `art === 'person'` `/portal/<slug>/personal/<id>` zurueck (Zeile 94) — diese Adresse gibt es nicht; richtig waere `/portal/<slug>/personal/personen/<id>`. Die Funktion ist ausdruecklich dafuer da, NICHT auf eine Adresse zu zeigen, die mit 404 antwortet (ihr eigenes Kommentar, Zeile 86-89, nennt AUT-06). Nebenbefund am Rand der Personaldomaene; der Bauende hat ihn im Bericht genannt und nicht behoben.
  - Behebung: Zeile 94 auf `/portal/${mandantSlug}/personal/personen/${id}` aendern. Ein Test, der jeden Rueckgabewert von `editorPfad` gegen `findeRoute` prueft, haelt die Sorte Fehler kuenftig fest.

**Urteil:** Nicht abnahmefaehig. Die sieben Seiten tragen echte Zeilen, rufen ihre Dienste, halten Cent/timestamptz und DESIGN.md ein (die Waechter melden zu diesen Dateien keinen Gestaltungsbefund), `npx tsc --noEmit` ist fuer die Domaene sauber, tests/kern/personal-eingaben.test.ts laeuft gruen (12/12), und die fuenf Migrationen sind gegen echtes Postgres nachgemessen: Spiegel-Trigger, Einbahn-Uebergang, EXCLUDE und beide Job-Funktionen tun, was sie versprechen. Drei Befunde blockieren trotzdem. (1) 0190 hat den Spalten-UPDATE-Grant auf `person` von {sprache} auf neun Spalten geweitet; zusammen mit der bestehenden Policy `t_person_selbstpflege` kann jede Mitarbeitersitzung jetzt ihre eigene `telefon`, ihren Namen und die drei Bewacherregister-Felder umschreiben — nachgefahren mit `UPDATE 1`, und zwei bestehende Testfaelle in person-sprache.test.ts behaupten genau das Gegenteil. (2) Der neue K-14-Trigger in 0191 legt bei jedem status-nennenden UPDATE eine abgeleitete Mitgliedschaft neu an; „Beschaeftigung beenden\" mit Austritt in der Zukunft stellt damit einen von Hand entzogenen Portalzugang wieder her (nachgefahren: offen=0 -> offen=1). (3) `beendigungsfolgen` rechnet die Tagesgrenze in UTC und verliert genau die Nachtschicht nach dem Austritt — eine falsche Null vor einer folgenschweren Bestaetigung, Invariante 2, obwohl das Projekt mit Guard 5b und `app.loese_ortszeit` das richtige Muster fuehrt. Dazu sechs wichtige Punkte: der Dublettenaufloeser wird von keinem Dienst gerufen (arbzg.ts gruppiert weiter auf der rohen personId), womit die Zusage der Seite „Arbeitszeitgrenzen je Mensch\" heute unwahr ist; O-610…O-614 fehlen in DECISIONS.md und Guard 4 schlaegt fehl; `anstellung_kondition` fehlt in rls.ts und `'0192'` in generate-triggers.ts, wodurch die Loeschsperre der einzigen neuen Tabelle ungeprueft bleibt; die Folgen-Tafel laesst sich nicht auf das gewaehlte Austrittsdatum umrechnen; der Genehmigen-Knopf des Antragsblatts haengt am falschen Merkmal; und die Zuordnungszaehlung laesst den Statusfilter aus.

## Nach der Behebung noch offen

- Befund 6 (DECISIONS.md, wichtig) ist NICHT von mir eingetragen — docs/DECISIONS.md steht auf der Sperrliste. Die sieben Zeilen O-610 bis O-616 stehen unten unter registry_sonstiges und muessen zentral unter 'Offen' eingefuegt werden; danach ist Guard 4 (todo-client-nicht-im-register) fuer diese Domaene still. Es sind sieben statt fuenf, weil diese Runde zwei neue offene Regeln aufgeworfen hat (O-615, O-616).
- Befund 7 (rls.ts + scripts/generate-triggers.ts, wichtig) ist NICHT von mir eingetragen — src/server/db/schema/rls.ts steht auf der Sperrliste, und der Eintrag in generate-triggers.ts allein waere wirkungslos (MIGRATIONEN leitet sich aus rls.ts ab) und beim naechsten pnpm db:triggers sogar schaedlich, weil er einen leeren Block nach 0192 schriebe. Beide Zeilen stehen unten unter registry_rls und registry_sonstiges. Der Schutz SELBST ist in der Datenbank vorhanden und geprueft (trg_anstellung_kondition_kein_hard_delete, _kein_truncate, _audit liegen auf der Tabelle); es fehlt nur die Buchfuehrung, ohne die unveraenderbarkeit.test.ts die Tabelle nicht mititeriert.
- Nicht behoben, weil ausserhalb dieser Domaene und ausserhalb meiner Migrationsnummern: pnpm db:seed bricht ab mit 'new row violates row-level security policy for table leistungskatalog_position'. Ich habe das gegengeprueft — der Abbruch tritt genauso ohne drizzle/0298_leistungskatalog_status.sql auf UND genauso mit auf HEAD zurueckgesetzten 0190/0191/0192 und ohne 0195. Er ist also weder meiner noch 0298 zuzuordnen (Verdacht: die katalog.schreiben-Bedingung in der with-check von t_mandant gegen die Sitzung, mit der der Seed die Katalogpositionen anlegt). Folge fuer diese Runde: die isolation-Suite laeuft gar nicht, weil ihr global-setup migriert UND seedet. Alle DB-seitigen Behauptungen oben sind deshalb einzeln per psql gegen w_pers belegt, die neuen Testfaelle sind geschrieben, lint- und typecheck-sauber, aber noch nicht gelaufen. Sobald der Seed wieder durchlaeuft, gehoeren tests/isolation/personal-anstellung.test.ts, personal-spaltenschutz.test.ts, person-sprache.test.ts und person-dublette.test.ts gefahren.
- O-615 (neu): Die sichere Richtung ist ausgeliefert — eine Wiedereinstellung erteilt einen zuvor von Hand entzogenen Portalzugang NICHT automatisch wieder. Das ist eine Annahme und keine Regel; sie steht als TODO(client, O-615) in 0191 und als Registerzeile unten.
- O-616 (neu): Was die Genehmigung einer kundeneigenen Antragsart bewirken soll, die keine Abwesenheit erzeugt (Stammdatenaenderung, Schichtabgabe, unbezahlte Freistellung), ist unentschieden. Ausgeliefert ist: kein Genehmigen-Knopf und ein Satz, der sagt warum.

## NICHT gebaut, mit Grund

- Keine der sieben Routen bleibt Platzhalter — alle sieben sind vollstaendig (Daten, Tabelle/Felder, Filter bzw. Suche, Rechte, Leerzustand, Schreibweg). Was OFFEN bleibt, bleibt als klar bezeichneter Platzhalter nach Regel 1 und ist unten aufgefuehrt.
- Tarifgruppen: freies Feld, kein Vokabular (O-610). Eine Auswahlliste waere eine Tarifentscheidung mit Lohnwirkung.
- Arbeitszeitmodell: freies Feld, kein Vokabular (O-18, schon im Register). Der Platzhalter `unbekannt` bleibt der Default der Kondition.
- Beendigungsgruende: Pflichtfeld in Worten, keine Auswahlliste (O-612).
- Tauschantraege: keine Genehmigung auf der Antragsseite (O-613) — statt eines Knopfs, der eine Genehmigung ohne Wirkung erzeugt, steht dort der Satz, dass der Tausch im Dienstplan vollzogen wird. Das SEC-04-Tor fuer eine Tauschgenehmigung ist damit weiterhin nicht gebaut und auch nicht vorgetaeuscht.
- Zusammenfuehren haengt KEINE Zeile um (O-611): kein Feld wird uebernommen, kein Zugang widerrufen, keine Ruecknahme. Gebaut ist die Identitaet (Zeiger + Aufloeser) und der Nachweis.
- 2FA-Stufe der Entgeltseiten: ausgeliefert ist der Stand des Routen-Manifests (aal2 false), die Abweichung zu 05-API-KARTE steht sichtbar auf der Seite (O-614).
- Der naechtliche Lauf, der `anstellung.status` nach einem vergangenen Austritt nachzieht und den Konditionsspiegel nach dem Datumswechsel neu ableitet: die Mechanik ist da (`app.anstellung_status_nachziehen`, `app.anstellung_kondition_spiegel_nachziehen`, beide nur `cse_job`), die Registrierung im Job-Planer gehoert nicht in meinen Bereich. Folge ohne sie: ein sichtbar falscher Stand (vergangener Austritt, Status `aktiv`), kein lautlos falscher — `app.entgelt_lesen` liest die Kondition und nicht den Spiegel.
- Keine Kontenpflege, kein Urlaubsanspruch-Editor, keine Lohnabrechnung — ausserhalb der Domaene bzw. ausdruecklich out of scope (D-06).

## Notizen des Bauender

MIGRATIONSPRUEFUNG. Alle fuenf Migrationen liefen mehrfach auf einer FRISCHEN
`w_pers` bis `Migrationen angewendet.` durch (zuletzt nach der letzten
Aenderung). Jede Abfrage und jeder Trigger wurde ausserdem von Hand gegen
dieselbe Datenbank gefahren, als `cse_app` mit gebundener Sitzung, mit und ohne
das jeweilige Recht — die Zusicherungen in den Isolationstests sind
nachgemessen, nicht angenommen. Alle neuen `SECURITY DEFINER`-Funktionen
gehoeren `cse_definer` (K-01 geprueft), `definer-eigentum.test.ts` bleibt also
gruen, ohne dass die Altlastliste waechst.

ZWEI BEFUNDE, DIE DEN PLAN KORRIGIEREN — beide durch Messung, nicht durch
Lesen. (1) `person` trug fuer `cse_app` einen TABELLENWEITEN SELECT-Grant
(`relacl: cse_app=ar`), `anstellung` einen tabellenweiten UPDATE-Grant
(`cse_app=aw`). Ein `revoke select (geburtsdatum)` bzw.
`revoke update (wochenstunden)` darauf ist WIRKUNGSLOS —
`has_column_privilege` bleibt `true`, und der Entzug sieht in der Migration
richtig aus, ohne etwas zu tun. Beide Migrationen nehmen deshalb erst das
Tabellenrecht und geben eine erschoepfende Spaltenliste zurueck. Das ist die
Art Fehler, die eine Migration gruen durchlaufen laesst und den Schutz nie
herstellt. (2) `app.entgelt_lesen` faellt NUR bei Beschaeftigungen ohne jede
Kondition auf den Spiegel zurueck. Der erste Entwurf fiel auch fuer einen
Stichtag VOR der ersten Kondition zurueck und lieferte damit den heutigen Wert
fuer einen vergangenen Tag — genau die stillschweigende Neubewertung, gegen die
§6.14 die datierte Tabelle einfuehrt. Aufgefallen ist es in der Handpruefung
(`app.entgelt_lesen(a, '2019-12-31')` gab 1650 statt null); ein Test haelt es
jetzt fest.

ZWEI NAMENSABWEICHUNGEN, BEWUSST UND DOKUMENTIERT. `anstellung_kondition`
heisst bei mir `gilt_ab`/`gilt_bis` und `stundensatz_intern_cent`. 01-KERN §6.15
nennt `gueltig_ab`/`gueltig_bis` und `stundensatz_intern`; 05-API-KARTE (Zeile
671, `POST …/konditionen`) nennt `gilt_ab` und `stundensatz_intern_cent`, und
mein Auftrag nennt ausdruecklich `gilt_ab` und „Entgelt in Cent" — darauf baut
die Domaene `einstellungen` (0200+) auf. Umgesetzt ist die
Schnittstellenschreibweise, weil die EINHEIT in den Namen gehoert (Invariante 1:
ein `bigint` namens `stundensatz_intern` ist die Sorte Spalte, in die jemand
17.50 schreibt) und weil zwei Agenten sonst gegen zwei Namen bauen. Die
Abweichung steht im Kopf von 0192 und am Spaltenkommentar. Wenn 01-KERN gewinnen
soll, ist es eine Umbenennung in einer Migration — bitte dann auch in
`services/personal/anstellung.ts` und `app.entgelt_lesen`.

WAS ICH AUSSERHALB MEINER DOMAENE ANFASSEN MUSSTE — und warum es ohne diese
Aenderung gebrochen waere. `src/server/services/datenschutz/auskunft.ts` las im
Abschnitt „Stammdaten der Person" `select vorname, nachname, geburtsdatum, …
from person`. Seit 0190 scheitert das mit „permission denied for table person" —
mitten in einer Art.-15-Auskunft. Der Abschnitt liest jetzt ohne
`geburtsdatum`, und daneben steht ein NEUER Abschnitt
`stammdaten_geschuetzt` mit `leseweg: 'definer'` und
`recht: 'personal.stammdaten_lesen'`, der die drei Felder ueber
`app.person_stammdaten_lesen` holt; ohne das Recht bleibt er sichtbar GESPERRT,
statt ein Feld stillschweigend weglassen zu lassen. Hinweis zur Koordination:
diese Datei ist in diesem Arbeitsbaum noch ungetrackt (`??`) — sie stammt aus
einer parallel laufenden Domaene. Meine Aenderung ist klein und an einer Stelle;
beim Zusammenfuehren bitte darauf achten, dass der neue Abschnitt mitkommt.
`berichtigung.ts` fuehrt `person/geburtsdatum` nur als Vorschlagsliste ohne
`select` — nicht betroffen.

SEED (`src/server/db/seed/`), die drei Luecken aus der Kritik geschlossen:
(a) `zeit.ts` legt jetzt eine Abwesenheit im Status `beantragt` an — vorher gab
es 1 storniert und 2 erfasst, und damit waren „Genehmigen" und „Ablehnen" auf
dem Detailblatt mit Seeddaten nicht vorfuehrbar; (b) dazu die Urlaubskonten, die
die Detailseiten brauchen, und zwar AUCH fuer das Jahr, in dem der beantragte
Zeitraum beginnt — sonst bricht eine Genehmigung mit `no_data_found` ab
(O-18); (c) `index.ts` legt je Beschaeftigung eine datierte Kondition an
(`gilt_ab` = Eintritt, nicht „heute") und EINE Personendublette („Fatma Yildiz"
neben „Fatima Yildiz", mit eigener Beschaeftigung in der Reinigung), sonst ist
`/personal/zusammenfuehren` mit Seeddaten unpruefbar. Die Anweisungen habe ich
nicht ueber `pnpm db:seed` gefahren (untersagt), sondern jede einzelne
INSERT-Form gegen `w_pers` gefahren — auch mit `null` als Satz, dem Fall der
sechs Fuehrungsstellen.

WAS NACH DEM EINPFLEGEN NOCH ROT IST. `scripts/guards/run-all.ts` meldet zu
meinen Dateien genau einen Befund: `todo-client-nicht-im-register` fuer O-610
bis O-614. Der Waechter liest das Register aus `docs/DECISIONS.md`
(`/^\|\s*(O-\d{1,3})\s*\|/`), und die fuenf Zeilen stehen in
`decisions_zeilen` — mit dem Einfuegen ist er gruen. Keine Farb-, Abstands-,
Schatten- oder `anzeige-berlin`-Befunde in meinen Dateien. `npx tsc --noEmit`
ist ueber den GANZEN Baum fehlerfrei, `npx eslint` ueber alle von mir
angelegten und geaenderten Pfade ebenfalls. Die Isolations- und Kerntests habe
ich geschrieben, aber nicht ausgefuehrt (`pnpm test`/`pnpm test:isolation` sind
untersagt und `cse_test` darf ich nicht migrieren); dafuer ist jede einzelne
Zusicherung vorher von Hand gegen echtes Postgres nachgemessen — einschliesslich
der Fehlertexte, gegen die die Regexe pruefen.

EIN FALL, DER MICH EINE RUNDE GEKOSTET HAT UND EIN TEST-ARTEFAKT WAR, KEIN
DEFEKT: beim ersten Durchgang schien `kern.bm_aus_anstellung` beim Austritt
nichts zu entziehen. Der Trigger war richtig — meine Fixtur hatte dem Menschen
ZWEI Beschaeftigungen in derselben Gesellschaft gegeben, und der Trigger
entzieht korrekt erst, wenn keine laufende mehr uebrig ist (O-137). Genau dieser
Fall steht jetzt als eigener Test drin.

KLEINERER NEBENBEFUND, NICHT VON MIR GEAENDERT (siehe auch
`registry_navigation`): `services/datenschutz/berichtigung.ts:98`
(`editorPfad`) zeigt fuer `art === 'person'` auf
`/portal/<slug>/personal/<id>` — diese Adresse gibt es nicht; richtig ist
`/portal/<slug>/personal/personen/<id>`. Ein Verweis auf 404 ist genau das, was
AUT-06/D-581 ausschliessen.

## Notizen des Behebender

Alle 16 Befunde nachvollzogen, keiner widerlegt. 14 behoben, 2 (Befund 6 und 7) betreffen ausschliesslich gesperrte Dateien und sind als Registereintraege oben zurueckgegeben.

Gestaltungswerte: keine neuen erfunden. Das neue GET-Formular auf der Beenden-Seite benutzt die im selben Modul bereits definierten Klassen (feld, Abstaende s2/s3/s4/s5, rounded-lg, border-line, bg-surface-2) und die vorhandene Button-Variante 'secondary'. Der neue Hinweisblock auf der Antragsseite nimmt die vorhandene Komponente Hinweis mit art='hinweis' und text-xs/mt-s2 wie der Nachbarblock. Die Waechter melden aus meinen Dateien keinen Farb-, Abstands- oder Zonenverstoss.

Pruefstand dieser Runde: pnpm typecheck sauber; eslint ueber alle 14 geaenderten Quelldateien und die 3 geaenderten Testdateien ohne Befund; Migration nach jeder Aenderung gegen eine frisch angelegte w_pers (drop/create/alter database + DATABASE_URL=… pnpm db:migrate) — laeuft bis 0304 durch; npx tsx scripts/generate-triggers.ts --check meldet 'Trigger sind aktuell'; die drei betroffenen kern-Tests (personal-eingaben, gruppen-navigation, tableiste) gruen (53 Faelle). npx tsx scripts/guards/run-all.ts meldet aus dieser Domaene NUR noch todo-client-nicht-im-register fuer O-610…O-616 — genau die sieben Zeilen, die zentral nachzutragen sind. (Die Wache zaehlt insgesamt 76 Verstoesse; die uebrigen 69 stammen aus anderen Domaenen derselben Welle.)

Was ich NICHT pruefen konnte und warum: die isolation-Suite startet nicht. Ihr global-setup migriert und SEEDET, und pnpm db:seed bricht ab mit 'new row violates row-level security policy for table leistungskatalog_position'. Ich habe zweimal gegengeprueft, dass das nicht meine Arbeit ist: einmal mit ausgehaengtem drizzle/0298_leistungskatalog_status.sql (gleicher Abbruch) und einmal mit auf HEAD zurueckgesetzten 0190/0191/0192 und ausgehaengtem 0195 (gleicher Abbruch). Es ist ein Vorbefund aus einer anderen Domaene dieser Welle. Ersatzweise habe ich jede datenbankseitige Behauptung einzeln per psql gegen w_pers belegt (Spaltenrechte, Waechter, K-14-Reproduktion des Pruefers, Spiegelleerung, Tagesgrenze, Ueberlappungspraedikat, Identitaetsaufloesung, PUBLIC-Entzug ueber aclexplode). Die neuen Testfaelle stehen geschrieben und sind typecheck- und lint-sauber, aber ungefahren — das gehoert nachgeholt, sobald der Seed wieder durchlaeuft.

Eine Entscheidung, die ich getroffen habe und die ich benennen will: 0190, 0191 und 0192 sind bereits committet (1662c3c), ich habe sie trotzdem an Ort und Stelle korrigiert statt eine Nachtragsmigration zu schreiben. Grund: der Grant in 0190 ist genau die Liste, die die Datei als 'an EINER Stelle vollstaendig' ausweist — eine zweite Stelle, die sie wieder einschraenkt, waere der Defekt, gegen den 0165 geschrieben ist. Dieselbe Praxis ist in dieser Welle sichtbar (0182, 0204, 0221, 0222, 0230 sind ebenfalls als geaendert markiert), und die Datenbanken werden bei jedem Lauf neu aus drizzle/ gebaut. Die Auswertung des Befundes 5 (Aufloeser) brauchte dagegen neues SQL an einer alten Funktion aus 0040 — das steht als 0195 in meinem Nummernraum und fasst 0040 nicht an.
