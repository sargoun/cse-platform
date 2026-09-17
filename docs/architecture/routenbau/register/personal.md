# Registereintraege: personal

Diese Eintraege hat der bauende Agent geliefert; sie sind **noch nicht** eingefuegt.
Die gemeinsamen Dateien pflegt EINE Hand, weil acht Agenten gleichzeitig im Baum
arbeiten und sich sonst in dieselbe Zeile schreiben. Ist ein Eintrag eingefuegt,
verschwindet er hier — diese Datei ist eine Warteschlange, kein Archiv.

## Migrationen (alle gegen eine eigene Datenbank gefahren: True)

- drizzle/0190_person_stammdaten.sql — person.geburtsort + person.staatsangehoerigkeit char(2) mit CHECK; TABELLENWEITER SELECT-Grant auf person fuer cse_app entzogen und als erschoepfende Spaltenliste ohne die drei Stammdatenfelder zurueckgegeben (ein Spalten-Revoke war wirkungslos, weil relacl 'cse_app=ar' trug — nachgemessen); Spalten-UPDATE-Grant fuer die drei Felder; Policy t_person_personalpflege (personal.schreiben + Beschaeftigung im aktiven Mandanten, not ist_readonly); Definer app.person_stammdaten_lesen(uuid) mit Rechtepruefung, AUT-06-Verhalten und Auditzeile mit Rechtsgrundlage; cse_definer-Grants und d_person_stammdaten-Policy.
- drizzle/0191_anstellung_vertrag.sql — anstellung.austritt_grund, .tarifgruppe, .arbeitstage_woche, .kostenstelle; TABELLENWEITER UPDATE-Grant entzogen und ohne den Spiegelsatz (arbeitszeitmodell, wochenstunden, arbeitstage_woche, stundensatz_intern, tarifgruppe, kostenstelle) zurueckgegeben; SELECT auf austritt_grund/arbeitstage_woche/kostenstelle, NICHT auf tarifgruppe (K-05); Trigger kern.anstellung_status_uebergang (beendet ist einwegs, nur der UEBERGANG wirft); die fehlende K-14-Haelfte kern.bm_aus_anstellung (legt die abgeleitete Mitgliedschaft an, wenn keine laufende besteht, und entzieht nur aus_anstellung-Zeilen — mit aus_anstellung=false im selben UPDATE, weil kern.bm_aus_anstellung_schutz sonst wirft); app.anstellung_status_nachziehen() fuer cse_job.
- drizzle/0192_anstellung_kondition.sql — Tabelle anstellung_kondition (mandant_id, anstellung_id als zusammengesetzter FK, gilt_ab/gilt_bis, arbeitszeitmodell, wochenstunden, arbeitstage_woche, stundensatz_intern_cent bigint, tarifgruppe, kostenstelle, grund, erstellt_am/erstellt_von), EXCLUDE USING gist gegen zwei gleichzeitig gueltige Konditionen, RLS (Lesen personal.lesen, Schreiben personal.entgelt_schreiben, Gruppe, t_person-Selbstzugriff, K-04-Decken, cse_definer), Spaltengrants ohne SELECT auf stundensatz_intern_cent/tarifgruppe, Trigger kern.anstellung_kondition_spiegeln (der EINE Schreiber des Spiegels, spiegelt nur die heute gueltige Kondition), app.anstellung_kondition_spiegel_nachziehen() fuer den Datumswechsel, Loeschsperre + Auditblock zwischen den Sentinels.
- drizzle/0193_entgelt_lesen_haerten.sql — app.entgelt_lesen(uuid, date): prueft personal.entgelt_lesen UND den aktiven Mandanten (42501 ohne Recht, null bei fremder Gesellschaft — AUT-06), liest die am Stichtag gueltige Kondition, faellt nur bei Beschaeftigungen OHNE jede Kondition auf den Spiegel zurueck, protokolliert mit Stichtag und Quelle. app.anstellung_entgelt_lesen(uuid) bleibt als Weiterleitung (drei Stellen im Bestand nennen sie).
- drizzle/0194_person_zusammenfuehren.sql — person.zusammengefuehrt_in_person_id (lesbar fuer cse_app, schreibbar nur fuer cse_definer) mit partiellem Index; Trigger kern.person_merge_kein_zyklus (Selbstbezug, Zeigen auf eine zusammengefuehrte Zeile UND das Zusammenfuehren einer fuehrenden Zeile — die dritte Lage fehlt in der naheliegenden Umsetzung und erzeugt genau die Kette); app.person_kanonisch(uuid); app.person_identitaeten(uuid) fuer Aggregationen je Mensch (Invariante 9/K-06); app.person_zusammenfuehren(uuid, uuid, text) mit Recht, aktivem Mandanten, Readonly-Sperre, Pflichtgrund und Auditzeile.

## Gebaute Routen

- `/portal/[mandant]/personal/abwesenheiten/[id]` — fertig — Detailblatt mit Zeitraum, Halbtagen, angerechneten Tagen und allen drei Zeitpunkten in Europe/Berlin. Der Grund (Art. 9 DSGVO) kommt NUR auf ausdrueckliche Anforderung (?grund=1) ueber app.abwesenheit_grund_lesen, mit sichtbarem Protokollhinweis; 'kein Recht' (42501) und 'kein Grund hinterlegt' sind zwei verschiedene Saetze. zeit.konto_lesen wird VORHER gefragt, damit null Zeilen im Urlaubskonto nicht wie 'kein Anspruch' aussehen. Entscheidungsformular gegen das vorhandene POST /api/abwesenheiten/[id], Knoepfe nur fuer Uebergaenge, die der Dienst zulaesst. Korrektur der Kritik umgesetzt: findeAbwesenheit liefert jetzt storniert_am.
- `/portal/[mandant]/personal/antraege/[id]` — fertig — Zeigt den PREIS vor der Entscheidung: Arbeitstage aus rechneTage (nie in SQL nachgebaut), Urlaubskontostand, und die Warnung 'eine Genehmigung wuerde jetzt abbrechen' bevor UrlaubskontoFehlt fliegt (O-18). Ein TAUSCHANTRAG bekommt bewusst KEINEN Genehmigen-Knopf: entscheideAntrag behandelt nur den Abwesenheitszweig, eine Genehmigung waere wirkungslos und ohne SEC-04-Tor (O-613). findeAntrag wurde um erzeugtAbwesenheit, einsatzId, tauschPartnerAnstellungId, abwesenheitsartId, zaehltAufUrlaubskonto, storniertAm erweitert.
- `/portal/[mandant]/personal/anstellungen/[id]/vertrag` — fertig — Der Kritik gefolgt: nur personalnummer + eintritt sind Schreibfelder. arbeitszeitmodell/wochenstunden/arbeitstage_woche stehen gesperrt daneben, weil sie nach 01-KERN §6.14 ein Spiegel der datierten anstellung_kondition mit genau EINEM Schreiber sind (05-API-KARTE fuehrt sie unter /konditionen mit personal.entgelt_schreiben) — 0191 nimmt sie cse_app aus dem UPDATE-Grant, die Sperre ist also keine Behauptung der Oberflaeche. austritt nur lesend, mit Verweis auf /beenden. Personalnummernkollision kommt als Satz zurueck, nicht als 23505.
- `/portal/[mandant]/personal/anstellungen/[id]/entgelt` — fertig — Satz in Cent, angezeigt als Euro (formatiereGeld), gelesen ausschliesslich ueber das gehaertete app.entgelt_lesen(anstellung, stichtag); Protokollhinweis sichtbar. Die Historie zeigt Zeitraeume/Stunden/Grund OHNE Betraege — ein Verweis je Zeile holt genau einen Satz, damit ein Seitenaufruf nicht zehn Auditzeilen schreibt. Schreiben legt eine KONDITION an (nie den Spiegel), Eurobetrag serverseitig mit parseGeld geparst. tarifgruppe/arbeitszeitmodell bleiben freie Felder mit sichtbarem 'offen (O-610)' bzw. '(O-18)'. Die 2FA-Frage steht als 'offen (O-614)' auf der Seite.
- `/portal/[mandant]/personal/anstellungen/[id]/beenden` — fertig — Vor dem Formular die Folgen: Einsaetze nach dem Austritt, nicht abgeschlossene Stundenkonten, Resturlaub, offene Antraege, nicht zurueckgegebene Schluessel. Jeder Posten haengt an einem ANDEREN Recht, deshalb unterscheidet die Seite 'keine' von 'nicht pruefbar — kein Leserecht (x)'. Geschrieben werden austritt + austritt_grund (neue Spalte in 0191, wie 01-KERN §6.14 sie fuehrt — nicht ins audit_log ausgewichen). Status folgt dem Kalender: erst wenn der Austrittstag vorbei ist, und am Statuswechsel haengt der K-14-Entzug. Nie ein DELETE.
- `/portal/[mandant]/personal/personen/[id]/stammdaten` — fertig — Drei Felder (Geburtsdatum, Geburtsort, Staatsangehoerigkeit als ISO-3166-1-alpha-2 mit CHECK), gelesen nur ueber app.person_stammdaten_lesen mit Protokollhinweis, ohne Recht ein ausgesprochener Sperrhinweis statt leerer Felder. Die Kritik war richtig: Schreiben war strukturell unmoeglich (nur sprache hatte UPDATE, nur t_person_selbstpflege als Policy) — 0190 bringt den Spalten-UPDATE-Grant UND die Policy t_person_personalpflege (personal.schreiben + Beschaeftigung im aktiven Mandanten). O-43 steht als offene Annahme im Text.
- `/portal/[mandant]/personal/zusammenfuehren` — fertig — Zwei Schritte: Suche stellt Kandidaten nebeneinander (Namen, Telefon, Beschaeftigungen, Nachweise, Zugang, Kennung) und schlaegt NICHTS vor; dann ausdrueckliche Wahl der fuehrenden Zeile, Pflichtgrund und getippte Bestaetigung (Nachname). Ausgefuehrt von app.person_zusammenfuehren in einer Transaktion: Zeiger setzen, Auditzeile mit beiden Kennungen. Der Kritik gefolgt — es wird KEINE Zeile umgehaengt (nachweis traegt (nachweis_id, person_id), mitarbeiter_zugang unique(person_id)); aufgeloest wird ueber app.person_kanonisch / app.person_identitaeten. Das Geburtsdatum steht bewusst nicht in der Trefferliste (Spaltenentzug). Offene Regel sichtbar als O-611.

## src/server/registry/dienste.ts

/**
   * **Die Personaldomaene (0190–0194).** Drei Dienste, drei Schreibrechte —
   * und der strengste ist nicht der eingetragene: `personal/anstellung`
   * fuehrt `aendereVertrag` (`personal.schreiben`), `beendeAnstellung`
   * (`personal.anstellung_beenden`) und `setzeKondition`
   * (`personal.entgelt_schreiben`, 05-API-KARTE §C.8). Das Register fuehrt
   * EIN Recht je Dienst; eingetragen ist das SCHWAECHSTE, weil die Zusage,
   * die es tragen muss, „in der Gruppenansicht fuehrt kein Schreibpfad"
   * lautet — und die haengt nicht davon ab, welches der drei gerade greift.
   * Die beiden anderen stehen an ihren Funktionen und in den Policies
   * (`t_mandant_schreiben` auf `anstellung_kondition` verlangt
   * `personal.entgelt_schreiben`, nicht `personal.schreiben`).
   */
  {
    modul: 'personal', pfad: 'personal/anstellung',
    schreibend: true, schreibRecht: 'personal.schreiben',
  },
  {
    modul: 'personal', pfad: 'personal/stammdaten',
    schreibend: true, schreibRecht: 'personal.schreiben',
  },
  {
    modul: 'personal', pfad: 'personal/dublette',
    schreibend: true, schreibRecht: 'personal.zusammenfuehren',
  },

## src/server/auth/route-manifest.ts

{
    pfad: 'api/personal/anstellungen/[id]/vertrag',
    recht: 'personal.schreiben',
    grund:
      'D-09, §5.12.1. Personalnummer und Eintritt — und nur die. Arbeitszeitmodell und '
      + 'Wochenstunden sind nach 01-KERN §6.14 ein Spiegel der datierten '
      + '`anstellung_kondition` und laufen ueber `…/entgelt` mit dem strengeren Recht '
      + '`personal.entgelt_schreiben`; `cse_app` hat auf diesen Spalten seit 0191 kein '
      + 'UPDATE. Das Austrittsdatum gehoert `…/beenden`: eine Spalte, ein Schreiber.',
  },
  {
    pfad: 'api/personal/anstellungen/[id]/entgelt',
    recht: 'personal.entgelt_schreiben',
    grund:
      'K-05, D-09 §6, 01-KERN §6.15. Legt eine DATIERTE Kondition an, nie den Spiegel — '
      + 'eine Erhoehung darf nicht jede vergangene Kalkulation still neu bewerten. Ein '
      + 'eigenes Recht neben `personal.schreiben`: wer Vertragseckdaten pflegen darf, '
      + 'darf damit keinen Kostensatz setzen. Der Eurobetrag wird serverseitig in ganze '
      + 'Cent geparst (Invariante 1).',
  },
  {
    pfad: 'api/personal/anstellungen/[id]/beenden',
    recht: 'personal.anstellung_beenden',
    grund:
      'D-09, K-14, R-08, 05-API-KARTE §C.8. Setzt `austritt` und `austritt_grund`, nie '
      + 'ein DELETE (Invariante 8) — Zeit-, Konto- und Rechnungsdaten haengen an dieser '
      + 'Zeile. Der Status folgt dem Kalender; am Statuswechsel haengt der K-14-Entzug '
      + 'der ABGELEITETEN Mitgliedschaft, eine erteilte Rolle ueberlebt ihn.',
  },
  {
    pfad: 'api/personal/personen/[id]/stammdaten',
    recht: 'personal.schreiben',
    grund:
      'SEC-03, LEG-09, 01-KERN §6.13/§11. Geburtsdatum, Geburtsort und '
      + 'Staatsangehoerigkeit — die Pflichtangaben des Bewacherregisters. GESCHRIEBEN '
      + 'mit `personal.schreiben`, GELESEN mit `personal.stammdaten_lesen`: `GRANT '
      + 'UPDATE` und `GRANT SELECT` sind getrennte Rechte, und eine Spalte darf '
      + 'schreibbar und unlesbar sein. Das Formular nimmt ein Geburtsdatum auf, ohne es '
      + 'zurueckzulesen; wer das Ergebnis sehen will, geht ueber '
      + '`app.person_stammdaten_lesen` und hinterlaesst dabei seine Auditzeile.',
  },
  {
    pfad: 'api/personal/zusammenfuehren',
    recht: 'personal.zusammenfuehren',
    grund:
      'D-09, LEG-09, 01-KERN §6.13. Zwei `person`-Zeilen sind ein Mensch. Die Kennungen '
      + 'stehen im RUMPF und nicht im Pfad, weil der Vorgang zwei nimmt — die veraltete '
      + 'Zeile und die fuehrende, und welche welche ist, entscheidet ein Mensch. '
      + 'Ausgefuehrt von `app.person_zusammenfuehren`: der Zeiger ist `cse_app` nicht '
      + 'schreibbar, eine Zusammenfuehrung ist kein `update` in einer Maske.',
  },

## src/server/db/schema/rls.ts

In `KEIN_HARD_DELETE` (`src/server/db/schema/rls.ts`):

  {
    tabelle: 'anstellung_kondition',
    art: 'append',
    migration: '0192',
    grund:
      '§6.15, LEG-02, ACC-12. Die datierte Kondition ist die Grundlage jeder '
      + 'Sollstunden- und Lohnkostenrechnung; eine geloeschte Zeile bewertet '
      + 'stillschweigend jeden abgerechneten Monat neu, in dem sie galt. Abgeloest '
      + 'wird sie von der naechsten datierten Zeile, geschlossen ueber `gilt_bis` — '
      + 'nie durch DELETE.',
  },

In `AUDITIERT`:

  { tabelle: 'anstellung_kondition', migration: '0192' },

KEIN Eintrag in `GEAENDERT_AM`: die Tabelle ist append-only bis auf `gilt_bis`
und traegt gar keine `geaendert_am`-Spalte — ein Eintrag dort erzeugte einen
Trigger auf eine Spalte, die es nicht gibt.

KEIN Eintrag in `NUR_UEBER_DEFINER`: `anstellung_kondition` hat Policies und
Spaltengrants fuer `cse_app` (Lesen unter `personal.lesen`, Anlegen unter
`personal.entgelt_schreiben`, `update (gilt_bis)`); nur `stundensatz_intern_cent`
und `tarifgruppe` sind aus dem SELECT-Grant genommen und laufen ueber
`app.entgelt_lesen`. Die Tabelle ist also keine Ausnahme von K-03, sondern der
Normalfall mit zwei entzogenen Spalten.

**Wichtig fuer den Ablauf:** `drizzle/0192_anstellung_kondition.sql` enthaelt den
generierten Block schon WORTWOERTLICH zwischen den Sentinels (`… nicht von Hand
ändern (0192)`), damit die Migration auf einer frischen Datenbank vollstaendig
ist — ich habe sie genau so gegen echtes Postgres gefahren. Nach dem Einfuegen
der beiden Registereintraege bitte `pnpm db:triggers` laufen lassen; der Lauf
ersetzt den Block idempotent durch seinen eigenen (`blockEinsetzen` ersetzt,
wenn Sentinels da sind, und haengt nur sonst an).

## src/server/registry/navigation.ts

Keine Aenderung noetig — und das ist eine Feststellung, keine Auslassung.

Alle sieben Routen stehen bereits in `src/server/registry/routen.generiert.ts`
(Zeilen 199–215) mit ihrem Recht; sie sind DETAILSEITEN und Unterseiten, keine
Tab-Ziele, und §11.2 laesst je Portal genau fuenf Tabs zu. `navigation.ts`,
`tableiste.ts`, `modul.ts`, `routen.ts` und `kennzahlen.ts` bleiben damit
unberuehrt.

Erreichbar sind sie ueber Verweise IN den Nachbarseiten, und die habe ich
gesetzt (jeweils hinter `haeltRechte`, AUT-06/D-581):

  · `/personal/personen/[id]` → „Stammdaten (Bewacherregister)"
    (`personal.stammdaten_lesen`) und „Dubletten zusammenfuehren"
    (`personal.zusammenfuehren`).
  · `/personal/anstellungen/[id]` → „Vertrag aendern" (`personal.schreiben`),
    „Entgelt" (`personal.entgelt_lesen`) und „Beschaeftigung beenden"
    (`personal.anstellung_beenden`, nur solange nicht beendet).
  · `/personal/abwesenheiten` und `/personal/antraege` verlinkten ihre
    Detailblaetter bisher nicht; die Detailseiten verweisen jedenfalls
    zurueck, und die Listen tragen ihre Zeilen weiterhin als Text. Das ist der
    einzige Punkt, an dem eine NACHBARSEITE noch einen Verweis brauchen
    koennte — bitte im naechsten Durchgang mitnehmen: in
    `abwesenheiten/page.tsx` die Spalte „Person" und in `antraege/page.tsx`
    den Kartenkopf auf `…/[id]` verlinken.

Nebenbefund am Rand meiner Domaene, nicht von mir geaendert:
`src/server/services/datenschutz/berichtigung.ts:98` (`editorPfad`) zeigt fuer
`art === 'person'` auf `/portal/<slug>/personal/<id>` — diese Adresse gibt es
nicht, richtig waere `/portal/<slug>/personal/personen/<id>`. Ein Verweis auf
404 ist genau das, was AUT-06/D-581 ausschliessen.

## Sonstiges

In `scripts/generate-triggers.ts`, `MIGRATIONS_DATEIEN` (sonst schreibt
`pnpm db:triggers` den Block der neuen Tabelle nirgendwohin und `--check`
vergleicht gegen eine Datei, die es in der Karte nicht gibt):

  // Personal: die datierte Kondition (0192).
  '0192': join(WURZEL, 'drizzle/0192_anstellung_kondition.sql'),

Danach `pnpm db:triggers` — siehe Hinweis unter `registry_rls`.

Ausserdem, in derselben Runde einzusammeln (beides habe ich NICHT getan, weil
die Dateien zentral gepflegt sind):

  · `docs/architecture/04-SEITENKARTE.md`: die sieben Routen sind jetzt gebaut;
    `…/anstellungen/[id]/vertrag` fuehrt dort noch „Arbeitszeitmodell,
    Wochenstunden" als Schreibfelder. Umgesetzt ist die Fassung von 01-KERN
    §6.14 und 05-API-KARTE (Spiegel, geaendert ueber die Kondition mit
    `personal.entgelt_schreiben`); die Karte gehoert nachgezogen.
  · `docs/DESIGN.md`: nichts ergaenzt und nichts gebraucht — alle Seiten
    benutzen ausschliesslich vorhandene Tokens (`s1`…`s6`, `text`,
    `text-muted`, `text-subtle`, `line`, `line-strong`, `surface`,
    `surface-2`, `surface-3`, `warning`, `warning-soft`, `success`,
    `success-soft`, `danger`, `text-h1`/`h2`/`h3`, `text-micro`, `rounded-md`,
    `rounded-lg`, `duration-fast`). `scripts/guards/run-all.ts` meldet zu
    meinen Dateien keine Farb-, Abstands- oder Schattenbefunde.
  · Ein Job-Eintrag fuer `app.anstellung_status_nachziehen()` und
    `app.anstellung_kondition_spiegel_nachziehen()` (§6.14 nennt
    `job:anstellung_status` und den naechtlichen Spiegellauf). Die Mechanik
    steht in der Datenbank und ist nur `cse_job` ausfuehrbar; die Anbindung an
    den Planer gehoert in die Job-Registrierung, die ich nicht anfasse.
    Ohne sie ist der Stand sichtbar falsch (eine Zeile mit vergangenem
    Austritt und Status `aktiv`) und nicht lautlos falsch — `app.entgelt_lesen`
    liest ohnehin die Kondition und nicht den Spiegel.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-610 | **Welcher Branchentarif gilt je Gesellschaft, welche Tarifgruppen fuehrt er — und wird die Gruppe in der Plattform gefuehrt oder nur im Lohnsystem?** Gebaeudereinigung (RTV), Sicherheitsgewerbe Berlin und Bau haben je eigene Tarifwerke mit eigenen Gruppen; CLAUDE.md nennt Tarifsaetze ausdruecklich als offene Regel, und diese Plattform rechnet keine Loehne (D-06). **Heute gebaut:** `anstellung_kondition.tarifgruppe` und der Spiegel `anstellung.tarifgruppe` als FREIES Textfeld, beide `cse_app` als SELECT entzogen (K-05) und nur ueber `app.entgelt_lesen` erreichbar; die Entgeltseite beschriftet das Feld sichtbar als „offen (O-610)" und zeigt keine Auswahlliste. Eine Auswahlliste waere eine Tarifentscheidung in einer Oberflaeche — sie saehe bestaetigt aus und ginge in jede Kalkulation ein. | K-05, D-06, 01-KERN §6.14/§6.15, `drizzle/0192`, O-136, O-18 |
| O-611 | **Wie wird eine Personendublette zusammengefuehrt — welche Angaben gewinnen, welcher Zugang ueberlebt, und darf eine Gesellschaft ueber eine Beschaeftigung entscheiden, die sie nicht sieht?** Vier Fragen, eine Nummer, weil sie zusammen entschieden werden muessen: (a) welche Angaben bei Widerspruch uebernommen werden, (b) welcher Portalzugang ueberlebt, wenn beide Zeilen einen haben (`mitarbeiter_zugang` traegt `unique (person_id)` — das Umhaengen wirft 23505, und das ist der Regelfall einer Dublette), (c) ob eine Zusammenfuehrung zurueckgenommen werden kann, (d) ob eine Gesellschaft eine Dublette zusammenfuehren darf, deren zweite Beschaeftigung bei einer Schwestergesellschaft liegt und die sie deshalb gar nicht sehen kann. **Heute gebaut:** die engste Annahme. `app.person_zusammenfuehren` setzt NUR den Zeiger `person.zusammengefuehrt_in_person_id`, verlangt dass BEIDE Zeilen in der aktiven Gesellschaft beschaeftigt sind (und weist den Schwesterfall mit einem Satz ab, der O-611 nennt), haengt keine einzige Zeile um und schreibt eine Auditzeile mit beiden Kennungen und dem Grund. Aufgeloest wird ueber `app.person_kanonisch` und `app.person_identitaeten` — das zweite ist die Funktion, die eine Aggregation je MENSCH braucht (Invariante 9, ArbZG ueber Gesellschaftsgrenzen, K-06). Die Geschichte wird nicht umgeschrieben und kann es nicht: 50 Tabellen haben einen Fremdschluessel auf `person`, die Zeitdomaene traegt `person_id` in zusammengesetzten Fremdschluesseln ohne `on update cascade`, und `zeiteintrag`, `wachbuch_eintrag`, `da_kenntnisnahme`, `checkin_token`, `aufmass_signatur` und `leistungsnachweis_signatur` weisen jedes UPDATE ab. | D-09, LEG-09, Invariante 8, Invariante 9, 01-KERN §6.13, `drizzle/0194`, `services/personal/dublette.ts`, O-220 |
| O-612 | **Welche Beendigungsgruende fuehrt die Gruppe — und muessen sie den Codes des Lohnsystems fuer die SV-Abmeldung entsprechen?** Eigenkuendigung, Kuendigung durch den Arbeitgeber, Befristungsablauf, Aufhebungsvertrag, Rente, Tod: die Liste ist lohn- und meldewirksam (die SV-Abmeldung traegt einen Abgabegrund), und eine erfundene Auswahl saehe wie eine abgestimmte aus. **Heute gebaut:** `anstellung.austritt_grund text` (01-KERN §6.14 fuehrt die Spalte namentlich, auch in den Grant-Listen von §11 — sie zu umgehen und den Grund ins `audit_log` zu schreiben waere die stillschweigende Wahl gegen das Datenmodell) als PFLICHTFELD in Worten, mit Beispielen im Platzhalter und dem sichtbaren Hinweis „offen (O-612)" an der Seite. Der Grund steht ausserdem im Protokoll: die Spalte sagt „warum ist diese Beschaeftigung beendet", das Protokoll sagt „wer hat das wann eingetragen". | D-09, K-14, R-08, 01-KERN §6.14, 05-API-KARTE §C.8, `drizzle/0191`, `services/personal/anstellung.ts` |
| O-613 | **Soll die Genehmigung eines Tauschantrags die Umbesetzung im Dienstplan selbst ausfuehren — und wer verantwortet dann das SEC-04-Qualifikationstor?** `entscheideAntrag` behandelt heute nur den Abwesenheitszweig (`antragsart.erzeugt_abwesenheit`). Ein Tauschantrag (`antrag.tausch_partner_anstellung_id`, `antrag.einsatz_id`) wuerde auf `genehmigt` gesetzt, ohne dass im Dienstplan etwas geschieht — und 05-API-KARTE §C.8 verlangt fuer eine Tauschgenehmigung ausdruecklich dasselbe Qualifikationstor wie fuer das Besetzen („a swap approval passes the same SEC-04 gate as besetzen"). **Heute gebaut:** `/personal/antraege/[id]` zeigt fuer einen Tauschantrag KEINEN Genehmigen-Knopf, sondern den Satz, dass der Tausch im Dienstplan vollzogen wird, und benennt die offene Frage. Eine Genehmigung ohne Wirkung ist schlimmer als ein fehlender Knopf: der Antragsteller liest „genehmigt" und kommt nicht zur Schicht. | EMP-10, EMP-11, SEC-04, 05-API-KARTE §C.8, `services/abwesenheit/antrag.ts`, `personal/antraege/[id]` |
| O-614 | **Verlangt der Zugriff auf Entgeltdaten eine zweite Anmeldestufe?** 05-API-KARTE fuehrt `…/anstellungen/[id]/entgelt` und `…/konditionen` als „sitzung+2fa"; das Routen-Manifest (`registry/routen.generiert.ts`) fuehrt dieselbe Route mit `aal2: false`. Zwei Dokumente, zwei Antworten — und es ist keine technische Frage, sondern eine ueber Zugangssicherheit: `personal.entgelt_lesen` ist fuer `admin` und `leitung` bindbar, eine 2FA-Pflicht traefe damit Konten, die nach AUT-02/K-15 heute auf `aal1` laufen (`leitung` hat keinen zweiten Faktor, und K-15 warnt ausdruecklich davor, eine `aal2`-Bedingung an einen Lesepfad zu haengen, von dem die Mitgliedschaftsaufloesung abhaengt). **Heute ausgeliefert:** der Stand des Manifests (`aal2: false`); das Recht und die Auditzeile tragen die Absicherung, und die Entgeltseite nennt die Abweichung sichtbar. | K-05, K-15, AUT-02, D-09 §6, 05-API-KARTE §C.8, `registry/routen.generiert.ts`, `drizzle/0193` |

## Tests

- /home/user/cse-platform/tests/kern/personal-eingaben.test.ts — die Eingabegrenze der drei Personaldienste OHNE Datenbank. Der Kontext WIRFT bei jeder Abfrage; damit beweist jeder Fall eine Reihenfolge und nicht nur eine Meldung: Personalnummer leer, Eintritt/Austritt/gilt-ab/Stichtag in deutscher Schreibweise statt JJJJ-MM-TT, negativer Satz, Geburtsdatum 31.02., Staatsangehoerigkeit als Wort statt ISO-Code, Beendigung ohne Grund, Selbstbezug und Grund-leer beim Zusammenfuehren. Plus eine Gegenprobe (drei leere Stammdatenfelder sind GUELTIG und erreichen die Datenbank) — ohne sie waere 'alles abgewiesen' ebenfalls gruen.
- /home/user/cse-platform/tests/isolation/personal-spaltenschutz.test.ts — 17 Zusicherungen gegen echtes Postgres: die drei Stammdatenfelder weisen ab statt zu maskieren (auch `select *`), bleiben aber SCHREIBBAR; app.person_stammdaten_lesen liefert mit Recht drei Felder, wirft ohne Recht (42501), gibt fuer eine Person ausserhalb der Gesellschaft KEINE Zeile und keinen Fehler (AUT-06), schreibt je erfolgreichem Abruf genau EINE Auditzeile mit Rechtsgrundlage und bei Abweisung KEINE; die Schreibpolicy der Personalstelle greift fuer fremde Menschen der eigenen Gesellschaft, nicht fuer die einer anderen, und in der Gruppenansicht bleibt die Zeile unveraendert; app.entgelt_lesen und der alte Name app.anstellung_entgelt_lesen sind beide gehaertet (Recht fehlt → 42501, fremde Gesellschaft → null).
- /home/user/cse-platform/tests/isolation/personal-anstellung.test.ts — Einbahn-Status (hinein ja, hinaus nein, Grund nachtragen an einer beendeten Zeile ja — die Gegenprobe zum CHECK, den §6.14 ablehnt); der Spiegel ist fuer cse_app nicht schreibbar, Personalnummer/Eintritt sehr wohl, eine Dublette bleibt am Constraint; anstellung_kondition verlangt personal.entgelt_schreiben, entzieht denselben zwei Spalten SELECT und laesst INSERT zu, weist zwei gleichzeitig gueltige Konditionen ab, liefert nach dem Schliessen einer Periode DATIERTE Saetze (1400 fuer 2024, 1500 fuer 2025 — die Vergangenheit bleibt), gibt vor der ersten Kondition null statt des heutigen Spiegelwerts, spiegelt alle sechs Felder und spiegelt eine ZUKUENFTIGE Kondition nicht, und laesst sich nicht loeschen; K-14 in fuenf Faellen (Anlage erzeugt die abgeleitete Zeile mit Rolle `mitarbeiter`, eine ERTEILTE `leitung` wird nicht ueberschrieben und ueberlebt den Austritt, die abgeleitete wird mit Grund entzogen und faellt dabei auf aus_anstellung=false, bei einer zweiten laufenden Beschaeftigung derselben Gesellschaft kein Entzug, ohne Konto kein Fehler); app.anstellung_status_nachziehen setzt nur vergangene Austritte und ist cse_app verboten.
- /home/user/cse-platform/tests/isolation/person-dublette.test.ts — der Zeiger ist cse_app lesbar und nicht schreibbar; app.person_zusammenfuehren setzt ihn, protokolliert beide Kennungen und den Grund, wirft ohne Recht, ohne Begruendung, bei einer bereits zusammengefuehrten Zeile, bei einem Menschen aus einer fremden Gesellschaft (mit einem Satz, der O-611 nennt) und in der Gruppenansicht; kein Selbstbezug und keine Kette in BEIDEN Richtungen; app.person_kanonisch loest auf und laesst eine freie Zeile in Ruhe; app.person_identitaeten liefert beide Kennungen von jeder Seite aus; und die Geschichte bleibt, wo sie entstanden ist (anstellung.person_id unveraendert, die veraltete Zeile weiter lesbar). Der Seed hat keine Dublette, dieser Test legt sie je Fall selbst an.
- /home/user/cse-platform/tests/isolation/mandanten-trennung.test.ts — GEAENDERT, nicht neu. Die zwei Faelle, die `app.anstellung_entgelt_lesen` OHNE Konto aufriefen, bekommen jetzt eine Sitzung, die `personal.entgelt_lesen` als Mandanten-Override haelt (sonst haetten sie nach 0193 richtigerweise geworfen und die Zusicherung „1450" waere falsch geworden). Dazu ein NEUER Fall daneben: ohne das Recht gibt es keinen Satz, sondern 42501 — das war die Luecke.

## NICHT gebaut

- Keine der sieben Routen bleibt Platzhalter — alle sieben sind vollstaendig (Daten, Tabelle/Felder, Filter bzw. Suche, Rechte, Leerzustand, Schreibweg). Was OFFEN bleibt, bleibt als klar bezeichneter Platzhalter nach Regel 1 und ist unten aufgefuehrt.
- Tarifgruppen: freies Feld, kein Vokabular (O-610). Eine Auswahlliste waere eine Tarifentscheidung mit Lohnwirkung.
- Arbeitszeitmodell: freies Feld, kein Vokabular (O-18, schon im Register). Der Platzhalter `unbekannt` bleibt der Default der Kondition.
- Beendigungsgruende: Pflichtfeld in Worten, keine Auswahlliste (O-612).
- Tauschantraege: keine Genehmigung auf der Antragsseite (O-613) — statt eines Knopfs, der eine Genehmigung ohne Wirkung erzeugt, steht dort der Satz, dass der Tausch im Dienstplan vollzogen wird. Das SEC-04-Tor fuer eine Tauschgenehmigung ist damit weiterhin nicht gebaut und auch nicht vorgetaeuscht.
- Zusammenfuehren haengt KEINE Zeile um (O-611): kein Feld wird uebernommen, kein Zugang widerrufen, keine Ruecknahme. Gebaut ist die Identitaet (Zeiger + Aufloeser) und der Nachweis.
- 2FA-Stufe der Entgeltseiten: ausgeliefert ist der Stand des Routen-Manifests (aal2 false), die Abweichung zu 05-API-KARTE steht sichtbar auf der Seite (O-614).
- Der naechtliche Lauf, der `anstellung.status` nach einem vergangenen Austritt nachzieht und den Konditionsspiegel nach dem Datumswechsel neu ableitet: die Mechanik ist da (`app.anstellung_status_nachziehen`, `app.anstellung_kondition_spiegel_nachziehen`, beide nur `cse_job`), die Registrierung im Job-Planer gehoert nicht in meinen Bereich. Folge ohne sie: ein sichtbar falscher Stand (vergangener Austritt, Status `aktiv`), kein lautlos falscher — `app.entgelt_lesen` liest die Kondition und nicht den Spiegel.
- Keine Kontenpflege, kein Urlaubsanspruch-Editor, keine Lohnabrechnung — ausserhalb der Domaene bzw. ausdruecklich out of scope (D-06).

## Notizen des Bauenden

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
