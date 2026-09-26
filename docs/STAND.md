# Stand und Übergabe — 21.09.2026

Dieses Blatt ist für **die nächste Sitzung**, nicht für das Archiv. Es sagt, wo
die Arbeit steht, was gemessen und noch nicht gebaut ist, und welche Fäden
offen in der Luft hängen.

## 1. Was gesichert ist

Alles Gebaute liegt auf `claude/i18n-verwaltung-zweisprachig-fl57f2`, gepusht.
Die letzten drei Commits:

| Commit | Was |
|---|---|
| `d1feae0` | `docs/VOLLSTAENDIGKEIT.md` — 136 belegte Lücken, `V-001…V-102` |
| `51ade23` | V-001 + V-020 — ein Objekt lässt sich anlegen, ändern, archivieren |
| `0d63c94` | V-028…V-040 — 21 gebaute Bildschirme kommen aus dem Nichts; V-035/V-036 |

Alle fünf Tore waren bei jedem Push aus ihrer **eigenen** Ausgabe gelesen:
`guards` sauber · `typecheck` 0 · `eslint` 0 · 3641 Unit · 2982 Isolation.

## 2. Der Maßstab hat sich geändert — die Master-Spezifikation liegt vor

Der Auftraggeber hat die **vollständige ursprüngliche Anforderungsliste**
nachgereicht (33 Abschnitte, „CSE PLATFORM – COMPLETE MASTER BUILD
SPECIFICATION"). Sie ist ab jetzt der Maßstab, an dem der Bestand gemessen
wird — nicht nur das Vollständigkeitsregister.

**Ihr Abschnitt 34 sagt „START NOW WITH THE ARCHITECTURE AND PHASE 1".** Das
ist der Stand von damals, nicht von heute: der Bestand führt 374 Migrationen,
441 Routen und 6623 Prüfungen. Die Spezifikation wird deshalb als **Messlatte**
benutzt, nicht als Bauauftrag von vorn. Der Auftraggeber hat das bestätigt:
„لازم كلشي يكون موجود واحسن كمان" — alles muss da sein, und besser.

### Zwei Zusagen der Spezifikation stehen gegen geltendes Recht

Sie müssen dem Auftraggeber **ausdrücklich vorgelegt** werden; sie sind kein
Versäumnis, sondern eine Entscheidung, die ihm gehört:

1. **§ 13 — KI-Ansprache an gefundene Firmen.** § 7 UWG verbietet
   unaufgeforderte elektronische Werbung ohne vorherige ausdrückliche
   Einwilligung, **auch im B2B**. `CLAUDE.md` schließt das ausdrücklich aus.
   Gebaut ist stattdessen: ausgehende Nachrichten nur an Kontakte mit
   **erfasster Rechtsgrundlage** (`kunde.rechtsgrundlage`,
   `app.darf_kontaktiert_werden`), mit vollständiger menschlicher Freigabekette.
2. **§ 14 — Recruiting über Indeed/StepStone.** Scraping verstößt gegen deren
   AGB und schafft DSGVO-Risiko. `CLAUDE.md` schließt es aus. Gebaut ist der
   Weg über **eingehende** Bewerbungen.

Alles Übrige aus der Spezifikation wird gebaut.

## 3. Zwei Läufe hingen beim Abbruch in der Luft

Ihre Ergebnisse liegen **außerhalb des Repositorys** und sind mit dem Container
verloren. Beide sind reine **Messungen**, kein Code — sie lassen sich jederzeit
neu starten, und die Skripte sind gesichert:

| Lauf | Zweck | Skript |
|---|---|---|
| `wf_ed6cf23b-857` | Vier fehlende Anlegewege (V-002 Revier, V-003 Bauprojekt, V-004 Veranstaltung, V-017 Kunde ändern): Tabelle, Zwänge, Trigger, Rechte — und die Fehlerkette, die ein Insert wirklich wirft | `…/workflows/scripts/cse-anlegewege-r1-wf_ed6cf23b-857.js` |
| `wf_d3e5ee43-ec9` | Abgleich der 33 Spezifikationsabschnitte gegen den gemessenen Bestand, mit Gegenprobe auf **Erreichbarkeit** und **Schreibweg** | `…/workflows/scripts/cse-abgleich-masterspec-wf_d3e5ee43-ec9.js` |

Sind die Skriptdateien weg, stehen beide Aufträge vollständig in der
Sitzungsniederschrift und lassen sich neu formulieren.

## 4. Gemessen, aber noch nicht gebaut: V-049

Die nächste Arbeit war **V-049 — eine Schicht zusagen oder absagen**. Die
Erkundung ist fertig; damit sie nicht zweimal gemacht werden muss, steht sie
hier vollständig.

**Der Befund.** `zuordnung_status` kennt `zugesagt`, und **17 Stellen lesen den
Wert** — aber **keine einzige schreibt ihn**. Gegenprobe:
`grep -rn "= 'zugesagt'" src/ drizzle/` findet nur die Enum-Zeile
(`drizzle/0028_dienstplan.sql:98`) und lesende Abfragen. Der einzige `UPDATE`
auf `einsatz_zuordnung.status` ist `services/dienstplan/einteilung.ts:757`
(`abgesagt`, durch das Büro).

**Die Folge ist keine Kosmetik.** `services/dienstplan/besetzungsluecke.ts:195`
und der Nachtwächter `dienstplan.morgen_unbesetzt`
(`waechter/benachrichtigung.ts:62`: „Gezählt werden ZUSAGEN, nicht
Einteilungen") zählen genau diesen Zustand. Die Besetzungswarnung meldet
deshalb für **jede** Schicht null Zusagen. Der Pillenzweig „Bereit"
(`portal/mein/bausteine.tsx:158`) ist unerreichbar.

### Was an der Datenbank gemessen wurde

`einsatz_zuordnung` (`drizzle/0028_dienstplan.sql`):

- **`ez_absage_begruendet`** — `status <> 'abgesagt' OR (abgesagt_am IS NOT NULL
  AND btrim(coalesce(absage_grund,'')) <> '')`. Eine Absage **ohne Grund ist
  in der Datenbank unmöglich**. Das ist die Regel, an der die Oberfläche hängt.
- **`ez_qualifikation_geprueft`** — `abgesagt_am IS NOT NULL OR
  (qualifikation_geprueft_am IS NOT NULL AND qualifikation_snapshot <> '{}')`.
  Eine bestehende Zeile erfüllt das bereits; ein Statuswechsel bricht es nicht.
- **`ez_akteur_stimmig`** — dieselbe Falle wie beim Check-in: `'mensch'`
  verlangt `erstellt_von IS NOT NULL`. Wo die Sitzung eine Person, aber kein
  Benutzerkonto trägt, muss `'system'` stehen.

**RLS — und warum es eine SECURITY-DEFINER-Funktion braucht.** Gemessen:

| Policy | Rolle | Befehl | Bedeutung |
|---|---|---|---|
| `t_selbst_m1` | `cse_app` | **nur `r`** | die Arbeiterin **liest** ihre Zuordnung |
| `t_mandant` | `cse_app` | `*` | verlangt `dienstplan.schreiben` — hält die Arbeiterin nicht |
| `p_ma_decke` | `cse_app` | `*`, **restriktiv** | deckelt das Arbeiterportal auf die eigene Anstellung |

Das Arbeiterportal hat also **keinen** Schreibweg über `cse_app` — richtig so.
Der Weg ist derselbe wie bei der Stempeluhr (`drizzle/0373`): eine Funktion
unter `cse_definer`, die **Portal** und **Personenzugehörigkeit** prüft statt
einer Policy.

**Die Trigger, die dabei mitlaufen** (gemessen mit `pg_get_triggerdef`):

- `trg_einsatz_besetzung_zaehlen` — `AFTER UPDATE OF entfernt_am, status`:
  schreibt `einsatz.besetzt_anzahl` fort. **Der Statuswechsel pflegt die
  Besetzungszahl also von selbst** — hier darf nichts von Hand gezählt werden.
- `a_einsatz_zuordnung_qualifikation_stempeln` und die
  `CONSTRAINT`-Variante `einsatz_zuordnung_qualifikation` hängen an
  `abgesagt_am` — eine Absage berührt die Qualifikationsprüfung.
- `trg_einsatz_zuordnung_audit` protokolliert jede Änderung.
- `trg_einsatz_zuordnung_kein_hard_delete` — Invariante 8 gilt auch hier.

### Der Bauplan

1. **`drizzle/0374`** — zwei Funktionen unter `cse_definer`, nach dem Muster
   von `0373`:
   - `app.schicht_zusagen(p_zuordnung uuid)`
   - `app.schicht_absagen(p_zuordnung uuid, p_grund text)`

   Jede prüft: `app.portal() = 'mitarbeiter'`, `app.aktuelle_person()` besitzt
   die Zuordnung, `entfernt_am is null`, `ende_zeitpunkt > now()`.
   **Ein Ergebnis für „gibt es nicht" und „gehört dir nicht"** (AUT-06) —
   sonst lohnt das Durchprobieren von Kennungen.
   Zusagen nur aus `geplant`; Absagen aus `geplant` oder `zugesagt`.
   `absage_grund` ist Pflicht, mit einem deutschen Satz statt einer
   Constraint-Meldung.
2. **Der Schreibweg gehört `services/dienstplan/`, nicht `services/mitarbeiter/`.**
   `tests/kern/mitarbeiter.test.ts` besteht darauf, dass unter
   `services/mitarbeiter/` **kein** Dienst schreibt — ein vierter, dort
   angelegter, führte an genau dieser Prüfung vorbei. (Derselbe Fehler ist bei
   der Stempeluhr schon einmal gemacht und von diesem Test gefangen worden.)
3. **`POST /api/mein/schicht`** — Formular ohne JavaScript, wie
   `api/mein/stempeluhr`. Die Route muss in `MEINE_SCHREIBROUTEN`
   (`tests/kern/mitarbeiter.test.ts`) **ausdrücklich** eingetragen werden, mit
   Begründung, warum sie EMP-07 nicht bricht.
4. **Die Oberfläche** auf `portal/mein/schichten/[zuordnungId]/page.tsx:100` —
   zwei Knöpfe, `min-h-16`, viersprachig (de/en/ar/tr), und die Zustandskette
   sichtbar: *eingeteilt → zugesagt → gearbeitet*.
5. **Eine offene Frage, die dem Auftraggeber gehört:** darf eine Kraft eine
   **Absage zurücknehmen**? Danach hat das Büro die Schicht womöglich neu
   besetzt. Vorschlag: nein, der Weg zurück läuft über das Büro — aber das ist
   eine Betriebsregel, keine technische. Als `TODO(client, O-NN)` mit Zeile in
   `docs/DECISIONS.md` führen, nicht still entscheiden.

## 5. Die Reihenfolge danach

Aus `docs/VOLLSTAENDIGKEIT.md` §8, unverändert gültig:

- **R1 (Rest):** V-002 Revier · V-003 Bauprojekt · V-004 Veranstaltung ·
  V-017 Kunde ändern
- **R2:** V-049 (oben) · V-051 Einwandentscheidung erreicht die Kraft ·
  V-053 Monat wechseln · V-064 laufenden Eintrag schließen ·
  V-065 Ausgleichsbuchung · V-008 Stundenkonto eröffnen ·
  V-068 Ausstempel-Marke
- **R3–R6:** wie im Register

Dazu, neu und vorrangig: **der Abgleich gegen die Master-Spezifikation**
(§ 2 dieses Blatts) — er kann Punkte nach vorn ziehen, die im Register
niedriger stehen.

## 6. Die Arbeitsregeln, die weitergelten

- Nie eine Geschäftsregel erfinden. Wo offen: Schnittstelle, **markierter**
  Platzhalter, `// TODO(client, O-NN)` mit der Nummer **in derselben Zeile**,
  Eintrag in `docs/DECISIONS.md` unter „Offen".
- Keine vorgetäuschten Integrationen. Ohne Zugangsdaten: Schnittstelle bauen,
  „nicht verbunden" **anzeigen**, nie einen erfolgreichen Aufruf simulieren.
- Gestaltungswerte **nur** aus `docs/DESIGN.md`.
- Deutsche Rechtsbegriffe bleiben deutsch, auch im englischen Text — mit
  Erklärung daneben, nie mit einer erfundenen Entsprechung.
- Vor jedem Push: `pnpm guards · typecheck · eslint · test · test:isolation` —
  und die **Ausgabe selbst lesen**. Ein Exit-Code aus einer Befehlskette sagt
  nichts über die Prüfung davor. (Das ist in dieser Sitzung wieder passiert:
  eine Hintergrundmeldung sagte „exit code 0", während `tsc` mit 2 gescheitert
  war.)
