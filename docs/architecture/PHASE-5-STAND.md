# Phase 5 — abgeschlossen

Zweig `claude/phase-5-dienstplan-zeit`; der Stand der Abgabe liegt eingefroren
auf `claude/phase-5-abschluss`. Diese Datei sagt, was steht, was dabei gefunden
wurde und wo Phase 6 anfaengt — damit eine neue Sitzung nicht raten muss.

**PR 30 bis 45 sind fertig**, 49 Commits. Dazu gehoeren die drei Gewerkemodule
(Reinigung, Security, Bau) und das Mitarbeiterportal in vier Sprachen. Die
Pruefung der Abgabe: Merge-Wachen sauber, `tsc` sauber, `eslint .` sauber,
953 Einheitstests, 833 Isolationstests, e2e gegen einen echten Produktionsbau.

## Fertig und gepusht

| PR | Inhalt | Belegt durch |
|---|---|---|
| **30** | Feiertage, RRULE, `feiertag`/`planungsserie`/`einsatz`/`einsatz_zuordnung`, `revier`/`turnus`/`turnus_ausnahme`, `app.loese_ortszeit`, Generator + naechtlicher Job | 19 Einheits-, 12 Isolationstests |
| **31** | `nachweis`, `qualifikation`, `bewacher_eintrag`, `einsatzanforderung`, §34a-Hartsperre im Dienst | 21 Einheits-, 28 Isolationstests |
| **32** | `zeit_intern.arbeitszeit_fenster` (K-06), `app.arbzg_belastung`, `arbeitszeit_verstoss`, `planungs_konflikt`, Pruefdienst + Detektor + Job | 11 Isolationstests |
| **33** | Wochen-, Monats- und Tagesansicht, Einsatzblatt, Serienliste, Konflikteingang | 15 Einheits-, 9 Browsertests |
| **34** | Check-in mit Token, serverautoritative Zeit, `zeiteintrag`, Korrekturspur, `mandant_einstellung` | 32 Isolations-, 7 Einheits-, 6 Browsertests |
| **35** | Offline-Warteschlange, Medien mit EXIF-Bereinigung und signierter Adresse | 18 Isolations-, 16 Einheitstests |
| **36** | Zeit → Auftrag, Monatssplit, § 17-MiLoG-Aufzeichnung, Zeit-Einwand | Isolations- und Einheitstests |
| **37** | Stundenkonto, Urlaubskonto, Monatsabschluss (Einbahnstrasse) | 19 Isolations-, 9 Einheitstests |
| **38** | `abwesenheit`, `antrag`, Genehmigungseingang, Kennzeichnung im Dienstplan | 12 Isolations-, 12 Einheitstests |
| **39** | Mitarbeiterportal `/portal/mein` in de/en/ar/tr, lesend bis auf zwei Selbstzugriffs-Routen | 19 Isolations-, 33 Einheitstests |
| **40** | Reinigung: Reviere, Turnus-Raumzuordnung, Leistungsnachweis mit Unterschrift, Reklamation, Qualitaetspruefung | 20 Isolations-, 22 Einheitstests |
| **41** | Security A: Posten, Wachbuch als Hash-Kette, kurzfristige Eventbesetzung | 23 Isolations-, 6 Einheitstests |
| **42** | Security B: versionierte Dienstanweisung mit Kenntnisnahme, Schluesselquittungen | 34 Isolationstests |
| **43** | Bau A: Leistungsverzeichnis mit OZ-Hierarchie, Aufmass mit eigenem Rechenansatz-Parser | 35 Isolations-, 43 Einheitstests |
| **44** | Bau B: Nachtraege, Behinderungsanzeige, Warnung ausserhalb des LV | 44 Isolations-, 28 Einheitstests |
| **45** | Bau C: Bautagebuch, DWD-Wetter (nicht verbunden), Mannstundenabgleich | 19 Isolations-, 16 Einheitstests |
| — | **Die Einteilung** (`einsatz_zuordnung`) — der Schreibweg, den es nicht gab | 12 Isolationstests |
| — | **Der Zeitbereich** (Wochenliste, Live-Brett, Einzelblatt, Korrekturbuch, MiLoG) | 6 Browsertests |
| — | **Die Stundenkonten** (Liste, Kontoblatt, Monatsabschluss) — PR 37 hatte keinen Aufrufer | 5 Isolationstests |
| — | **Das Nachweisregister** (60/30/7) — der Ablaufwaechter meldete an niemanden | 6 Isolationstests |
| — | **Personenliste, Nacherfassungseingang, vier neue Dashboard-Kacheln** | 4 + 3 Isolationstests |

Dazu ausserhalb der PR-Liste: der Iconsatz (`src/lib/design/icons.ts`, DESIGN §5),
acht Platzhalterszenen, Dienstplan-Kacheln auf dem Dashboard, und die
Demodaten, die der **echte** Generator erzeugt.

## Drei Entscheidungen, die eine spaetere Sitzung sonst wieder faellt

1. **`turnus` gehoert in PR 30, nicht in PR 40.** `planungsserie` verlangt genau
   einen Bedarfstraeger, und ohne ihn ist der Generator nicht testbar. PR 40
   nennt CLN-02 selbst nur als *consumer*.
2. **Die Dauer ist nominal auf der Wanduhr.** 22:00 + 480 Minuten ist 06:00 —
   in jeder der drei Naechte. Der Instantabstand unterscheidet sie
   (480/420/540), nicht die Uhrzeit. Andersherum endete die Schicht in der
   Vorstellungsnacht um 07:00 Ortszeit.
3. **Der Horizont ist eine ANZAHL Tage**, also endet er auf `heute + tage - 1`.
   Mit `heute + 56` waeren es 57 Tage und neun statt acht Wochen.

## Betrieb

- `cse.fenster_schluessel` muss als **Datenbankeinstellung** gesetzt sein,
  bevor `app.arbzg_belastung` das erste Mal laeuft (07-INTEGRATIONEN §29).
  `scripts/test-db.sh` setzt einen offensichtlichen Testwert.
- Isolationstests **truncaten die Datenbank**, gegen die sie laufen. Eine
  Datenbank, aus der jemand Screenshots macht, gehoert nicht in
  `TEST_DATABASE_URL`.
- **Die e2e-Datenbank braucht `pnpm content:import` nach `pnpm db:seed`.** Die
  oeffentlichen Seiten lesen ihren Inhalt aus `seite`/`abschnitt` (PUB-07);
  ohne den Import antwortet `/` mit **404**, und 42 Faelle in `a11y`,
  `sprachen` und `seo` scheitern an etwas, das wie ein kaputter Bildschirm
  aussieht und eine fehlende Zeile ist. `.github/workflows/a11y.yml` macht es
  richtig; wer die Suite von Hand fahert, vergisst es.

## Was von Hand nachgewiesen ist

Die Anzeige bleibt **Europe/Berlin**, auch wenn der SERVER woanders steht:
mit `TZ=America/New_York` gestartet und im Browser derselben Zone geoeffnet
zeigt der Dienstplan weiter `22:00–06:00 · 8,00 h`. Das ist die Zusage aus
PR 33 (5) auf der Serverseite; die Browserseite deckt
`tests/e2e/dienstplan.spec.ts` ab, und dass kein Anzeigepfad ohne `timeZone`
formatiert, sichert die Merge-Wache `anzeige-zeitzone`.

Strukturell traegt das Ganze eine einzige Zusage: **jede Uhrzeit kommt fertig
aus der Datenbank**. Der Node-Prozess rechnet keine Zone um — es gibt genau
eine Umrechnung, `app.loese_ortszeit`, und die laeuft in Postgres.

## Fuenf Fehler, die erst der Betrieb zeigte

Sie stehen hier, weil jeder von ihnen still war — kein Absturz, keine
Fehlermeldung, nur ein falsches oder fehlendes Ergebnis.

1. **Es gab keinen Schreibweg auf `einsatz_zuordnung`.** Der Generator legte
   Schichten an, die Konfliktliste zeigte Befunde, die Zeiterfassung wartete —
   und niemand konnte eingeteilt werden. Ohne Einteilung gibt es keinen
   Check-in-Link, keinen Zeiteintrag, keine ArbZG-Belastung und keine
   Abrechnung. Jetzt: `services/dienstplan/einteilung.ts` plus zwei Routen.
2. **`app.arbzg_befund_schreiben` schrieb nie etwas.** Der Aufrufer uebergab
   `null` fuer die Gesellschaften, und `foreach … in array null` laeuft null
   Mal: `arbeitszeit_verstoss` blieb leer, und die Konfliktkarte zeigte nie
   eine Regel. Behoben in `0064`.
3. **`kern.checkin_token_widerrufen` scheiterte fuer die Anwendung.** Der
   Ausloeser widerruft Marken als `cse_app`, und `cse_app` hat auf
   `checkin_token` bewusst kein Recht (K-01, K-08). Jetzt `security definer`
   (`0063`).
4. **Die Arbeitszeitpruefung starb an einer echten Stempelzeit.** `now()` hat
   Mikrosekunden; `dauerMinuten` verlangte volle Minuten und warf. Nach dem
   ersten echten Check-in scheiterte jede Einteilung dieser Person. Jetzt
   rundet die Regelrechnung (`dauerMinutenGerundet`/`-Abgerundet`).
5. **§ 4 ArbZG meldete auf jeder Nachtschicht eine fehlende Pause.** Der Plan
   kennt keine Pausenspalte (O-168), und der K-06-Leser gibt keine zurueck —
   daraus `0 min` zu machen hiess „keine Pause erfasst". `pauseMinuten` ist
   jetzt `number | null`, und `null` erzeugt keinen Befund: eine Warnung, die
   sich nicht aufloesen laesst, bringt der Planung bei, Warnungen
   wegzuklicken.

## Offen in dieser Phase

Hier stand: „PR 40, 41 und 43 waren zuletzt in Arbeit; danach fehlen 39, 42
und 44/45." Das war der Stand einer frueheren Sitzung und widersprach der
Tabelle zwoelf Zeilen weiter oben, die dieselben PRs mit Testzahlen als
fertig auffuehrt. Wer nur diesen Abschnitt las, haette sechs fertige Module
noch einmal gebaut — und der Bau haette die bestehenden ueberschrieben, weil
man nicht nachbaut, was man fuer fehlend haelt.

**PR 30 bis 45 sind fertig**; offen ist in dieser Phase nichts an Modulen.
Was bleibt, sind Fragen, die niemand im Code beantworten kann.

Zwei Stuecke aus PR 38 haengen an offenen Fragen:
- Die **Sollzeitgutschrift** einer Abwesenheit ins Stundenkonto braucht die
  Sollstundenregel (O-18). Die Schnittstelle steht, die Regel wirft.
- Ob eine Abwesenheit in EINER Gesellschaft die Person auch in der anderen
  unverfuegbar macht, ist **O-209** — es waere die zweite Durchlaessigkeit in
  der Mandantenwand, und K-06 laesst genau eine zu.

Bei **Phase 7** ist eine zusaetzliche, unabhaengige Pruefrunde vereinbart,
bevor der PR aufgemacht und die Copilot-Schleife gefahren wird.


---

## Wo Phase 6 anfaengt

**PR 46 (Rechnungs-Lebenszyklus) ist fertig** und liegt bereits auf dem
Arbeitszweig: `0075_rechnung` / `0076_rechnung_unveraenderlich` /
`0077_rechnung_hash`, `services/finanz/rechnung.ts`, die Routen unter
`api/rechnungen/**` und die Seiten unter `finanzen/rechnungen/**`. Seine
Isolationstests sind die schaerfsten des Baums: 1.000 Entwuerfe anlegen und
verwerfen hinterlaesst **null** Luecken, fuenfzig GLEICHZEITIGE
Festschreibungen ziehen fuenfzig Nummern ohne Dublette, und eine
festgeschriebene Rechnung laesst sich **auch als Eigentuemer der Tabelle**
nicht aendern.

Als naechstes laufen PR 47 (§ 14-UStG-Validator), PR 48 (fuenf
Abrechnungsarten) und PR 49 (Positionsherkunft). Ihre Entscheidungen stehen in
`docs/DECISIONS.md` unter „PHASE 6, NICHT IN DIESEM ZWEIG" — der Code dazu
liegt auf `claude/phase-5-dienstplan-zeit`, nicht hier.

**Die Migrationsnummer wird nicht aus diesem Dokument abgeschrieben,
sondern in `drizzle/` nachgesehen.** Hier stand „ab `0085`"; `0085` und die
Nummern darueber sind seither vergeben, und jede weitere Sitzung vergibt
weitere. `drizzle` nummeriert nicht, es sortiert nur — zwei Dateien mit
derselben Nummer sind keine Fehlermeldung, sondern zwei Migrationen in
unbestimmter Reihenfolge. Wer eine neue braucht, nimmt die naechste, die in
`drizzle/` noch fehlt. `0068`–`0071` aus dem PR-Plan sind ohnehin laengst
vergeben.

## Die Schuld, die benannt ist

**K-01 gilt nicht** (D-300): 95 von 98 `SECURITY DEFINER`-Funktionen gehoeren
`postgres` statt `cse_definer` und laufen damit an jeder RLS vorbei. Die
Reparatur ist ausprobiert und beschrieben; sie braucht eine eigene Pruefrunde,
weil jede lesende Stelle sonst still null Zeilen liest.
`tests/isolation/definer-eigentum.test.ts` friert die 95 ein: **jede neue**
Definer-Funktion muss `alter function … owner to cse_definer` mitbringen.

## Wachen, die es seit Phase 5 gibt

| Wache | Was sie verhindert |
|---|---|
| `datum-zone-ueberladung` | `($1::date) at time zone …` — das Tagesfenster begann im Sommer vier Stunden zu spaet |
| `todo-client-*` (repariert) | Der Ausdruck traf `TODO(client, O-nn)` nie; die Wache meldete jahrelang gruen |
| `spaltennamen.test.ts` | Eine `insert`-Spaltenliste, die eine Spalte nennt, die es nicht gibt |
| `definer-eigentum.test.ts` | Eine neue Definer-Funktion, die als Superuser laeuft |
| `tableiste.test.ts` (erweitert) | Ein Navigationspunkt, der nur die Auffangseite erreicht |
