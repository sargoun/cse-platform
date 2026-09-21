# Entwicklungsplan — der Stand, die Befunde, die Reihenfolge

**Geschrieben am 19.09.2026, als das Wochenbudget zu Ende ging.**

Dieses Blatt ist eine **Übergabe**, kein Archiv. Es ist so geschrieben, dass
eine neue Sitzung hier anfangen kann, ohne eine einzige Frage stellen zu
müssen. Was erledigt ist, wird gestrichen; was dazukommt, wird eingetragen.

Verwandte Blätter, die NICHT hier wiederholt werden:
- `docs/DESIGN-PLAN.md` — die Neuordnung der Oberfläche (sieben Gruppen statt
  32 flacher Einträge, „Heute"-Bildschirm, Fussleiste für Arbeiter)
- `docs/architecture/i18n/README.md` — die Werkbank der Zweisprachigkeit
- `docs/DECISIONS.md` — jede Entscheidung mit ihrem Grund

---

## 0. Wo die Arbeit gerade liegt

| | |
|---|---|
| Branch | `claude/i18n-verwaltung-zweisprachig-fl57f2` |
| Pull Request | — (keiner offen; erst auf Ansage) |
| Letzter gemergter Stand | **PR #19 → `main` (`5b14baf`)**, gemergt am 19.09. |

**Korrektur zum Stand vom 19.09.:** dieses Blatt sagte, #19 sei offen und #18
der letzte gemergte. Beides ist ueberholt — #19 ist gemergt, `main` steht auf
dem Merge-Commit, und die Arbeit laeuft auf einem frischen Zweig davon.

**Vor jedem Push:** `pnpm guards · typecheck · eslint · test · test:isolation · test:e2e`
(`tsc --noEmit` dauert ~7 min und sieht KEINE Next-Routentypen — die erscheinen
erst in `pnpm build`.)

Postgres lokal: `127.0.0.1:55432`, Benutzer `postgres`, Kennwort `postgres`.

---

## 1. Zweisprachigkeit — läuft, Klinke steht

### Was fertig ist

- **Die Sperrklinke** `seite-ohne-uebersetzung` (`scripts/guards/`) prüft den
  **Syntaxbaum**, nicht den Text — ein regulärer Ausdruck kann
  `className="mt-s2 …"` nicht von `titel="Zahlungen"` unterscheiden. Sie meldet
  in **beide** Richtungen: eine neue Verdrahtung, UND einen Listeneintrag, der
  keine feste Zeichenkette mehr hat.
- **Die eingefrorene Ausnahmeliste** `scripts/guards/uebersetzung-ausnahmen.ts`.
  Sie darf **schrumpfen, nie wachsen**. `pnpm uebersetzung:streichen` kann sie
  bauartbedingt nicht wachsen lassen — es behält nur bestehende Einträge.
- **Die Form**: `src/lib/i18n/verwaltung/basis.ts` (gemeinsame Wörter) +
  `nachSprache(TABELLE, zugang.sprache)`. Je Teilfläche eine eigene Textdatei
  unter `src/lib/i18n/verwaltung/<domäne>/<teilfläche>.ts`.
- **Das Arbeiterportal ist fertig** — alle vier Sprachen, 0 Fundstellen.
- **Die Statuspille** übersetzt sich selbst (`src/lib/i18n/pille.ts`, vier
  Sprachen). Der deutsche `zustand` bleibt der SCHLÜSSEL (er wählt die Farbe,
  DESIGN §5); `sprache` ist freiwillig und fällt auf Deutsch.

### Werkzeuge

```bash
pnpm uebersetzung:pruefen <pfad…>    # was trägt diese Datei noch fest verdrahtet?
pnpm uebersetzung:streichen          # erledigte Einträge aus der Liste nehmen
```

### Das Vorbild, das jede neue Umstellung kopiert

```
src/lib/i18n/verwaltung/finanzen/zahlungen.ts          ← die Texttabelle
src/app/portal/[mandant]/finanzen/zahlungen/page.tsx   ← die umgestellte Seite
```

### Was noch offen ist

**Stand: 349 Dateien in der Liste** (Start: 396).

*(Hier stand 372. Gemessen sind es 349 — `grep -c "^  '" scripts/guards/uebersetzung-ausnahmen.ts`.)*

| Fläche | offen |
|---|---|
| `portal/[mandant]` | ~300 |
| `portal/gruppe` | 26 |
| `portal/kunde` | 20 |
| `portal/konto` | 4 |
| `src/components/**` | ~13 |

**Reihenfolge** (nach Nutzung, nicht nach Grösse):
1. ~~`finanzen`~~ — **erledigt, siehe §1.1**
2. `crm` · `angebote` · `auftraege`
3. `dienstplan` · `zeiten` · `personal`
4. **`portal/kunde`** — der AUFTRAGGEBER sieht sie; ein halb deutscher
   Kundenbildschirm ist ein Eindruck, den man nicht zurücknimmt
5. `portal/gruppe` · `portal/konto`
6. der Rest von `[mandant]`

### 1.1 `finanzen` — ERLEDIGT (dieses Blatt sagte etwas anderes)

**Gemessen am 21.09., nicht vermutet:**

```
pnpm uebersetzung:pruefen 'src/app/portal/[mandant]/finanzen'
  → "Fertig — nichts mehr fest verdrahtet."
grep -c finanzen scripts/guards/uebersetzung-ausnahmen.ts
  → 0
```

Gegenprobe, damit die Leere nicht die des Werkzeugs ist: derselbe Befehl auf
`src/app/portal/kunde` meldet **383 Fundstellen**. Das Werkzeug sieht also,
und bei `finanzen` sieht es nichts.

**„Fertig" heisst hier: nichts mehr fest verdrahtet — nicht: fehlerfrei.**
Die Wache prüft, ob eine Seite ihre Wörter aus einer Texttabelle nimmt. Ob im
englischen Text der richtige Fachbegriff steht, kann sie nicht sehen — und
genau dort liegen **§2b.1 bis §2b.3 weiterhin offen** (zwölf Stellen
„Beleg" → „document", fehlende `Festschreibung`/`Storno`, zwei deutsche
Wortlaut-Driften). Sie sind rein mechanisch und brauchen keine Entscheidung.

Die Tabelle unten beschreibt den Stand vom 19.09. und ist **ueberholt**; sie
bleibt stehen, weil sie zeigt, in welcher Reihenfolge die sieben Teilflaechen
entstanden sind. Der naechste, der hier anfaengt, faengt NICHT hier an.

<details><summary>Der Stand vom 19.09. (historisch)</summary>

Sieben Teilflächen wurden parallel umgestellt. **Zwei sind fertig und
gemergt**, **fünf waren mitten in der Arbeit**, als das Budget endete:

| Teilfläche | Textdatei | Stand |
|---|---|---|
| `rechnungen` (Liste, neu) | `finanzen/rechnungen.ts` | ✅ fertig, gepusht |
| `rechnung-akte` ([id], festschreiben, storno, verwerfen) | `finanzen/rechnung-akte.ts` | ✅ fertig, gepusht |
| `rechnung-ausgabe` (abschlaege, pruefung, versand, xrechnung, zugferd) | `finanzen/rechnung-ausgabe.ts` | ⚠️ **halb** |
| `eingangsrechnungen` (5 Seiten) | `finanzen/eingangsrechnungen.ts` | ⚠️ **halb** |
| `mahnungen` + `zahlungen/[id]` | `finanzen/mahnungen.ts` | ⚠️ **halb** |
| `belege` + `ausgaben` | `finanzen/belege.ts` | ⚠️ **halb** |
| `uebersicht` (finanzen/, ausgangsbuch, hashkette, nummernkreise, pruefungen, gruppe/finanzen) | `finanzen/uebersicht.ts` | ⚠️ **halb** |

</details>

**Wo es jetzt weitergeht:** `portal/kunde` (383 Fundstellen, der AUFTRAGGEBER
sieht diesen Bildschirm), dann `crm` · `angebote` · `auftraege`.
`pnpm uebersetzung:pruefen <pfad>` listet Datei und Zeile, danach
`pnpm uebersetzung:streichen`.

**Harte Regeln bei jeder Umstellung:**
- **Fachbegriffe bleiben deutsch, auch im englischen Text**: `Mandant`,
  `Anstellung`, `Leistungsnachweis`, `Wachbuch`, `Aufmass`, `Nachtrag`,
  `Storno`, `Festschreibung`, `Lastschrift`, `Skonto`, `Mahnstufe`,
  `Bauabzugsteuer`, `Freistellungsbescheinigung`. Sie tragen Rechtsbedeutung
  (VOB, GoBD, UStG, GewO, EStG). Im Englischen steht der deutsche Begriff mit
  einer Erklärung in Klammern — **nie** eine erfundene Entsprechung.
- Nur SICHTBARE Texte wandern. Kommentare bleiben deutsch und bleiben, wo sie
  sind. `className`, `href`, `name`, `id`, `value`, SQL und Enum-Werte werden
  nie angefasst.
- Jede `<StatusPill>` bekommt `sprache={zugang.sprache}`.
- Die englische Fassung darf **nicht kürzer** sein, weil eine Erklärung
  weggelassen wurde.

---

## 2. Befunde aus der Befragung des Mandanten (19.09.)

Der Mandant hat vier Fragen gestellt. Die Antworten stehen unten. Jeder Befund
ist am Code verifiziert, nicht vermutet — und am 21.09. noch einmal
nachgemessen, Pfad und Zeile in der Tabelle unten.

| | Befund | Stand |
|---|---|---|
| §2.1 | kein Weg, ein Verwaltungskonto anzulegen | ✅ **erledigt** (`0372`, D-615) |
| §2.2 | Stempeluhr vom Arbeiterportal unerreichbar | offen — **hängt an O-93, siehe unten** |
| §2.3 | Korrektur erreicht die Mitarbeiterin nicht | ✅ **erledigt** (D-614) |
| §2.4 | `zeiten/freigabe` durch fehlende Rechtebindung zu | ✅ **erledigt** (`9cb3c84`) |
| §2.5 | Super-Admin: nur zwei Rechte `nur_global` | offen |
| §2.6 | Schlüssel des Sprachmodells nur in der Umgebung | offen |
| §2.7 | soziale Kanäle ohne Zugangsdaten | keine Bringschuld der Entwicklung |

**Die Nachmessung am 21.09., Befund für Befund:**

- §2.1 — `insert into benutzer` steht ausschliesslich in
  `src/server/db/seed/index.ts`, Zeilen **391, 468, 542, 1475**. Kein
  Anwendungspfad.
- §2.2 — `grep -rn "check-in" src/app/portal/mein/ src/server/auth/registry/`
  liefert **null** Treffer.
- §2.3 — `src/server/services/zeit/korrektur.ts` (282 Zeilen) enthält **keine**
  Erwähnung von `nachricht`.
- §2.5 — `nurGlobal: true` steht in `katalog.generiert.ts` in genau zwei
  Zeilen: **219** und **227**.
- §2.6 — `src/server/versand/modell-openai.ts:99` liest
  `process.env['OPENAI_API_KEY']` und sonst nichts.

### 2.1 🔴 Es gibt KEINEN Weg, ein Verwaltungskonto anzulegen

**Der schwerste Befund.** Die einzige Stelle, die in `benutzer` schreibt, ist
der **Seed** (`src/server/db/seed/index.ts`). Es gibt keine Einladungsroute,
kein Formular, keine API. `einstellungen/benutzer/page.tsx` trägt im Kopf
ausdrücklich „lesend".

Und das Schema **erwartet** die Einladung: `benutzer.status` hat den
Vorgabewert `'eingeladen'` (`drizzle/0007`, Zeile 159), und die Seite zeigt
diesen Zustand als Pille „Wartet" — ein Zustand, den nichts erzeugen kann.

Praktisch: **heute lässt sich kein neuer Admin einsetzen, ausser durch einen
erneuten Seed-Lauf.**

Was existiert, zum Vergleich:
- Mitarbeiterzugang ✅ `/personal/personen/[id]/zugang` → `POST /api/personal/zugang-code`
- Kundenzugang ✅ `/crm/kunden/[id]/zugang` → `POST /api/crm/kunde/zugang` (`drizzle/0249`)

**Zu bauen:** Einladung eines Verwaltungskontos (E-Mail + Rolle + Gesellschaft),
`status='eingeladen'` → Annahme → `aktiv`. Nach D-610 ist das Anlegen ein
Recht des SUPER-ADMINS (`nur_global`).

### 2.2 🔴 Die Stempeluhr ist fertig — und vom Arbeiterportal aus unerreichbar

`src/app/check-in/[token]/Stempeluhr.tsx` ist vollständig und sorgfältig
gebaut: ein Bildschirm, ein Hauptknopf, kein Scrollen, mit Handschuhen
bedienbar; **Serveruhr** ist die Wahrheit (Invariante 5), Gerätezeit wird
getrennt mit ihrer Abweichung gespeichert; Offline-Warteschlange; Schichtfoto.

**Aber:** sie ist nur über einen Token-Link erreichbar, den die Planung unter
`/portal/[mandant]/zeiten/checkin-links` ausgibt. Eine Suche nach `check-in`
in `src/app/portal/mein/`, `registry/tableiste.ts` und `registry/navigation.ts`
liefert **nichts**. Wer sich als Mitarbeiterin anmeldet, findet keinen Knopf
„Arbeit beginnen".

**Zu bauen:** Auf `/portal/mein` (und in der Fussleiste aus DESIGN-PLAN §4)
der Weg zur Stempeluhr der heutigen Schicht. **Vorsicht:** die Mitarbeiterin
darf ihren Zeiteintrag NICHT selbst schreiben (EMP-07, `p_ma_kein_update`) —
das ist Absicht und bleibt. Gezeigt wird der Weg zur MARKE, nicht ein neuer
Schreibweg.

> **NACHTRAG 21.09. — das ist kein Verweis, und dieses Blatt unterschätzt es.**
>
> `src/server/services/zeit/checkin.ts:209` sagt es unmissverständlich: die
> Marke wird **einmal im Klartext zurückgegeben, danach existiert sie
> nirgends mehr** — weder in der Datenbank noch im Protokoll noch im Audit.
> Gespeichert ist nur `sha256(marke)` in `checkin_token.token_hash`.
>
> **Es gibt also keinen bestehenden Token, auf den das Arbeiterportal
> verweisen könnte.** Ein „Knopf zur Stempeluhr" setzt voraus, dass die
> angemeldete Mitarbeiterin sich für ihre eigene Schicht eine Marke ausgeben
> lässt — und `gibCheckinAus` hängt heute an `zeit.checkin_verwalten`
> (`super_admin` / `admin` / `leitung`), also an der PLANUNG.
>
> Und genau diese Frage ist offen und gehört dem Mandanten. Im selben Dienst,
> Zeile ~218:
>
> ```
> // TODO(client, O-93): Wie erreicht der Check-in-Link den Mitarbeitenden —
> SMS, E-Mail, aushängender QR-Code am Objekt oder Portal-Link, wer ist der
> SMS-Anbieter (EU-Verarbeitung, AVV), und wer trägt die Kosten?
> ```
>
> **„Portal-Link" ist eine der vier genannten Antworten auf O-93.** §2.2 zu
> bauen hiesse also, O-93 an der Entwicklung zu entscheiden — und das ist der
> Fall, den die Arbeitsregel Nr. 1 ausdrücklich verbietet. Der Weg dahin:
> **erst O-93 beantworten lassen, dann bauen.** Solange das nicht geschehen
> ist, gehört §2.2 NICHT an Platz 3 der Reihenfolge.

### 2.3 🔴 Eine Korrektur erreicht die Mitarbeiterin nicht

`/portal/[mandant]/zeiten/[id]/korrektur` verlangt Art, Grund und Begründung —
**Pflichtfelder, gut gebaut.** Aber:
- `src/server/services/zeit/korrektur.ts` enthält **keine** Benachrichtigung.
- `/portal/mein/zeiten/[id]` zeigt **nicht**, dass korrigiert wurde, und
  nicht, warum.

Die Mitarbeiterin erfährt von der Änderung ihrer Stunden nur, wenn sie
zufällig nachsieht. Der Mandant hat das ausdrücklich verlangt: „التعديل مع
رسالة للموظف بتكون ليعرف ليش هيك صار".

**Zu bauen:** Korrektur → Nachricht an die Mitarbeiterin (die Nachrichten-
schiene `kern.nachricht` aus `drizzle/0350` existiert), und auf ihrer
Zeitseite die Begründung sichtbar. Der Einwandsweg
(`/portal/mein/zeiten/[id]/einwand`) existiert schon und bleibt.

### 2.4 ✅ ERLEDIGT — `zeiten/freigabe` ist erreichbar (`9cb3c84`)

**O-39 ist beantwortet (D-611), `leitung` entschieden (D-612).** Die Seite
`/portal/[mandant]/zeiten/freigabe` ist seit PR 50 fertig und antwortete 404,
weil `zeit.abrechnung_freigeben` an keine Rolle gebunden war. Es war eine
Rechtebindung und kein Umbau — genau wie hier vorhergesagt.

**Was dabei anders war als in diesem Blatt vorhergesagt.** Hier stand, es
brauche „eine neue Migration, nächste freie Nummer **0371**". Das stimmt nur
zur Hälfte. Die Quelle des Katalogs ist **nicht** die Migration, sondern ein
Markdown-Tabellenfeld:

```
scripts/katalog/extrahiere.ts:17
  QUELLE = docs/architecture/03-AUTH-BERECHTIGUNGEN.md     ← §12, Zeile 2490
pnpm katalog
  → schreibt src/server/auth/katalog.generiert.ts NEU
  → schreibt den Seed-Block IN drizzle/0008 neu (nicht in eine neue Datei)
```

Die Glyphenzeile steht jetzt auf `✔ | ✔ | ○ | — | —`
(`super_admin | admin | leitung | mitarbeiter | kunde`).

**0371 gibt es trotzdem — und das ist der Punkt, den man leicht übersieht:**
der erzeugte Block in `0008` erreicht nur eine Datenbank, die `0008` noch vor
sich hat. Jede bereits gewanderte Datenbank sähe die Änderung nie. Zwei Wege,
ein Ziel — der Generator für die leere, `0371` für die gefüllte Datenbank.
`0371` prüft sich am Ende selbst: schreibt sie nicht genau zwei Zeilen, bricht
sie ab, statt still zu gelingen.

**Was die Wache gefunden hat, das die Planung nicht gesehen hatte:**
`drizzle/0034:72` trug einen `// TODO(client, O-39)`, und
`todo-client-nicht-im-register` meldete ihn in dem Moment, in dem O-39 aus dem
Register verschwand. Genau dafür steht sie da.

**Geprüft** (Block 5 in `tests/isolation/zeit-abrechnungsfreigabe.test.ts`):
hält `admin` das Recht wirklich, hält `leitung` es wirklich NICHT, und kann
eine Gesellschaft es ihrer `leitung` trotzdem erteilen. Die Blöcke 1–4 banden
das Recht **eigens** und wären auch dann grün geblieben, wenn `0371` nie
geschrieben worden wäre — dieser Unterschied ist der ganze Befund.

**Noch offen an derselben Stelle: O-861** — in welcher Einheit wird
freigegeben (je Eintrag, Woche, Person, Monat), und ist eine erteilte Freigabe
zurücknehmbar? Ausgeliefert ist die feinste Einheit (je Eintrag) und keine
Rücknahme. Der sichtbare Hinweis auf der Seite nennt jetzt nur noch diese
Frage.

### 2.5 🟡 Super-Admin: heute tragen ZWEI Rechte `nur_global`

`system.mandant_verwalten` und `system.zwei_faktor_zuruecksetzen`
(`drizzle/0008`). Sonst nichts. Eine globale Einstellungsfläche gibt es nicht —
`/portal/gruppe` liest ausschliesslich (Invariante 10).

**D-610 hat entschieden, was hochwandert:**

| Super-Admin (`nur_global`) | bleibt beim Admin der Gesellschaft |
|---|---|
| Zugangsdaten der sozialen Kanäle | Beiträge, Planung, Freigabe |
| Schlüssel/Region des Sprachmodells | Agentenrichtlinien je Gesellschaft |
| Anlegen/Einladen von Verwaltungskonten | Mitarbeiter- und Kundenzugänge |
| Zugangsdaten jeder externen Anbindung | Bilder, News, Referenzen, Seiten |

**Die Trennlinie:** was bei Missbrauch die GRUPPE trifft, gehört nach oben;
was eine Gesellschaft allein trifft, bleibt unten. Die Website-Bilder wandern
deshalb ausdrücklich NICHT hoch — sie sind täglicher Inhalt, und jede
Rückfrage bei einem einzelnen Menschen lässt die Website veralten.

**Zu bauen:**
1. Migration: die vier Rechte oben auf `nur_global = true` (bzw. neu anlegen).
2. **Eine globale Einstellungsfläche.** Sie kann nicht unter `/portal/gruppe`
   liegen, weil die nur liest (Invariante 10) — also eine eigene Wurzel, z. B.
   `/portal/system/…`, mit eigener Tab-Leiste in `registry/tableiste.ts` und
   Einträgen in `registry/navigation.ts` und `route-manifest.ts`.
3. Geheimnisse **nie im Klartext anzeigen** — Vorhandensein, letzte Änderung,
   wer sie gesetzt hat. Ablage verschlüsselt, nicht als Klartextspalte.

### 2.6 🟡 Der Schlüssel des Sprachmodells steht nur in der Umgebung

`OPENAI_API_KEY` wird ausschliesslich aus `process.env` gelesen
(`src/server/versand/modell-openai.ts`, Zeile 99). Ohne Schlüssel gibt es
`NOT_CONNECTED` und **nie einen Versuch** — das ist richtig so und bleibt.
`einstellungen/integrationen` zeigt nur den Zustand.

Es fehlt die Fläche, ihn zu SETZEN (gehört nach D-610 zum Super-Admin, §2.5).

### 2.7 🟢 Soziale Kanäle: Oberfläche fertig, keine Zugangsdaten

`/portal/[mandant]/social` mit `kanaele`, `posts`, `posts/[id]/planung` und
den API-Routen ist gebaut. Jeder Kanal meldet ehrlich „nicht verbunden — es
ist kein Zugang hinterlegt" (SOC-05, CLAUDE.md „no fake integrations").

**Das ist kein Defekt, sondern eine offene Lieferung des Mandanten:** ohne
Meta- bzw. LinkedIn-App und deren Zugangsdaten kann nichts verbunden werden,
und eine erfundene Erfolgsmeldung wäre schlimmer als keine Verbindung.
Nach D-610 gehört die Eingabe dieser Daten zum Super-Admin.

---

## 2b. Offene Prüfbefunde der finanzen-Fächerung (NICHT behoben)

Sieben Prüfagenten haben die Umstellung gegen die harten Regeln gehalten.
Sieben Befunde sind in `5d8b34b` behoben (das führende Leerzeichen, sechs
ersetzte Fachbegriffe, eine Wortlaut-Drift). **Diese hier stehen noch offen:**

### 2b.1 `Beleg` heisst auf demselben englischen Bildschirm zweierlei

`src/lib/i18n/verwaltung/finanzen/eingangsrechnungen.ts` — in **acht**
Schlüsseln steht korrekt „Beleg (supporting document)", in **zwölf** ist der
Begriff stillschweigend zu blossem „document" geworden:

Zeilen **658** (`tabelleListe`), **691** (`bruttoHinweis`), **700**
(`interneBelegnummer`), **736** (`buchenErklaerung`), **849**
(`hinweistextLautet`), **876** (`keinSatzVor`), **889**
(`satzAusEinstellungNach`), **890** (`satzVomBeleg` — die deutsche Fassung
betont dort gerade BELEG in Grossbuchstaben), **893** (`abweichungVor`),
**895** (`abweichungNach`), **957** (`geprueftNichtVermerkt`), **959**
(`geprueftAm`).

**Warum das zählt:** auf `steuer/page.tsx` und `[id]/page.tsx` stehen beide
Formen nebeneinander für dasselbe Papier. Der englische Leser kann nicht
wissen, dass „Beleg" und „the document" dieselbe Sache sind.

**Fix:** die zwölf auf `Beleg` + Glosse vereinheitlichen. Rein mechanisch.

### 2b.2 `Festschreibung` und `Storno` fallen an einigen Stellen ganz weg

`rechnung-akte.ts` schreibt an manchen Stellen korrekt „Festschreibung
(finalisation)" (:833) und „festgeschrieben (finalised)" (:875), an anderen
nur noch die Glosse:

- **Festschreibung** fehlt: :838 (`fin18Begruendung10`), :928
  (`fin18BegruendungMin`), :877 (`nichtsMehrFestzuschreiben`), :944
  (`gesperrtKreis`), :1013 (`neuausstellungNach`)
- **Storno** fehlt: :854 (`korrigierenErklaerung`) und :977 (`istEntwurf`) —
  der zweite steht auf `storno/page.tsx`, also auf der Seite, **deren einziger
  Zweck der Unterschied zwischen Verwerfen und Storno ist**.

### 2b.3 Zwei kleine deutsche Wortlaut-Driften

Beim Wandern des Textes hat sich der DEUTSCHE Wortlaut mitgeändert — erlaubt
war nur Umziehen:

- `eingangsrechnungen/neu/page.tsx:255` — `{g.keineAuswahl}` rendert jetzt
  „— keine Auswahl —" statt vorher „— keiner —".
- `eingangsrechnungen/[id]/steuer/page.tsx:668` — `{g.oeffnen}` rendert jetzt
  „Öffnen" statt vorher kleingeschrieben „öffnen".

Beide sind geteilte Werte aus `basis.ts`. Entweder die Seite bekommt ein
eigenes Paar (so gelöst für `verbunden` in `rechnung-ausgabe.ts`), oder es
wird eine bewusste zentrale Entscheidung für Satzanfang-Grossschreibung —
dann aber für ALLE Schwesterseiten gleich.

### 2b.4 ERLEDIGT — der Compiler ist gelaufen, in der CI

Hier stand, `pnpm typecheck` sei über die Fächerung nicht gelaufen und
gehöre als erster Befehl in die nächste Sitzung. **Das stimmt nicht mehr,
und es stimmte auch schon beim Schreiben nur halb.**

Der CI-Auftrag `pruefung` (`.github/workflows/ci.yml`) fährt der Reihe nach
`pnpm guards` · `annahmen --check` · `katalog:check` · `seitenkarte --check` ·
`eslint .` · **Typecheck** · Einheitstests. Er ist auf `1bc62e6` in 8 Minuten
**grün** durchgelaufen — der Compiler hat die Arbeit der Agenten also gesehen
und nichts gefunden.

Was dabei rot WAR und behoben wurde, steht in §2b.5.

### 2b.5 Der eine rote Test — behoben, aber merkenswert

Von 3630 Zusagen fiel genau eine: `tests/kern/katalog.test.ts`, die K-19-Wache.

**Die Ursache ist eine Folge der Übersetzung und wird wiederkommen.** Ein
übersetzter Satz kann keinen technischen Namen fest eingebaut tragen. Also
wandert der Name aus der Prosa in eine Konstante und wird eingesetzt:

    „Kein Satz hinterlegt: `finanzen.bauabzugsteuer_satz_bp` fehlt"
    →  `${t.keinSatzVor} ${EINSTELLUNG_SATZ} ${t.keinSatzNach}`

In der Prosa war der Schlüssel gedeckt (`ohneProsaInZeichenketten` maskiert
einen Namen in Gegenstrichen INNERHALB einer Zeichenkette). Als blosses
Literal ist er ungedeckt — und der Katalogtest meldete ihn als
unregistriertes Recht, obwohl er ein Plattform-EINSTELLUNGSSCHLÜSSEL ist.

Behoben mit Regel (4b) in `scripts/katalog/benutzung.ts`: eine GROSS
geschriebene Konstante `EINSTELLUNG_*` gilt als Einstellung, nicht als Recht.
`RECHT_*` bleibt ungedeckt und wird weiter geprüft.

**Wer weiter übersetzt, wird diesem Muster wieder begegnen** — überall dort,
wo ein technischer Name in einem erklärenden Satz steht.

---

## 3. Die Oberfläche — `docs/DESIGN-PLAN.md`

Der Mandant hat es so gesagt: „حاسس المنصة كتير معقدة وكلشي داخل ببعضو".
Der mechanische Befund dahinter: **32 flache Navigationseinträge ohne
Gruppenfeld**. Deshalb findet er Seiten nicht, die es längst gibt — zum
Beispiel `/personal/anstellungen/neu`, mit dem sich sehr wohl ein neuer
Mitarbeiter einstellen lässt.

Der Plan steht vollständig in `docs/DESIGN-PLAN.md` und ist nicht umgesetzt:
sieben Gruppen (Heute · Kunden & Aufträge · Einsatz · Personal · Geld ·
Aussenauftritt · Werkzeuge), ein `gruppe`-Feld in `registry/navigation.ts`,
ein „Heute"-Bildschirm, eine Fussleiste für Arbeiter, eine neue Startseite.

**Reihenfolge-Empfehlung:** erst die Befunde aus §2 (sie sind FUNKTION, und
eine fehlende Funktion ist teurer als eine schlecht auffindbare), dann
DESIGN-PLAN, dann der Rest der Zweisprachigkeit.

---

## 4. Offene Fragen an den Mandanten

Beantwortet am 19.09.: **O-39** (→ D-611), **Super-Admin-Schnitt** (→ D-610).

Weiterhin offen und wichtig:
- **O-886** — Darf der Stundennachweis nach § 17 MiLoG in der Sprache der
  Arbeiterin stehen, oder muss er deutsch sein, um als Aufzeichnung zu gelten?
  Gebaut ist die Lesehilfe nach dem Vorbild von D-84; die Umkehr wäre eine
  Zeile (`meinTexte('de')` statt `basis.texte`).
- **O-06** — Gibt es einen Betriebsrat? § 87 Abs. 1 Nr. 6 BetrVG entscheidet,
  ob Geolokalisierung, Gerätekennung, Korrekturstatistik und
  Nicht-erschienen-Auswertung überhaupt ausgeliefert werden.
- **O-34** — `app.darf_kontaktiert_werden` sperrt den Kanal `post` bei
  `rechtsgrundlage = 'keine'`. Das ist strenger, als § 7 UWG verlangt (Brief
  ist kein elektronischer Weg). Absicht oder Versehen?
- Rund **355 weitere** `O-…`-Nummern stehen in `docs/DECISIONS.md` unter
  „Offen", jede an ihrer Stelle im Code als `// TODO(client, O-NN)`.

---

## 5. Wie man hier weitermacht — konkret

```bash
git fetch origin && git checkout claude/i18n-verwaltung-zweisprachig-fl57f2
pnpm install
pnpm uebersetzung:pruefen 'src/app/portal/kunde'   # die naechste Flaeche
```

**Die Datenbank steht nicht von selbst — das hat 20 Minuten gekostet und
steht hier, damit es sie nicht noch einmal kostet.** Es gibt **keine `.env`**
im Baum, auf einem frischen Container läuft **kein Postgres**, und
`pnpm db:migrate` sagt dann nur „DATABASE_URL fehlt", was wie ein
Konfigurationsfehler aussieht und keiner ist:

```bash
# 1. pgvector MUSS da sein, sonst stirbt Migration 0151 (AGT-06)
apt-get install -y postgresql-16-pgvector

# 2. Der Server. Das Projektskript startet ihn selbst, wenn keiner laeuft,
#    und legt die Testdatenbank an (Fingerabdruck ueber drizzle/*.sql —
#    es baut nur neu, wenn sich wirklich etwas geaendert hat).
bash scripts/test-db.sh up

# 3. Die Entwicklungsdatenbank. Der Fensterschluessel (K-06) MUSS gesetzt
#    sein, sonst bleibt der Seed unvollstaendig — siehe docs/LOKAL-STARTEN.md.
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/postgres"
export TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:55432/cse_test"
psql "$DATABASE_URL" -c "alter database postgres set cse.fenster_schluessel \
  = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O'"
pnpm db:migrate && pnpm db:seed
```

**`pnpm db:migrate` ist NICHT der Weg zur Testdatenbank.** Sie führt ein
eigenes Register; `db:migrate` fängt dort bei `0001` an und stirbt an
`relation "mandant" already exists`. Für sie ist `scripts/test-db.sh up`
zuständig, und zwar immer.

**Stand 21.09. — die ersten zwei Punkte sind weg:**

1. ~~`finanzen` zu Ende führen~~ — war **schon fertig**, siehe §1.1.
2. ~~**§2.4** — die Rechtebindung~~ — erledigt in `9cb3c84`.

**Die Reihenfolge ab hier, und warum sie von der alten abweicht:**

1. **§2.3** — die Nachricht bei der Korrektur. **Neu an Platz 1**, weil sie
   die einzige der verbliebenen ist, die **weder eine offene Frage noch eine
   Rechteentscheidung** berührt: die Schiene `kern.nachricht` steht seit
   `drizzle/0350`, `/portal/mein/nachrichten` ist gebaut, und
   `services/zeit/korrektur.ts` muss nur senden, was es ohnehin schon weiss.
2. **§2.1** — die Einladung eines Verwaltungskontos. Durch D-610 entschieden
   (Super-Admin), und zwei fertige Vorbilder im Baum: Mitarbeiterzugang
   (`/personal/personen/[id]/zugang`) und Kundenzugang
   (`/crm/kunden/[id]/zugang`, `drizzle/0249`). Das Schema wartet darauf:
   `benutzer.status` hat den Vorgabewert `'eingeladen'`.
3. **§2.5/2.6** — die Super-Admin-Fläche. Grösser als die beiden davor
   (eigene Wurzel `/portal/system/…`, Tab-Leiste, Navigation, Manifest,
   verschlüsselte Ablage) und deshalb nicht der Anfang.
4. **§2.2** — der Weg zur Stempeluhr. **Nach hinten gerückt, nicht
   vergessen**: er setzt eine Antwort auf **O-93** voraus (siehe den Nachtrag
   in §2.2). Ohne sie hiesse Bauen, eine offene Frage des Mandanten an der
   Entwicklung zu entscheiden.
5. `docs/DESIGN-PLAN.md`.
6. Die übrigen 349 Seiten der Zweisprachigkeit — **`portal/kunde` zuerst**
   (383 Fundstellen; den Bildschirm sieht der Auftraggeber).

**Was der Mandant entscheiden muss, damit es weitergeht:**
- **O-93** — ist der Portal-Link ein zulässiger Weg zur Check-in-Marke?
  (blockiert §2.2)
- **O-861** — Einheit und Rücknahme der Abrechnungsfreigabe (blockiert
  nichts, läuft mit)
- **O-886**, **O-06**, **O-34** — wie in §4.

**Und die Regel, die über allem steht:** keine Geschäftsregel erfinden. Wo die
Vorgabe offen ist, kommt ein Platzhalter hinter eine Schnittstelle, eine
`// TODO(client, O-NN)`-Zeile mit der Nummer auf DERSELBEN Zeile, und ein
Eintrag in `docs/DECISIONS.md`.
