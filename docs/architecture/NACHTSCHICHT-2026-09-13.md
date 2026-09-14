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
| 21:10 | PR 62 Rest committed und gepusht (`aae527f`). Zwei Funde beim Abschluss: `text(inet)` hängt `/32` an (Test liest `host()`); `freigabe` fehlte im Querschnitt, vier Dienste im Register, drei Routen im Manifest — alles nachgetragen. | 6/6 Browser, Isolation, 1547 Kern, lint, typecheck |
| 21:40 | **D-474**: Gruppensitzung auf Mandantsseite → Wechselblatt statt 404; `zurueck` mit Allowlist (`rueckwegImBereich`), Redirect über `internesZiel`; 114 Seiten geben den Rückweg mit; beide roten Fälle in `agenten.spec` entschieden, keiner abgeschwächt. | `tests/kern/rueckweg.test.ts`, typecheck |
| 22:30 | **D-475**: Gruppenansicht — Tor (`gruppe/tor.tsx`), vier Dienste (`services/gruppe/*`), 16 lesende Seiten (Übersicht, Aufträge, Kunden, Anfragen, Projekte, Objekte, Personen, Finanzen, Rechnungen, Offene Posten, Freigaben, Dokumente, Protokoll, Agenten, Dienstplan mit ArbZG über Gesellschaften, Auslastung). Zelle ohne Recht = Strich, nie Null. | Isolation `gruppe-dienste` 5/5, Kern `gruppe-finanzen`, 1555 Kern, lint, typecheck, Browser `gruppe.spec` (siehe unten) |

| 23:00 | Browserlauf der Gruppenansicht: zwei Funde. (1) `projekt` gibt `cse_app` nur Spaltenrechte, die Geldspalte fehlt — die Gruppenliste zeigt keine Auftragssumme mehr. (2) Nach dem Wechsel landete die Super-Administration auf `/portal/mein`: `sitzung_aufloesen` kannte nur die Mitgliedschaftsrolle → **0138** nimmt die globale Rolle als zweite Quelle (TEN-08). | Isolation `auth` 20/20, Browser (zweiter Lauf, siehe unten) |

| 23:20 | Zweiter Browserlauf nach 0138: `gruppe.spec` 6/6, `agenten.spec` 6/6, `freigaben.spec` 6/6 — **18/18**. | Playwright auf frisch geseedeter `cse_test` |

| 23:50 | **D-476**: Einstellungen — Einstieg (Karten aus dem Manifest), Unternehmensdaten, Benutzer (+ Konto), Rollen (+ Matrix), Module, Protokoll; `mandantTor` als gemeinsames Tor neuer Mandantsseiten; O-361 (Menüpunkt). | typecheck, eslint, Browser `einstellungen.spec` (siehe unten) |

| 00:20 | Browser `einstellungen.spec` 4/4 (nach Reseed — die Isolationssuite hatte `cse_test` leer hinterlassen; genau die Falle aus der Übergabe). **D-477**: Integrationen (Zustand aus den Adaptern) und Auftragsverarbeiter (Art. 30, kein erfundenes Datum). | Kern `integrationen`, Browser (fünfter Fall, siehe unten) |

| 00:40 | Browser `einstellungen.spec` 5/5 (mit Integrationen und Auftragsverarbeitern). Lehre des Abends: `scripts/test-db.sh up` baut `cse_test` neu, sobald eine Migration dazukommt (Abdruck) — danach IMMER `pnpm e2e:db`, sonst „kein Seed-Konto". | Browser, Kern 1558, lint |

| 01:10 | **D-478**: Ablage (`/dokumente`, `/dokumente/[id]`) — der letzte Seitenleistenpunkt ohne Seite — mit Filter, Suche, Schlagworten und dem ehrlichen „Speicher nicht verbunden"; Beschäftigungsblatt (`/personal/anstellungen/[id]`) mit Stundenkonto und Abwesenheiten, Rechte vorher gefragt. | typecheck, eslint, Browser `dokumente.spec` (siehe unten) |

| 01:40 | Beschäftigungsblatt: `abwesenheitsart_id` ist Spaltenrecht (gesundheitsnah) — Art weggelassen, Zeitraum und Status bleiben. Steuer-Seite (`/einstellungen/steuer`) aus `steuersatz_gruppe`. Übergabe §7 geschrieben. | Browser `dokumente.spec` + `einstellungen.spec` (siehe unten) |

| 02:00 | Browser `dokumente.spec` 4/4 und `einstellungen.spec` 5/5 (mit Steuer) — **9/9**; Commit `4ddeea3` gepusht. | Playwright auf frisch geseedeter `cse_test` |

| 02:30 | **D-479**: Finanzübersicht `/portal/[mandant]/finanzen` — das Ziel des Tabs „Finanzen" der globalen Leiste (bisher Platzhalter): rechtegebundene Kacheln, Karten aus dem Manifest. | typecheck, eslint, Browser `finanzen-uebersicht.spec` (siehe unten) |
| 02:45 | **D-480**: Copilot-Runde auf PR 12 — 0139 (Definer-Schnitt, Archivlauf als Job, `dokument_zugriff`), CAMT-Richtung/-Währung, Byte-Hashing, Buchungssperre, Klärung mit Ausgang, UUID-Wachen, Rollen, DATEV-Datei, Benachrichtigungsziel, Serverzeit. | Kern 91/1573, Isolation 79/1430, typecheck, eslint |
| 03:30 | **D-481**: Marken (vorläufig, O-12), Fußbereich, Datenschutzerklärung vom Auftritt, sechs Glyphen, Held mit Aufrufen. | Browser: website, seo, sprachen, firmenangaben, a11y (öffentlich) |

Stand der Seitenkarte nach D-478 (`pnpm seitenkarte:stand`, 01:15 UTC):
**218 von 432 Routen gebaut** (173 statisch + 45 dynamisch) — zu Beginn der
Nacht 179. Phase 1: 14 von 25 (die Einstellungen), Phase 3: 16 von 30,
Phase 4: 36 von 55, Phase 5: 83 von 123, Phase 6: 19 von 42, Phase 7: 12 von 29,
Phase 8: 18 von 32. Was fehlt, ist überwiegend Schreibfläche (Formulare,
Verwaltung) und Phase 9.

## Entscheidungen, die ich allein getroffen habe

- **Gruppenadmin auf einer Mandantsseite (D-474):** das Wechselblatt, nicht
  404 — ein GET wechselt nie, der POST führt auf die gemeinte Seite zurück.
  Der Test prüft mehr als vorher, nicht weniger.
- **Kunde auf einer Mandantsseite:** die K-04-Decke ist richtig und bleibt;
  der Test beschrieb den alten Stand und prüft jetzt den dokumentierten.
- **„Gewinn" in der Gruppenfinanzsicht (D-475):** nicht erfunden. Gezeigt wird
  „Saldo aus Rechnungen" mit dem Satz, dass es keine GuV ist.
- **Karte der Objekte:** nicht gebaut — ein Kartendienst ist ein
  Auftragsverarbeiter (O-360). Adressen stehen in der Liste.
- **Radar, Kalender, Berichte in der Gruppe:** bleiben ehrlich „noch nicht
  gebaut" — die Tabellen darunter gibt es noch nicht (Phase 8/9).
