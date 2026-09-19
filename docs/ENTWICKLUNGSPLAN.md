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
| Branch | `claude/i18n-verwaltung-zweisprachig` |
| Pull Request | **#19** |
| Letzter gemergter Stand | PR #18 → `main` (`a3b58da`) |

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

**Stand: 372 Dateien in der Liste** (Start: 396).

| Fläche | offen |
|---|---|
| `portal/[mandant]` | ~300 |
| `portal/gruppe` | 26 |
| `portal/kunde` | 20 |
| `portal/konto` | 4 |
| `src/components/**` | ~13 |

**Reihenfolge** (nach Nutzung, nicht nach Grösse):
1. `finanzen` — **teilweise erledigt, siehe §1.1**
2. `crm` · `angebote` · `auftraege`
3. `dienstplan` · `zeiten` · `personal`
4. **`portal/kunde`** — der AUFTRAGGEBER sieht sie; ein halb deutscher
   Kundenbildschirm ist ein Eindruck, den man nicht zurücknimmt
5. `portal/gruppe` · `portal/konto`
6. der Rest von `[mandant]`

### 1.1 `finanzen` — unfertiger Zwischenstand IM BAUM

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

**Wie man dort weitermacht:** `pnpm uebersetzung:pruefen 'src/app/portal/[mandant]/finanzen'`
listet Datei und Zeile. Die halben Seiten sind **weiterhin in der
Ausnahmeliste** — der Baum ist also in sich stimmig, die Wache ist grün, und
niemand hält sie irrtümlich für fertig. Jede Seite zu Ende führen, dann
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

## 2. Befunde aus der Befragung des Mandanten (19.09.) — ALLE UNGELÖST

Der Mandant hat vier Fragen gestellt. Die Antworten stehen unten; **gebaut ist
davon noch nichts.** Jeder Befund ist am Code verifiziert, nicht vermutet.

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

### 2.4 🟡 `zeiten/freigabe` ist gebaut und durch eine fehlende Rechtebindung zu

**O-39 ist jetzt beantwortet — siehe D-611:** ein Mensch gibt wöchentlich
frei, bevor abgerechnet wird.

Die Seite `/portal/[mandant]/zeiten/freigabe` ist seit PR 50 fertig und
antwortet 404, weil `zeit.abrechnung_freigeben` an keine Rolle gebunden ist
(`drizzle/0366`, `katalog.generiert.ts`: `gebunden: []`).

**Zu bauen — es ist eine Rechtebindung, kein Umbau:**
1. Neue Migration (nächste freie Nummer ist **`0371`**), Muster wie
   `drizzle/0008` Zeile 330 ff.:
   `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)`
   für `super_admin` und `admin`.
   **`leitung` bewusst NICHT**: die Freigabe zur ABRECHNUNG ist ein
   kaufmännischer Akt, nicht ein Schichtakt.
2. `pnpm katalog` (schreibt `src/server/auth/katalog.generiert.ts` neu).
3. Isolationstest: mit Recht 200, ohne Recht 404 (AUT-06).

Was schon lange fertig ist und nur auf diesen Anfang wartet: `freigegeben_am`
(`drizzle/0034`) hat zwei Leser — Stundenkonto (EMP-04) und Rechnungsstellung
(FIN-07, `freigegeben_am is not null and abgerechnet_am is null`).

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

### 2b.4 Noch nicht gelaufen: `pnpm typecheck` über die Fächerung

Die Arbeit der Agenten ist mit der Sperrklinke, `eslint` und den Wachen
geprüft — **nicht mit dem Compiler**. `tsc --noEmit` dauert ~7 min und war
beim Ende des Budgets nicht mehr drin.

**Erster Befehl der nächsten Sitzung:** `pnpm typecheck`.

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
git fetch origin && git checkout claude/i18n-verwaltung-zweisprachig
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm uebersetzung:pruefen 'src/app/portal/[mandant]/finanzen'   # was ist halb?
```

**Vorschlag für die erste Sitzung, in dieser Reihenfolge:**

1. `finanzen` zu Ende führen (§1.1) — der Zwischenstand liegt im Baum und
   wird sonst zur Altlast.
2. **§2.4** — die Rechtebindung. Eine Migration, ein `pnpm katalog`, ein Test;
   sie öffnet einen fertig gebauten Bildschirm.
3. **§2.2** — der Weg zur Stempeluhr. Der Mitarbeiter kann heute nicht
   anfangen zu arbeiten, ohne dass ihm jemand einen Link schickt.
4. **§2.3** — die Nachricht bei der Korrektur.
5. **§2.1** — die Einladung eines Verwaltungskontos.
6. **§2.5/2.6** — die Super-Admin-Fläche.
7. `docs/DESIGN-PLAN.md`.
8. Die übrigen ~370 Seiten der Zweisprachigkeit, Teilfläche für Teilfläche.

**Und die Regel, die über allem steht:** keine Geschäftsregel erfinden. Wo die
Vorgabe offen ist, kommt ein Platzhalter hinter eine Schnittstelle, eine
`// TODO(client, O-NN)`-Zeile mit der Nummer auf DERSELBEN Zeile, und ein
Eintrag in `docs/DECISIONS.md`.
