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

## Offen in dieser Phase

PR 35 (Offline-Warteschlange, Medien) und PR 36 (Zeit → Auftrag, Monatssplit,
MiLoG) waren zuletzt in Arbeit. Danach haengen 37–39 an 36, und 40/41/43 an 35.

Bei **Phase 7** ist eine zusaetzliche, unabhaengige Pruefrunde vereinbart,
bevor der PR aufgemacht und die Copilot-Schleife gefahren wird.
