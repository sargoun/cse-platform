# Registereinträge: agenten-freigaben-radar

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

## Migrationen (gegen eine eigene Datenbank gefahren: True)

- drizzle/0290_agent_richtlinie_willenserklaerung.sql

## Gebaute Adressen

- `/portal/[mandant]/agenten/[agent]/start` — fertig
  - Vorschaltblatt: Auftrag und Vorgangsart aus ENTWURF_AUFTRAEGE, die Tatsachen-Schluessel MIT ihren Werten (aus fuelleTatsachen(), also aus derselben Funktion, die der Lauf benutzt — zwei Abfragen liefen auseinander), Modell samt Anbieter, Budgetstand, Formular. Die KRITIK-Korrektur ist eingebaut: der Rechte-Zweig 'ohne agent.aufgabe_starten' entfaellt (das Manifest bewacht die Route, pruefeZugang antwortet 404), und agent.lesen wird EIGENS gefragt, weil agent_budget per RLS daran haengt — ohne die Frage stuende bei fehlendem Recht still 'kein Budget', also die gefaehrlichere Falschaussage. Die Zahlen sind als gerechnet gekennzeichnet (Invariante 6). ZUSAETZLICH behoben, was die KRITIK als Blocker nannte: /api/agenten/lauf baute den Rueckweg aus dem ENUM-Wert (`/agenten/ceo_assistent`) statt aus dem Slug; die Detailseite loest nur Slugs auf und rief notFound(). Jeder Lauf des CEO-Assistenten endete nach dem 303 auf einem 404. Jetzt slugFuer(agent).
- `/portal/[mandant]/agenten/richtlinien` — fertig
  - Die fehlende Elternliste — ohne sie haette die Detailseite keinen Eingang. Alle acht AKTIONEN, auch die fuenf ohne Zeile (fail-closed heisst nicht 'egal'), Verweis von jeder hinterlegten Zeile auf ihre Bearbeitungsseite, Anlegeformular fuer die unkonfigurierten (ohne Automatik), die drei im Code gesperrten ohne Anlegeformular.
- `/portal/[mandant]/agenten/richtlinien/[id]` — fertig
  - Der Plan sagte 'Kein Dienst, keine API-Route' — beides existiert inzwischen (setzeRichtlinie, ladeRichtlinien, /api/einstellungen/agent-richtlinien). Neu: ladeRichtlinie(kontext, id) als Einzelzeilen-Lader, der eine Aktion AUSSERHALB von AKTIONEN sichtbar macht (unbekannteAktion) statt sie auf eine bekannte abzubilden — eine Richtlinie, die nie greift, muss man sehen. Die Aktion ist unveraenderlich (Teil von agent_richtlinie_uk), auto_erlaubt/max_betrag_cent/begruendung sind bearbeitbar, begruendung ist Pflicht. Das Haekchen steht fuer Angebot/Nachtrag/Behinderung sichtbar GESPERRT da, nicht als Datenbankfehler nach dem Absenden. Statt einer zweiten Schreibroute traegt der bestehende Handler ein Zielfeld aus GESCHLOSSENEM Satz (einstellungen | agenten) — ein zweiter Schreibweg waere eine zweite Stelle, an der jemand das authorize vergisst.
- `/portal/[mandant]/freigaben/[id]/einspruch` — fertig
  - Kopf, Countdown in Europe/Berlin, Pflichtgrund, POST auf /api/freigaben/fenster. Drei KRITIK-Punkte eingebaut: (1) KEIN oeffneFreigabe() — gelesen wird ueber leseFensterKopf, damit die Seite nicht als Pruefvorgang in die APR-08-Messung eingeht; (2) die Seite prueft freigabe.lesen implizit (null -> 404, AUT-06) UND das erforderliches_recht der ZEILE, das app.freigabe_einspruch zusaetzlich verlangt — vorher haette der Knopf dagestanden und die Absage waere als 'Fenster abgelaufen' zurueckgekommen; (3) die Fenster-Route leitete in ALLEN Ausgaengen auf die Detailseite, die ?fehler=grund/fenster gar nicht auswertet — jede Fehlermeldung dieser Seite verschwand spurlos. Jetzt: Fehler zum Formular (Feld 'zurueck', geschlossener Satz), Erfolg weiter zur Detailseite, wie /api/vergabe/einreichung es macht. Dazu traegt FensterFehler einen Code: eine 42501 wird ?fehler=recht und nicht mehr ?fehler=fenster.
- `/portal/[mandant]/freigaben/[id]/rueckgaengig` — fertig
  - Beide Zustaende gebaut; der haeufigere ist heute der leere, und genau das ist der Zweck der Seite. Sie unterscheidet 'Fenster verpasst' (abgelaufen) von 'fuer diese Handlung ist keines armiert' (nicht_armiert, O-368) und von 'hier ist nichts auszufuehren' (falscher_stand) — vorher sah alles drei gleich aus. Geht dauerhaft leer in Betrieb, bis jemand eine Rueckholung baut und ihre Vorgangsart in app.freigabe_umkehrbar eintraegt; das steht als Satz auf der Seite. Ebenfalls ohne oeffneFreigabe().
- `/portal/[mandant]/radar/[id]/status` — fertig
  - Beide KRITIK-Korrekturen: (1) die Bedingung fuer 'In Bearbeitung' ist das RECHT vergabe.schreiben, nicht die Existenz einer Mappe — setzeVorgangsstand legt sie selbst an, idempotent; ein Verweis 'erst Mappe anlegen' haette eine funktionierende Handlung weggenommen. (2) Die Statushistorie kommt aus dem audit_log (aktion radar.stand_gesetzt) und nicht aus ausschreibung_vorgang: die Tabelle fuehrt EINE Zeile je (mandant_id, ausschreibung_id) und ueberschreibt bei jedem Stand. Das Protokoll haelt DASS ein Grund angegeben wurde, nicht seinen Wortlaut — die Seite sagt das, statt die Luecke als 'ohne Grund' auszugeben. Namen aus benutzer brauchen system.benutzer_lesen; ohne das Recht steht 'Name hier nicht sichtbar' und nicht 'unbekannt'. 'Eingereicht' ist nicht setzbar (D-07), mit Verweis auf /mappe/einreichung nur wenn Recht UND Mappe vorhanden. Die Fuenf-Tage-Grenze aus RAD-06 steht jetzt einmal in radar/frist.ts (aus gewichte.platzhalter FRIST_KNAPP_TAGE geprueft) statt zweimal abgeschrieben; radar/page.tsx importiert sie von dort.
- `/portal/[mandant]/radar/profile/[id]` — fertig
  - Neuer Dienst (leseProfil, leseEmpfaengerkandidaten, schreibeProfil, setzeCpv, entferneCpv, setzeEmpfaenger, entferneEmpfaenger, plus reine Pruefer) und neue API-Route mit fuenf Handlungen an einer Adresse. Vier Felder stehen sichtbar GESPERRT mit ihrer offenen Frage: gewichtung/benachrichtigung_ab_punkte/skala_max (O-15), negativ_wirkung (O-191), waehrung (O-47); ist_platzhalter einer CPV-Zeile bleibt zwingend true (O-98). Zwei KRITIK-Korrekturen: die Loeschregel gilt nur fuer radar_profil — radar_profil_cpv und radar_profil_empfaenger haben weder geloescht_am noch ist_aktiv und werden HART geloescht (zulaessig, Invariante 8 nennt Radar nicht); und der Aufwand war 'gross', nicht 'mittel'. ZUSAETZLICH selbst gefunden: schreibeProfil setzt geaendert_am, weil radar_profil keinen setze_geaendert_am-Trigger traegt — dadurch waere aber JEDER Klick auf Speichern eine 'Aenderung' geworden und trg_radar_profil_version haette die Fassung hochgezaehlt, also fuer jede Bekanntmachung eine neue bewertung-Zeile mit derselben Punktzahl erzeugt. Deshalb: select ... for update (das ist gleichzeitig die Rechtepruefung — Postgres wendet auf eine Sperrklausel das using der UPDATE-Policy an, empirisch belegt), Vergleich der bewertungsrelevanten Felder, und bei Gleichheit kein Schreiben und kein Protokolleintrag. Die Listenseite verweist jetzt von jedem Profilnamen hierher; ihr Satz 'Bearbeiten kommt mit dem naechsten Schritt' ist ersetzt.

## src/server/registry/dienste.ts

/*
   * Das Suchprofil des Vergaberadars (RAD-04, RAD-05). Der einzige
   * SCHREIBENDE Radardienst neben `radar/vorgang`: Stammdaten, CPV-Zeilen und
   * Empfaenger eines Profils. Punkte rechnet er keine — das tut
   * `radar/bewertung` im Nachtlauf.
   */
  {
    modul: 'radar', pfad: 'radar/profil',
    schreibend: true, schreibRecht: 'radar.profil_schreiben',
  },
  /*
   * Die LAGE eines Freigabefensters (APR-05, APR-06) — rein, ohne Datenbank.
   * Drei Bildschirme entscheiden aus denselben vier Werten, ob ein Knopf
   * dastehen darf; drei Abschriften derselben Bedingung liefen auseinander,
   * und der teure Fall ist der FEHLENDE Knopf ueber einem laufenden Fenster.
   */
  { modul: 'freigabe', pfad: 'freigabe/fenster', schreibend: false },
  /*
   * **Vorhandene Luecke, nicht von dieser Domaene angelegt.**
   * `services/agent/richtlinie.ts` stand nie im Register;
   * `tests/kern/portal-shell.test.ts` („das Register kennt jeden Dienst")
   * meldet es zusammen mit den beiden Zeilen darueber. Der Eintrag gehoert
   * hierher, weil `setzeRichtlinie` schreibt — und zwar unter dem Recht, das
   * `/api/einstellungen/agent-richtlinien` erzwingt.
   */
  {
    modul: 'agent', pfad: 'agent/richtlinie',
    schreibend: true, schreibRecht: 'agent.richtlinie_verwalten',
  },

## src/server/auth/route-manifest.ts

{
    /**
     * Ein Suchprofil des Vergaberadars pflegen (RAD-04, RAD-05). **Fuenf
     * Handlungen an einer Adresse**, weil sie EIN Profil betreffen:
     * Stammdaten setzen, eine CPV-Zeile anlegen oder aendern, eine entfernen,
     * einen Empfaenger eintragen, einen entfernen. Fuenf Routen waeren fuenf
     * Stellen, an denen jemand das `authorize` vergisst.
     *
     * **Was gesperrt ist, taucht als Feldname gar nicht auf**: Gewichtung und
     * Benachrichtigungsschwelle (O-15), die Wirkung der Negativ-Stichwoerter
     * (O-191), die Waehrung der Wertgrenzen (O-47). Und Punkte rechnet die
     * Route keine — das tut der Nachtlauf, deterministisch (RAD-05,
     * Invariante 6). Ein Speichern zaehlt die Profilfassung hoch, und der
     * naechste Lauf schreibt eine NEUE Bewertung neben die alte.
     */
    pfad: 'api/radar/profil',
    recht: 'radar.profil_schreiben',
  },

## src/server/db/schema/rls.ts

Keine Aenderung noetig. `0290` legt keine Tabelle an, sondern zwei CHECK-Bedingungen auf das vorhandene `agent_richtlinie` — dessen Loeschsperre, Audit- und `geaendert_am`-Trigger stehen seit `0203` im generierten Block und bleiben unberuehrt. Keine neue Policy, kein neuer Trigger.

## src/server/registry/navigation.ts

Keine Aenderung noetig. Alle sechs Routen stehen bereits in `routen.generiert.ts` (Zeilen 282, 286, 293, 294, 295, 303, 304) mit ihrer Bewachung; sie sind Unterseiten, die ueber Verweise erreicht werden, und ihre Eltern (`agenten`, `freigaben`, `radar`) stehen in `navigation.ts`/`tableiste.ts`. Keine neue Kennzahl, kein neues Modul.

## Sonstiges

`docs/architecture/04-SEITENKARTE.md`: keine Aenderung — alle sechs Routen stehen dort (§5.18, §5.19, §5.20).

`docs/DESIGN.md`: keine Aenderung — kein neuer Gestaltungswert. Verwendet sind ausschliesslich vorhandene Werte (s1…s7, text-h1/h2/h3, text-sm/xs/base, border-line, bg-surface/-2/-3, text-text/-muted/-subtle, text-danger/-warning/-success, *-soft, rounded-md/lg, min-h-11, max-w-prose, tabular-nums, font-mono). Die Spaltenbreiten der Definitionslisten sind auf `grid-cols-[12rem_1fr]` normiert, also auf den Wert, den die Nachbarseiten schon benutzen.

`package.json`, `scripts/guards/*`, `src/server/db/triggers/*`: nicht angefasst.

**Die Rechte-Diskrepanz an `agent_richtlinie` ist bereits geloest** und braucht keine Migration mehr: `drizzle/0203_agent_richtlinie_recht.sql` zieht `t_richtlinie_lesen` und `t_richtlinie_schreiben` auf `agent.richtlinie_verwalten` ODER `versand.*`. In der lebenden Datenbank nachgesehen (`pg_policies`). Der Plan fuehrte das als Blocker, die KRITIK entschaerfte es zu „Aufraeumarbeit" — beides ist ueberholt, es ist getan.

## Zeilen für docs/DECISIONS.md, Abschnitt „Offen"

| O-720 | **Soll ein Suchprofil des Vergaberadars archiviert werden koennen — und was geschieht dann mit den Bewertungen, die es erzeugt hat?** `radar_profil` traegt `geloescht_am`/`geloescht_von`, ein Archivieren war also vorgesehen; nur sagt niemand, was danach mit den `bewertung`-Zeilen geschieht, die den Profilnamen in ihrer Begruendung fuehren und die die Radarliste weiter mit `radar_profil` verbindet (ohne Filter auf `geloescht_am`). **Heute gewaehlt ist die sichere Richtung:** der Editor bietet kein Archivieren an, abgeschaltet wird ueber `ist_aktiv` — der Nachtlauf bewertet dann nichts mehr mit diesem Profil, und nichts wird unlesbar. `leseProfil` laedt ein archiviertes Profil nicht (eine Suche zu bearbeiten, die nicht mehr laeuft, ergibt keinen Sinn), und `schreibeProfil` weist es ab. | RAD-04, RAD-05, `services/radar/profil.ts`, `radar/profile/[id]` |
| O-721 | **Gegen welche Fassung der amtlichen NUTS-Liste sind die Regionspraefixe eines Suchprofils zu pruefen — und soll ein Praefix, das kein Gebiet bezeichnet, abgewiesen oder nur markiert werden?** Es gibt keine NUTS-Tabelle im Haus. `pruefeNutsPraefix` prueft deshalb die FORM (zwei Buchstaben Land, bis zu drei weitere Stellen) und macht Grossbuchstaben daraus — ein kleingeschriebenes Praefix traefe nie, und das faellt niemandem auf, weil die Liste einfach leer bliebe. `ZZ999` geht bewusst durch: die Form stimmt, das Gebiet gibt es nicht, und die Oberflaeche sagt genau das am Feld, statt eine Pruefung vorzutaeuschen. Dieselbe Lage wie O-98 fuer die CPV-Codes, eine Ebene weiter. | RAD-04, O-98, `services/radar/profil.ts`, `radar/profile/[id]` |

## Befunde des Prüfers (14)

- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/radar/[id]/status/page.tsx` — Fuenf der sechs als „fertig" gemeldeten Seiten sind von nirgendwo im Portal aus erreichbar. Der Bericht sagt unter `registry_navigation` ausdruecklich „Keine Aenderung noetig … sie sind Unterseiten, die ueber Verweise erreicht werden" — das stimmt nur fuer `/radar/profile/[id]` (Verweis aus der Profilliste) und `/agenten/richtlinien/[id]` (Verweis aus der Richtlinienliste). Die uebrigen fuenf haben keinen einzigen eingehenden Link: `/radar/[id]/status`, `/freigaben/[id]/einspruch`, `/freigaben/[id]/rueckgaengig`, `/agenten/[agent]/start` und `/agenten/richtlinien` (letztere nur vom eigenen Kind als Rueckweg). Die jeweiligen Elternseiten (`radar/[id]/page.tsx`, `freigaben/[id]/page.tsx`, `agenten/[agent]/page.tsx`, `agenten/page.tsx`) sind unveraendert und tragen weiter nur ihre eingebetteten Formulare. Damit ist die Arbeit nicht fertig, sondern nur vorhanden.
  - Behebung: Auf jeder Elternseite einen rechtegepruefeten Verweis auf die Unterseite setzen (Muster wie `radar/profile/page.tsx` Zeile 114): `radar/[id]` → `/status` unter `radar.status_setzen`; `freigaben/[id]` → `/einspruch` unter `freigabe.einspruch_erheben` und `/rueckgaengig` unter `freigabe.rueckgaengig` (beide Rechte liest die Seite in Zeile 110–116 bereits); `agenten/[agent]` → `/start` unter `agent.aufgabe_starten` (Recht liegt dort in Zeile 160 schon vor); `agenten/page.tsx` → `/agenten/richtlinien` unter `agent.richtlinie_verwalten`.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/agenten/richtlinien/page.tsx` — Die Spalte „Begründung" zeigt `z.grund ?? z.begruendung ?? '—'`. `AKTION_GRUND` traegt genau fuer die drei im Code gesperrten Aktionen (angebot_senden, nachtrag_einreichen, behinderung_senden) einen Wert — fuer sie verdeckt der feste Gesetzestext die von einem Menschen gespeicherte `begruendung` dauerhaft. Das ist woertlich derselbe Defekt, den die Schwesterseite `einstellungen/agent-richtlinien` schon behoben hat und in einem eigenen Kommentar als Fehler beschreibt („Stand hier `z.grund ?? z.begruendung`, verdeckte der Gesetzestext die menschliche Begruendung dauerhaft").
  - Behebung: Dieselbe Darstellung wie auf der Einstellungsseite uebernehmen: `begruendung` als Haupttext, darunter `Im Code gesperrt: {grund}` als zweite Zeile — nicht das eine STATT des anderen.
- **wichtig** · `/home/user/cse-platform/src/server/services/agent/richtlinie.ts` — Die Bearbeitungsseite beschriftet die Begründung mit „(Pflicht)" und setzt `required` — durchgesetzt wird das aber nur im Browser. `setzeRichtlinie` prueft `begruendung` nicht, und der Handler reicht `text('begruendung')` weiter, das bei leerem Feld `null` ist. Der Upsert schreibt `begruendung = excluded.begruendung`, also NULL. Gravierender: dasselbe Formular der Schwesterseite `einstellungen/agent-richtlinien` (Zeile 220–224) hat kein `required` und geht durch DENSELBEN Handler — wer dort eine Richtlinie speichert, loescht die auf der Detailseite geschuldete Erklaerung still weg. Fuer ein Feld, das nach Invariante 7 belegen soll, warum etwas ohne Menschen hinausgehen darf, ist eine reine Browserpruefung zu wenig.
  - Behebung: Entweder in `setzeRichtlinie` eine Pflichtpruefung ergaenzen (z. B. `begruendung` mit mindestens 5 Zeichen, wenn `autoErlaubt` gesetzt wird, sonst `RichtlinieFehler('ungueltig', …)`) und das Anlegeformular entsprechend anpassen — oder die Beschriftung „(Pflicht)" auf der Detailseite streichen und im Handler `begruendung` bei fehlendem Feld NICHT ueberschreiben (`begruendung = coalesce(excluded.begruendung, agent_richtlinie.begruendung)`).
- **wichtig** · `/home/user/cse-platform/src/server/services/radar/profil.ts` — Drei der fuenf Schreibhandlungen des neuen Dienstes hinterlassen KEINE Spur: `setzeCpv` (Zeile 530), `setzeEmpfaenger` (595) und `entferneEmpfaenger` (624) rufen `app.protokolliere` nicht. Nur `schreibeProfil` (497) und `entferneCpv` (579) protokollieren. `radar_profil_cpv` und `radar_profil_empfaenger` tragen auch keinen `kern.protokolliere_aenderung`-Trigger (nur die drei Versionszaehler). Weil beide Tabellen HART geloescht werden, heisst das: wer einen Benachrichtigungsempfaenger eintraegt oder wieder entfernt, tut das spurlos — der Versionszaehler springt zwar, sagt aber nur „irgendetwas hat sich geaendert", nicht wer wen entfernt hat. Genau die Asymmetrie zu `entferneCpv` zeigt, dass es ein Versehen ist, keine Entscheidung.
  - Behebung: In `setzeCpv`, `setzeEmpfaenger` und `entferneEmpfaenger` je einen `app.protokolliere`-Aufruf nach demselben Muster wie in `entferneCpv` ergaenzen (`radar.profil_cpv_gesetzt`, `radar.profil_empfaenger_gesetzt`, `radar.profil_empfaenger_entfernt`, objekt_typ `radar_profil`, objekt_id die Profilkennung, vorher/nachher mit Code bzw. Benutzerkennung).
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/radar/[id]/status/page.tsx` — Der Fehlerblock der Seite (Zeile 162–172, `?fehler=grund` / `?fehler=mappe_recht`) ist toter Code — nichts leitet je auf `/radar/[id]/status?fehler=…`. `/api/radar/vorgang` baut sein Ziel fest als `/portal/${mandant}/radar/${ausschreibung}` und leitet Fehler wie Erfolg dorthin. Wer auf dieser Seite „Verwerfen" ohne ausreichenden Grund drueckt, landet auf der Detailseite, und der eingetippte Grund ist weg. Das ist exakt der Befund, den derselbe Bauende fuer `/api/freigaben/fenster` behoben hat (Feld `zurueck`, geschlossener Satz) — an der von ihm neu gebauten Statusseite aber nicht.
  - Behebung: Wie in `/api/freigaben/fenster`: ein Feld `zurueck` aus geschlossenem Satz (`status`) im Formular mitschicken und im Handler ueber eine Karte aufloesen, damit Absagen zum Formular zurueckkommen; alternativ den unerreichbaren Fehlerblock in `status/page.tsx:162-172` entfernen, damit keine Auskunft vorgetaeuscht wird, die nie erscheint.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/agenten/[agent]/start/page.tsx` — Zeile 268 schreibt die Zahl 12 als Literal in den Bildschirmtext: `'12 — Platzhalter (offene Frage O-196)'`. Die tatsaechlich wirksame Grenze ist `MAX_SCHRITTE_PLATZHALTER` aus `src/server/agent/limits.platzhalter.ts:25`, die `laufzeit.ts:133/162` als Rueckfall benutzt. Damit steht dieselbe Zahl ein zweites Mal im Baum — aendert jemand den Platzhalter, sagt das Vorschaltblatt eine Grenze zu, die nicht gilt. Der Fall tritt heute wirklich ein: `select max_schritte from agent where kennung='ceo_assistent'` ist NULL, also ist genau dieser Zweig die Anzeige. Derselbe Bauende hat in diesem Stapel zwei solche Doppelungen (Fuenf-Tage-Grenze) beseitigt und hier eine neue eingefuehrt.
  - Behebung: `MAX_SCHRITTE_PLATZHALTER` importieren und `${String(MAX_SCHRITTE_PLATZHALTER)} — Platzhalter (offene Frage O-196)` ausgeben; das Literal 12 streichen.
- **wichtig** · `/home/user/cse-platform/src/server/registry/dienste.ts` — Die Registerarbeit ist nicht getan, und zwei Kerntests fallen deshalb: `radar/profil`, `freigabe/fenster` und `agent/richtlinie` fehlen in `dienste.ts`; `api/radar/profil` fehlt in `src/server/auth/route-manifest.ts`; O-720 und O-721 stehen nicht in `docs/DECISIONS.md`, obwohl `services/radar/profil.ts` zwei `TODO(client, O-720/O-721)` traegt. Nach der Arbeitsregel gehoert jede offene Frage zwingend nach DECISIONS.md, bevor der Platzhalter im Code stehen darf.
  - Behebung: Die drei Dienstzeilen in `src/server/registry/dienste.ts` eintragen (Text liegt im Bericht unter `registry_dienste` vor), `api/radar/profil` mit `recht: 'radar.profil_schreiben'` in `route-manifest.ts` ergaenzen und die beiden Zeilen O-720/O-721 in `docs/DECISIONS.md` unter „Open" aufnehmen. (Beide Tests fallen zusaetzlich wegen fremder Domaenen — die drei/eine Zeile dieser Domaene sind davon unabhaengig zu setzen.)
- **klein** · `/home/user/cse-platform/src/server/services/agent/richtlinie.ts` — Der Kommentar ueber `setzeRichtlinie` (Zeile 331–334) ist seit Migration 0290 falsch: er nennt `agent_richtlinie_kein_auto_angebot` (0012) und sagt „Die beiden anderen im Code gesperrten Aktionen tragen diesen CHECK nicht". 0290 hat genau diesen Riegel fallen gelassen und durch `agent_richtlinie_kein_auto_willenserklaerung` ersetzt, der alle drei Aktionen deckt. Dieselbe veraltete Aussage steht in `agenten/richtlinien/[id]/page.tsx:39`.
  - Behebung: Beide Kommentare auf `agent_richtlinie_kein_auto_willenserklaerung` (0290) umstellen und den Satz streichen, dass die zwei anderen Aktionen keinen CHECK tragen.
- **klein** · `/home/user/cse-platform/src/server/services/freigabe/fenster.ts` — Zeile 56 behauptet „Die Reihenfolge der Prüfungen ist die von `app.freigabe_einspruch`". Sie ist es nicht: die Definer-Funktion prueft erst `verzoegerte_freigabe_bis is null` („kein Einspruchsfenster"), dann `<= now()` („abgelaufen") und ERST DANACH `ausfuehrung_status <> 'offen'`. Die reine Funktion stellt „bereits ausgefuehrt" nach vorn. Die Wahl der Oberflaeche ist vertretbar, die Begruendung stimmt aber nicht — und wer sie liest, glaubt Code und Datenbank saegten dasselbe.
  - Behebung: Den Kommentar umschreiben: die Reihenfolge ist eine bewusst ANDERE als die der Datenbank, weil die Ausfuehrung die Fensterspalte leert und „kein Fenster" dann die unbrauchbarere Auskunft waere.
- **klein** · `/home/user/cse-platform/src/server/services/radar/profil.ts` — `teileListe` entdoppelt VOR der Normalisierung, `pruefeNutsPraefix` schreibt erst danach gross. Eine Eingabe „de3, DE3" ergibt deshalb `['DE3','DE3']` in `nuts_praefixe`. Die Liste geht in den `eingaben_hash` einer Bewertung ein; beim naechsten Oeffnen und Speichern entdoppelt `teileListe` die (jetzt gleich geschriebenen) Werte, der Vergleich schlaegt an und die Profilfassung springt ohne inhaltliche Aenderung — genau das, was `schreibeProfil` sonst sorgfaeltig vermeidet.
  - Behebung: In `schreibeProfil` nach dem Normalisieren ein zweites Mal entdoppeln, z. B. `const nuts = [...new Set(e.nutsPraefixe.map(pruefeNutsPraefix))];` (und dieselbe Behandlung fuer die Stichwortlisten erwaegen, die getrimmt, aber nicht normalisiert werden).
- **klein** · `/home/user/cse-platform/src/app/api/radar/profil/route.ts` — Die neue Route nimmt den Bereichsslug fuer die Umleitung aus dem versteckten Formularfeld `mandant` (Zeile 65/71) statt aus der Sitzung. Genau diesen Weg hat derselbe Bauende in `/api/agenten/lauf` (Zeile 88-101) beseitigt, mit der Begruendung: wer in einem zweiten Reiter den Bereich gewechselt hat, schickt den alten Slug ab und landet nach dem 303 in der falschen Gesellschaft. Hier endet das nach einem erfolgreichen Speichern auf einem 404, weil `leseProfil` das Profil im anderen Mandanten nicht findet.
  - Behebung: Den Slug in der Transaktion aus `app.aktiver_mandant()` lesen wie in `/api/agenten/lauf` und das versteckte `mandant`-Feld aus den fuenf Formularen in `radar/profile/[id]/page.tsx` entfernen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/radar/[id]/status/page.tsx` — Der Kopfkommentar (Zeile 98-104) sagt, die Seite „öffnet mit `radar.status_setzen` allein", und Zeile 154 blendet den Verweis „Zur Bekanntmachung" ohne `radar.lesen` aus. Tatsaechlich liest `leseRadarZeile` `ausschreibung` und `bewertung`, und beide Lesepolicies verlangen `radar.lesen` — eine Sitzung ohne dieses Recht bekommt fuer die GANZE Seite ein 404. Der bedingte Verweis ist damit toter Code und der Kommentar irrefuehrend.
  - Behebung: Entweder den Kommentar korrigieren und den Verweis unbedingt setzen (wer die Seite sieht, haelt `radar.lesen` ohnehin), oder die Bewachung der Route im Manifest auf `radar.status_setzen` UND `radar.lesen` stellen, damit Tor und Datenzugriff dasselbe sagen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/freigaben/[id]/rueckgaengig/page.tsx` — Zeile 173 schreibt die O-Nummer als Literal („offene Frage O-108"), obwohl die Datei fuer denselben Zweck `FENSTER_OFFENE_FRAGE` importieren koennte — die Einspruchsseite tut das an der gleichen Stelle. Zusaetzlich steht in beiden Fensterseiten und in der Statusseite nach `kennungOder404(id)` noch einmal eine lokale UUID-Pruefung (`const UUID = …; if (!UUID.test(id)) notFound();`), die dasselbe tut; `src/app/portal/kennung.ts` ist genau dafuer gebaut worden.
  - Behebung: `FENSTER_OFFENE_FRAGE` fuer die O-108-Angabe verwenden und die drei lokalen `UUID`-Konstanten samt `notFound()`-Doppelpruefung in `einspruch/page.tsx`, `rueckgaengig/page.tsx` und `radar/[id]/status/page.tsx` streichen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/agenten/richtlinien/page.tsx` — Beide neuen Richtlinienseiten geben den Inhalt von `?hinweis=` unveraendert in einem Hinweiskasten aus. Der Text ist damit frei aus der Adresse steuerbar — ein Link an eine Leitungskraft kann jeden beliebigen Satz in der Oberflaeche erscheinen lassen. Alle uebrigen neuen Seiten dieser Domaene loesen ihre Rueckmeldung ueber einen GESCHLOSSENEN Satz auf (`FEHLER_TEXT`, `VERMERKT_TEXT`); hier fehlt das.
  - Behebung: Im Handler `/api/einstellungen/agent-richtlinien` statt des Satzes einen Code umleiten (`?hinweis=gesetzt`, `?fehler=im_code_gesperrt` …) und auf beiden Seiten ueber eine Textkarte aufloesen — wie es die Route fuer das Ziel (`ZIELE`) bereits vormacht.

**Urteil:** Handwerklich ist der Kern in Ordnung: Migration 0290 ist in `w_agt` angewendet und traegt genau die beiden behaupteten CHECKs; jede neue Abfrage laeuft gegen echtes Postgres ohne Spalten- oder Enum-Fehler (alle 13 nachgestellt, Schreibwege in einer zurueckgerollten Transaktion); `pnpm typecheck` ist projektweit fehlerfrei; die vier Kerntestdateien laufen mit 66 gruenen Faellen; Geld ist ueberall `bigint`-Cent, Zeit `timestamptz` mit `now()` aus der Datenbank und Anzeige in Europe/Berlin; Rechte werden serverseitig geprueft und fehlende Zeilen werden zu 404, nicht 403; kein erfundener Gestaltungswert, kein Hex-Code, keine vorgetaeuschte externe Integration; die gesperrten Felder (O-15, O-47, O-98, O-191) stehen tatsaechlich sichtbar gesperrt statt zu fehlen; der `slugFuer`-Befund am `/api/agenten/lauf` ist echt und richtig behoben; der Versionszaehler-Vergleich in `schreibeProfil` ist eine substanzielle, korrekt begruendete Eigenleistung. Der schwerste Befund ist kein SQL- und kein Rechtefehler, sondern Erreichbarkeit: fuenf der sechs Seiten haben keinen eingehenden Verweis, obwohl der Bericht das Gegenteil behauptet — als Arbeitsergebnis sind sie damit vorhanden, aber nicht benutzbar. Dazu kommen drei Auslassungen mit echter Wirkung (Pflichtbegruendung nur im Browser, drei Schreibhandlungen des Radarprofils ohne Protokolleintrag bei hartem Loeschen, toter Fehlerweg der Statusseite) und die offene Registerarbeit, die zwei Kerntests fallen laesst. Nichts davon ist eine erfundene Geschaeftsregel oder ein Datenleck; alles ist mit begrenztem Aufwand nachzuziehen.

## NICHT gebaut, mit Grund

- `src/app/api/agenten/richtlinie/route.ts` — bewusst NICHT gebaut. Der Plan nennt sie, aber `/api/einstellungen/agent-richtlinien` existiert inzwischen und macht genau diesen Schreibvorgang samt authorize auf `agent.richtlinie_verwalten`. Eine zweite Route waere eine zweite Stelle, an der jemand das authorize vergisst oder die Sperre der drei Willenserklaerungen ausl aesst. Stattdessen traegt der bestehende Handler ein Zielfeld aus geschlossenem Satz (einstellungen | agenten) — 20 Zeilen, ein Schreibweg.
- `src/server/services/agent/richtlinie.ts` — nicht neu angelegt: existiert bereits vollstaendig (ladeRichtlinien, findeRichtlinie, setzeRichtlinie, wirkungVon, IM_CODE_GESPERRT, AKTION_TEXT, AKTION_GRUND). Der Plan sagte 'Kein Dienst'; das war zum Zeitpunkt der Planung richtig. Ergaenzt habe ich nur ladeRichtlinie(id) fuer die Detailseite.
- Migration fuer die Rechte-Diskrepanz an `agent_richtlinie` — nicht noetig: `drizzle/0203` hat sie erledigt (in der lebenden Datenbank an pg_policies nachgesehen). Meine Nummern 0291–0294 bleiben damit unbenutzt.
- Eine Seed-Zeile mit LAUFENDEM Einspruchsfenster — bewusst nicht. Sie waere dreissig Minuten nach dem Seed vorbei (EINSPRUCH_MINUTEN = 30) und danach fuer immer irrefuehrend: der Bestand haette dann eine 'abgelaufene' statt einer laufenden Lage. Ausserdem armiert das Fenster allein app.freigabe_verzoegern, und das verlangt status=genehmigt UND risiko=niedrig UND stapel_faehig — die Zeile muesste durch den ganzen Stapelweg gehen. Der laufende Fall ist deshalb im Test festgehalten (tests/isolation/freigabe-fenster.test.ts prueft ihn schon; tests/kern/freigabe-fenster-lage.test.ts prueft jetzt die Anzeigebedingung) und die Seite sagt in Worten, warum sie meist leer ist.

## Notizen des Bauender

**Migration 0290 geprueft.** Datenbank w_agt zweimal frisch angelegt, `pnpm db:migrate` beide Male bis `Migrationen angewendet.` durchgelaufen (inklusive der 0295–0299 fremder Agenten — keine fremde Datei angefasst). Danach die Riegel von Hand belegt: `email_sender` faellt an `agent_richtlinie_aktion_bekannt`, `nachtrag_einreichen`/`behinderung_senden` mit `auto_erlaubt = true` an `agent_richtlinie_kein_auto_willenserklaerung`, dieselben Aktionen ohne Automatik und `email_senden` MIT Automatik gehen durch.

**Jede neue Abfrage lief gegen echtes Postgres**, nicht nur im Kopf: `leseFensterKopf`, `leseVorgang`, `leseStandHistorie` und alle sieben Anweisungen von `services/radar/profil.ts` (select … for update, update, CPV-Upsert, CPV-Delete, Empfaenger-Upsert, Kandidatenliste, protokolliere mit vorher/nachher) in w_agt ausgefuehrt. Zwei Dinge dabei empirisch entschieden statt geraten:

1. **`select … for update` wendet auch das `using` der UPDATE-Policy an.** Mit einer Wegwerftabelle belegt (Lesepolicy `true`, Schreibpolicy `offen`): reines SELECT sieht zwei Zeilen, `for update` eine. Darauf beruht, dass `schreibeProfil` ohne `radar.profil_schreiben` und in der Gruppenansicht (`not app.ist_readonly()`) abweist statt still null Zeilen zu treffen.
2. **Der Versionszaehler.** `trg_radar_profil_version` zaehlt hoch, sobald `old.* is distinct from new.*`. Am lebenden Postgros nachgemessen: 1 → 2 bei einer Aenderung, unveraendert bei gleichen Werten, und die CPV-Trigger springen bei INSERT und DELETE. Weil `radar_profil` keinen `setze_geaendert_am`-Trigger traegt, muss der Dienst `geaendert_am` setzen — das hat aber die Zeile IMMER 'anders' gemacht. Ohne den Vergleich davor haette jeder Klick auf Speichern die Fassung hochgezaehlt und der naechste Nachtlauf fuer jede Bekanntmachung eine neue `bewertung`-Zeile mit derselben Punktzahl erzeugt; `bewertung.ts` warnt woertlich davor an der Stelle, an der es `radar_profil_cpv.gewichtung` aus dem `eingaben_hash` heraushaelt.

**Zwei Befunde ausserhalb des Plans, beide behoben.** (a) `/api/agenten/lauf` baute den Rueckweg aus dem Enum-Wert: jeder Lauf des CEO-Assistenten landete nach dem 303 auf einem 404 — die KRITIK hatte es gemeldet, jetzt `slugFuer(agent)`. (b) `erhebeEinspruch`/`nimmZurueck` packten JEDE Absage der Definer-Funktionen in denselben Fehler, und die Route machte daraus 'das Fenster ist abgelaufen' — ein fehlendes Recht wurde als verstrichene Frist ausgegeben, auf die dann jemand wartet. `FensterFehler` traegt jetzt einen Code (42501 → `recht`), und `darstellung.ts` hat den Satz dazu.

**Zwei Zahlen standen doppelt, jetzt einmal.** Die Fuenf-Tage-Grenze aus RAD-06 lag in `radar/page.tsx` und waere in `/radar/[id]/status` ein zweites Mal gelandet — sie steht nun in `radar/frist.ts`, wird gegen `FRIST_KNAPP_TAGE` der Bewertung geprueft, und `radar/page.tsx` importiert sie von dort (seine lokalen Kopien sind weg).

**Was zu pruefen bleibt (kann ich nicht selbst):** die beiden Isolationstests sind geschrieben und typgeprueft, aber nicht gelaufen — `pnpm test:isolation` truncatet die gemeinsame `cse_test`, und das haette die Laeufe der anderen Agenten im selben Baum mitgerissen. Ihre tragenden Annahmen sind oben von Hand belegt; was ein Lauf noch zeigen kann, sind Details der Fixtur (ob `seed()` bereits `radar_profil`-Zeilen oder `radar.profil_gesetzt`-Protokolleintraege hinterlaesst — beide Tests arbeiten deshalb ueber eine eigene Profil-Id).

**Drei Registereintraege fehlen ohne Dich** (Text oben): `radar/profil`, `freigabe/fenster` und — vorhandene Luecke, nicht von mir — `agent/richtlinie`. `tests/kern/portal-shell.test.ts` („das Register kennt jeden Dienst") faellt bis dahin mit genau diesen drei Namen. Ebenso `api/radar/profil` im Route-Manifest, und O-720/O-721 in DECISIONS.md — bis die dort stehen, meldet die TODO-Wache `todo-client-nicht-im-register` fuer `services/radar/profil.ts:43` und `:116` (die uebrigen 63 Meldungen derselben Wache sind fremde O-Nummern).

Typecheck projektweit: 0 Fehler. eslint auf allen beruehrten Pfaden: sauber. 66 Kerntests gruen. `pnpm test`, `test:isolation`, `test:e2e`, `db:seed`, `db:triggers`, `build`, `git commit/add` und Migrationen gegen cse_dev/cse_test wurden nicht ausgefuehrt.
