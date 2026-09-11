# Phase 5 — Stand

Zweig `claude/phase-5-dienstplan-zeit`. Diese Datei sagt, was steht, was laeuft
und was als naechstes dran ist — damit eine neue Sitzung nicht raten muss.

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
| — | **Die Einteilung** (`einsatz_zuordnung`) — der Schreibweg, den es nicht gab | 8 Isolationstests |
| — | **Der Zeitbereich** (Wochenliste, Live-Brett, Einzelblatt, Korrekturbuch, MiLoG) | 6 Browsertests |

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

PR 40 (Reinigung), 41 (Security A) und 43 (Bau A) waren zuletzt in Arbeit.
Danach fehlen 39 (Mitarbeiterportal), 42 (Security B), 44/45 (Bau B/C).

Zwei Stuecke aus PR 38 haengen an offenen Fragen:
- Die **Sollzeitgutschrift** einer Abwesenheit ins Stundenkonto braucht die
  Sollstundenregel (O-18). Die Schnittstelle steht, die Regel wirft.
- Ob eine Abwesenheit in EINER Gesellschaft die Person auch in der anderen
  unverfuegbar macht, ist **O-209** — es waere die zweite Durchlaessigkeit in
  der Mandantenwand, und K-06 laesst genau eine zu.

Bei **Phase 7** ist eine zusaetzliche, unabhaengige Pruefrunde vereinbart,
bevor der PR aufgemacht und die Copilot-Schleife gefahren wird.
