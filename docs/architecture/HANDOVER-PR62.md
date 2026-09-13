# Übergabe nach PR 62 — Stand, offene Punkte, Fallen

Für die nächste Sitzung. Kein Fortschrittsbericht, sondern was jemand wissen
muss, bevor er die nächste Zeile schreibt.

---

## 0. Zuerst: nachsehen, nicht glauben

Dieses Dokument ist eine Behauptung. Bevor du darauf aufbaust, **prüfe sie** —
das kostet etwa zehn Minuten und ist billiger als ein Tag auf einer falschen
Voraussetzung.

```bash
pnpm typecheck && pnpm lint          # lint ruft `pnpm guards` mit auf
pnpm test                            # erwartet: 86 Dateien, 1541 Fälle
pnpm e2e:db && pnpm test:isolation   # erwartet: 76 Dateien, 1407 Fälle
```

**Die Reihenfolge ist nicht beliebig** — siehe §4, zweite Falle. Und wenn du
danach die Browsersuite laufen lässt: `pnpm e2e:db` NOCHMAL, dann
`pnpm test:e2e`. Die Isolationssuite hat die Datenbank inzwischen neu gebaut.

Vier Stellen sind es wert, sie mit eigenen Augen zu lesen, weil an ihnen
hängt, ob der Rest stimmt:

| Datei | Wonach sehen |
|---|---|
| `drizzle/0136_freigabe_posteingang.sql` §7 | `app.freigabe_entscheiden` — nimmt sie einen Hash entgegen? (Sie darf nicht. Sie nimmt **Bytes**.) |
| `drizzle/0137_…sql` §6 | Kommt `vorher_hash` aus `freigabe_snapshot` und **nicht** aus `freigabe_kette`? |
| `src/server/services/freigabe/kette.ts` | Elf Bestandteile, ein `0x1F`, leere Zeichenkette statt `null` |
| `tests/isolation/freigabe-posteingang.test.ts` §4 | Der Golden-Vector — rechnet er den SQL-Hash wirklich nach? |

**Eine Gegenprobe, die sich lohnt** (Sabotagedisziplin): ändere in
`kette.ts` ein Trennzeichen oder lass einen Bestandteil weg und lass §4 der
Isolationssuite laufen. Fällt sie **nicht**, ist der Golden-Vector wertlos und
das Wichtigste an PR 62 ungeprüft. Danach zurücknehmen.

Wenn eine dieser Prüfungen etwas anderes sagt als dieses Dokument, **glaube
der Prüfung** und schreib die Abweichung hierher.

### 0.1 Ergebnis der Prüfung (nächste Sitzung, 13.09.2026)

Alle drei Befehle sagen, was §0 behauptet: `typecheck`, `eslint` und die
Wachen sauber; **86 Dateien, 1541 Fälle**; **76 Dateien, 1407 Fälle**. Die vier
Stellen lesen sich wie beschrieben — `app.freigabe_entscheiden` nimmt Bytes,
0137 §6 holt `vorher_hash` aus `freigabe_snapshot`, `kette.ts` hat elf
Bestandteile und ein `0x1F`, und §4 rechnet den SQL-Hash in TypeScript nach.
**Die Sabotage bissen beide:** mit `TRENNER = 0x1e` fielen genau §4 („der
gespeicherte Hash ist der, den TypeScript berechnet") und §9 („drei
Entscheidungen ergeben eine intakte Kette"), 39 andere Fälle blieben grün.
Zurückgenommen.

Zwei Abweichungen, beide klein:

- **Den nächtlichen Wächter gibt es noch nicht.** `kette.ts` nennt
  `jobs/watchdogs/freigabe-kette-verify.ts`; die Datei existiert nicht (PR 82).
  Wer ihn schreibt, muss den gespeicherten Genesis-Vorgänger
  (`vorheriger_hash = repeat('0', 64)` beim ersten Glied) auf die leere
  Zeichenkette abbilden, bevor er `pruefeKette` ruft — sonst meldet der
  erste Lauf am ersten Glied einen Bruch.
- **Die zweite Falle in §4 gilt anders, seit D-424 gemergt ist.** Die
  Isolationssuite läuft auf Klonen (`cse_test_w1…w4`) und baut `cse_test`
  nur noch dann neu, wenn die Basis Zeilen trägt, die keine Migration anlegt
  — und genau das tut `pnpm e2e:db`. Die Reihenfolge `pnpm e2e:db && pnpm
  test:e2e` bleibt also Pflicht; der Grund ist jetzt der Neuaufbau der
  Basis, nicht mehr das Truncate.

---

## 1. Wo der Zweig steht

Zweig `claude/pr58-kontenrahmen-buchungssatz`, drei Commits über dem
main-Merge (PR #11):

| Commit | Inhalt |
|---|---|
| `0dcba62` | PR 61 (2/2) — `kontoauszug`, `kontoumsatz`, `umsatz_zuordnung` (0135) |
| `9183813` | PR 62 (1/2) — die reinen Funktionen + 0136 |
| *(dieser)* | PR 62 (2/2) — 0137, die Befunde der Isolationssuite |

**Suiten beim Abschluss:** `typecheck` · `eslint` · `pnpm guards` sauber ·
1541 Kerntests · 1407 Isolationstests · e2e siehe §5.

---

## 2. Was PR 62 IST — und was es ausdrücklich noch nicht ist

Gebaut ist **die Maschine**: der Diff, die Konfidenz, die Einstufung, die
Zusammenfassung, die Kette, das Schema und die Entscheidungsfunktion. Jede
Zusage von APR-01, APR-02, APR-03 und APR-07 ist als Riegel in der Datenbank
oder als reine, geprüfte Funktion vorhanden.

> **Stand nach der nächsten Sitzung (13.09.2026):** die zwei Bildschirme und
> die zwei Routen sind gebaut — `src/app/portal/[mandant]/freigaben/`,
> `src/app/api/freigaben/`, Dienste `services/freigabe/laden.ts` und
> `entscheiden.ts`, Codec `diff-json.ts`, Seed `seed/freigaben.ts`, Tests
> `tests/isolation/freigabe-bildschirm.test.ts` und `tests/e2e/freigaben.spec.ts`.
> Die Entscheidungen dazu stehen in D-472. Der Absatz darunter beschreibt den
> Stand VOR dieser Sitzung.

**Nicht gebaut sind die Bildschirme.** `/portal/[mandant]/freigaben` und
`/portal/[mandant]/freigaben/[id]` gibt es nicht, ebenso wenig
`GET /api/freigaben/[id]` (die eine Leseroute mit vorgeschriebener
Nebenwirkung — sie schreibt `freigabe_ansicht`, §4.6) und
`POST /api/freigaben/[id]/entscheidung`.

Das ist die nächste Aufgabe, und sie ist klein, weil alles darunter steht:

- Liste: `sortierePosteingang` liefert die Ordnung, `sortSchluessel` die
  Spalte, die sie erklärt. Nur Zeilen mit `vorgang_typ is not null` (§4).
- Detail: `zusammenfassung(diff, periode, objektNamen)` ist die Kopfzeile,
  `diff.geaendert` die Tabelle, `freigabe_feld` die Nachweisspalte.
- Der Freigabeknopf bleibt **gesperrt**, solange
  `unsichere_felder_anzahl > 0` — die Zahl führt die Datenbank, nicht der
  Dienst.
- Entscheiden geht **nur** über `app.freigabe_entscheiden`. Der Aufrufer
  liefert je jsonb-Spalte auch deren kanonische Bytes
  (`kanonisiere()` aus `finanz/kanonisch.ts`); die Datenbank rechnet die
  Digests selbst.

APR-04 (Stapel), APR-05 (verzögerte Freigabe), APR-06 (Undo) und APR-08
(Stempelerkennung) sind **PR 77**. Ihre Spalten und Riegel stehen bereits in
0136 — bewusst, weil eine Tabelle einmal deklariert wird (K-21) —, aber kein
Dienst schreibt sie.

---

## 3. Die fünf Entscheidungen, die man nicht versehentlich umdrehen sollte

1. **Kein zweiter Kanonisierer in SQL** (D-467). Postgres sortiert
   `jsonb`-Schlüssel nach (Länge, Bytes), RFC 8785 nach UTF-16-Codeeinheiten;
   für `{"b":1,"ab":2}` stimmen sie schon nicht überein. Die Anwendung liefert
   die Bytes, die Datenbank die Digests — wie `fin.rechnung_kette_schreiben`.

2. **Elf Bestandteile in der Kette** (D-466), getrennt durch genau EIN `0x1F`,
   jeder ein kleingeschriebener Hex-Digest **oder die leere Zeichenkette** —
   nie `null`. `tests/isolation/freigabe-posteingang.test.ts` §4 rechnet den in
   SQL geschriebenen Hash in TypeScript nach. **Diesen Test niemals lockern:**
   er ist die einzige Stelle, an der ein Auseinanderlaufen der beiden
   Implementierungen auffällt, bevor der nächtliche Wächter jede Nacht an
   jedem Glied einen Bruch meldet.

3. **Der Riegel hängt an `vorgang_typ`** (D-468, korrigiert in 0137 §4). Wer
   sich als Agentenvorschlag ausweist, muss vorzeigbar sein; eine
   Domänenfreigabe (Behinderungsanzeige, BAU-06) darf offen und schlicht sein.
   Der Posteingangsindex trägt dieselbe Bedingung.

4. **Ein wartender Vorgang wird nur über den Definer entschieden** (D-469).
   `trg_freigabe_snapshot_nur_definer` unterscheidet über `current_user` —
   `session_user` bleibt in einer Definer-Funktion `cse_app` und taugt dafür
   nicht.

5. **`pruefdauer_sek` ist `cse_app` nicht gegeben** (D-470). Ein `grant` gilt
   einer ROLLE, nicht einer Person; § 87 Abs. 1 Nr. 6 BetrVG und **O-06**
   lassen „allen gegeben und in der Oberfläche gefiltert" nicht zu. Wer eine
   Spalte auf `freigabe_snapshot` ergänzt, muss sie ausdrücklich in die
   Grant-Liste in 0137 aufnehmen — das ist Absicht.

---

## 4. Zwei Fallen, die in dieser Sitzung Zeit gekostet haben

**Unter FORCE RLS heisst „keine Policy" *nichts*, nicht *alles*** (D-471).
Eine `security definer`-Funktion, die als `cse_definer` läuft, sieht ohne
eigene Policy null Zeilen — kein Fehler, keine Meldung. In dieser Sitzung
zweimal aufgetreten: beim Lesen (`freigabe_ansicht` → „diese Person hat sie
nie geöffnet") und beim **Schreiben** (`update freigabe_kette` traf null
Zeilen, jedes zweite Kettenglied bekam den Genesis als Vorgänger). Der zweite
Fall wäre ohne den Golden-Vector-Test unbemerkt geblieben. Wer eine
Definer-Funktion schreibt, prüft **jede** Tabelle, die sie anfasst, auf Grant
UND Policy.

**`cse_test` gehört der Isolationssuite UND der Browsersuite.** `pnpm
test:isolation` baut die Datenbank neu; danach ist die e2e-Datenbank leer und
alles fällt mit „KeinRendererFehler". Die Reihenfolge ist immer
`pnpm e2e:db && pnpm test:e2e`, und niemals beides gleichzeitig. (Die
Browsersuite startet ausserdem einen eigenen Next-Server auf Port 3000; wird
sie abgebrochen, bleibt er stehen und der nächste Lauf scheitert an
„already used".)

---

## 5. Zwei rote Browserfälle, die NICHT aus PR 61/62 stammen

`tests/e2e/agenten.spec.ts` fällt in zwei Fällen, reproduzierbar auch allein.
Beide stammen aus dem main-Merge (PR #11, Commit `7e17941`, D-416–D-423) und
sind **nicht** durch diese Arbeit verursacht. Ich habe sie bewusst **nicht**
angepasst, weil in einem davon eine echte Produktfrage steckt:

| Fall | Beobachtung | Bewertung |
|---|---|---|
| `wer das Recht nicht hält, sieht das Zentrum nicht (AUT-06)` | Der Kunde wird auf `/portal/kunde` **weitergeleitet** (200), der Test erwartet 404 | Das Verhalten ist richtig und ausdrücklich so gebaut (K-04-Decke, `zugang.ts`: „eine Arbeiterin … landet in ihrem Portal — nicht auf einem 404, das sie ratlos zurücklässt"). Es verrät nichts über die Existenz der Seite, erfüllt AUT-06 also dem Sinn nach. **Der Test beschreibt altes Verhalten.** |
| `das Budget nennt seine Obergrenze` | Die Gruppen-Administration bekommt auf `/portal/reinigung/agenten/budget` 404 | `admin@cse-gruppe.de` hat **keine** Mitgliedschaft; `/dev/anmelden` setzt sie in die Gruppenansicht, und eine Mandantsseite antwortet dort 404 (Invariante 10). Der Test tut nicht, was sein eigener Kommentar sagt („Der Gruppenadmin wechselt dafür in die Gesellschaft"). **Offene Frage:** sollte ein Gruppenadmin auf einer Mandantsseite das Wechselblatt sehen (`slugTor` kann es), statt 404? Heute prüft `portalZugang` das Recht VOR dem Wechselangebot, also erscheint das Blatt nie. |

Ausserdem fiel `tests/e2e/zahlung.spec.ts:155` im Gesamtlauf und ist
**allein grün** (5/5) — eine Abhängigkeit von der Laufreihenfolge, keine
Regression. `scripts/e2e-db.sh` beschreibt diese Klasse im Kopf.

---

## 6. Was als Nächstes ansteht (Kunden-PR-Nummern)

- **PR 62 Rest** — die zwei Bildschirme und die zwei Routen (§2).
- **PR 63** — Eingangsrechnung: OCR → Extraktion → Buchungsvorschlag →
  Freigabe. Hängt an PR 62: `freigabe_feld` ist genau die Tabelle, in die die
  Extraktion schreibt.
- **PR 64** GoBD-Archiv · **PR 65** Offene Posten · **PR 66** Z3-Export ·
  **PR 67** Jahrespaket.
- **Phase 8** — PR 68–82 (Radar, pgvector, Agentenwerkzeuge, die vier Agenten,
  Wächterläufe). **PR 77** holt APR-04/05/06/08 nach.

**Noch offen und in PR 62 bewusst nicht erfunden:** O-114 (gehört die
Zuschlagsgruppe zur Identität einer Position?), O-197 (ab welcher Konfidenz
ist ein Feld unsicher?), O-06 (personenbezogene APR-08-Auswertung,
§ 87 BetrVG), O-04/O-05 (die Vergleichsauflöser je Vorgangsart).
