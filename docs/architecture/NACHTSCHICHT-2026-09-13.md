# Nachtschicht 13./14.09.2026 — Plan, Fortschritt, Entscheidungen

Für die Auftraggeberin, die morgens liest. Was hier steht, ist geprüft
(Suiten grün, Befehle genannt) oder als offen markiert — nichts dazwischen.

## Auftrag

„Weiterbauen und prüfen, die ganze Nacht; Fragen selbst entscheiden;
Firmendaten vom bestehenden Auftritt (cse-dienstleistungen.de) übernehmen;
am Design arbeiten; Plan für alles Bisherige; Budget bis zum Morgen halten."

## Ausgangslage (geprüft, §0 der Übergabe)

- `typecheck`, `eslint`, Wachen sauber · Kern 86 Dateien / 1541 Fälle ·
  Isolation 76 Dateien / 1407 Fälle — genau wie in `HANDOVER-PR62.md` behauptet.
- Sabotage an `kette.ts` (Trennzeichen): §4 und §9 fielen, 39 blieben grün.
  Der Golden-Vector ist echt.
- Bestandsaufnahme der Seitenkarte (`scripts/seitenkarte/stand.ts`,
  `pnpm seitenkarte:stand`): **432 Routen, 179 gebaut (41 %)**. Für die
  Phasen 1–6, die die ROADMAP abhakt, fehlen **166 von 323** Routen — sie
  zeigen „Dieses Modul wird noch gebaut" oder existieren gar nicht
  (`/auth/login`, die Unterseiten der Gesellschaftsprofile). Die Haken der
  ROADMAP meinen die Abnahmekriterien der PRs, nicht jede Zeile der Karte.

## Reihenfolge dieser Nacht — und warum

1. **PR 62 zu Ende** (Posteingang und Prüfung). Klein, alles darunter stand.
2. **Lücken zuerst, Roadmap danach.** Die Auftraggeber urteilen nach dem, was
   sie anklicken können; Phase 7/8 (OCR, Radar, Agenten) baut auf Schichten,
   die sie nicht sehen. Reihenfolge nach Sichtbarkeit: Gruppenansicht →
   Finanzen → Einstellungen → öffentliche Unterseiten → Rest.
3. **Echte Firmendaten** aus dem bestehenden Auftritt in Seed und Inhalt —
   nur, was dort wirklich steht; alles andere bleibt als Platzhalter markiert.
4. **Design**: gezielt, nach DESIGN.md, keine neuen Werte.
5. Danach, soweit die Nacht reicht: PR 63 ff.

## Fortschritt

| Zeit (UTC) | Was | Prüfung |
|---|---|---|
| 19:30 | Übergabe §0 verifiziert, Abweichungen eingetragen | Suiten, Sabotage |
| 20:00 | PR 62 Rest: Dienste (`laden.ts`, `entscheiden.ts`, `diff-json.ts`), drei Routen, zwei Seiten, Seed mit vier Vorschlägen, Isolations- und Browsertests, D-472 | Kette: typecheck · Kern · e2e:db · `freigaben.spec` · Isolation |
| 20:20 | Fund dabei: `postgres` kodiert einen JSON-**Text** für `::jsonb` ein zweites Mal — Objekte übergeben, nie Strings (`fuerJsonb`). Der Isolationstest §3 rechnet seither die gespeicherten Bytes nach. | Isolation §3 |
| 20:30 | Echte Firmendaten von cse-dienstleistungen.de und select-security.de in Seed und Inhalt (Anschrift 201 statt 21, Rufnummern, E-Mail, zehn Leistungen je Haus, Leitsätze); Firma „Select Security Event GmbH" wie im Impressum; D-473 | Kern, Isolation `profil` |

## Entscheidungen, die ich allein getroffen habe

- **Gruppenadmin auf einer Mandantsseite:** siehe Abschnitt unten, sobald
  entschieden.
