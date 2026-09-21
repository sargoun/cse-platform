# Sanierungsplan — der gemessene Zustand und die Reihenfolge der Reparatur

**Aufgenommen am 21.09.2026.** Dieses Blatt ist ein **Befundbericht mit
Reihenfolge**, kein Wunschzettel. Jede Zahl darin ist gemessen; der Befehl
steht daneben, damit sie jederzeit nachgezählt werden kann.

Auslöser waren fünf Beobachtungen des Mandanten:

1. „Die Admins können keinen neuen Mitarbeiter einstellen."
2. „Der Mitarbeiter kann seine Arbeitszeit nicht starten."
3. „Beim Mitarbeiter-Login gibt es keinen Weg zurück."
4. „Viele Admin-Optionen öffnen eine neue Seite ohne Rückweg."
5. „Alles wirkt versteckt und zu tief verschachtelt."

**Vier von fünf sind bestätigt. Eine ist anders, als sie aussieht** — und der
Unterschied entscheidet über die Reparatur.

---

## 0. Wie gemessen wurde

```bash
# Seiten je Fläche
find "src/app/portal/[mandant]" -name page.tsx | wc -l

# Rückweg: wer benutzt die Zurueck-Komponente?
grep -rln "Zurueck\b" "src/app/portal/[mandant]" | wc -l

# Verschachtelungstiefe
find "src/app/portal/[mandant]" -name page.tsx \
  | sed 's|src/app/portal/\[mandant\]/||; s|/page.tsx||' \
  | awk -F/ '{print NF}' | sort -n | uniq -c

# Navigationseinträge je Liste
awk '/^export const NAVIGATION/,/^\];/' src/server/registry/navigation.ts \
  | grep -c "schluessel:"
```

---

## 1. Die Befunde

### 1.1 🔴 Der Rückweg fehlt — auf 307 von 309 Verwaltungsseiten

**Der härteste Befund, und der mit dem besten Verhältnis von Aufwand zu
Wirkung.**

| Fläche | Seiten | davon mit `Zurueck` |
|---|---|---|
| `portal/[mandant]` | 309 | **2** |
| `portal/mein` (Arbeiter) | 27 | **2** |
| `portal/kunde` | 20 | 9 |
| `portal/gruppe` | 26 | 0 |

**Die Komponente existiert bereits** — `src/app/portal/kunde/bausteine.tsx:197`,
sauber gebaut, mit `aria-label="Zurück"` und einem Pfeil an immer derselben
Stelle. Sie ist nur **nicht benutzbar ausserhalb des Kundenportals**, weil ihr
`ziel` auf neun feste Kundenpfade typisiert ist:

```ts
{ ziel: '/portal/kunde/nachrichten' | '/portal/kunde/reklamationen' | … }
```

Das ist der ganze Grund, warum 307 Seiten ohne Rückweg dastehen: nicht ein
fehlender Entwurf, sondern ein Typ, der ihn einsperrt.

**Dazu kommt die Verschachtelung:**

| Tiefe unter `/portal/[mandant]/` | Seiten |
|---|---|
| 1 | 26 |
| 2 | 141 |
| 3 | 90 |
| 4 | 42 |
| 5 | 9 |
| 6 | 1 |

**142 Seiten liegen drei Ebenen oder tiefer.** Die Navigation führt auf die
26 Wurzeln; alles darunter wird durch Klicken erreicht — und ohne Rückweg
wieder verlassen. Das ist die mechanische Ursache von „alles wirkt versteckt".

### 1.2 🔴 Die Anmeldeseiten haben keinen einzigen Verweis

Gemessen als Anzahl `<Link>` bzw. `href` je Datei:

| Seite | Verweise |
|---|---|
| `/auth/login` | **0** |
| `/auth/mitarbeiter/code` | **0** |
| `/auth/kein-zugriff` | **0** |
| `/auth/zwei-faktor/einrichten` | **0** |
| `/auth/zwei-faktor/wiederherstellung` | **0** |
| `/auth/einladung/[token]` | 0 (Weiterleitung, korrekt so) |

`/auth/mitarbeiter/code` ist genau der Bildschirm aus Beobachtung 3. Wer dort
landet und den Code nicht hat, kommt **nur über die Zurück-Taste des Browsers
oder eine neue Adresse** wieder heraus. Auf einem Telefon im Treppenhaus ist
das keine Kleinigkeit.

`/auth/kein-zugriff` ohne Verweis ist der schwerere Fall: es ist die Seite,
auf der jemand landet, dem etwas fehlt — und sie lässt ihn dort stehen.

### 1.3 🟡 51 flache Navigationseinträge, ohne jede Gruppierung

```
NAVIGATION          51 Einträge
GRUPPEN_NAVIGATION  19
KUNDEN_NAVIGATION   11
```

Der Typ `NaviEintrag` (`src/server/registry/navigation.ts:19`) führt
`schluessel · label · pfad · recht · zusatzRecht · icon` — **kein Feld für
eine Gruppe.** Ein früheres `gruppe: boolean` wurde mit D-561 entfernt, aber
aus einem anderen Grund (Gruppensicht ≠ gefilterte Mandantensicht); eine
THEMATISCHE Gruppierung hat es nie gegeben.

`docs/DESIGN-PLAN.md` nennt sieben Gruppen (Heute · Kunden & Aufträge ·
Einsatz · Personal · Geld · Aussenauftritt · Werkzeuge). Sie sind geplant und
nicht gebaut.

*(`docs/ENTWICKLUNGSPLAN.md` §3 nennt 32 Einträge. Es sind heute 51.)*

### 1.4 ⚪ „Admins können keinen Mitarbeiter einstellen" — die Funktion IST da

**Dieser Befund ist anders als die anderen vier, und deshalb steht er hier
gesondert.**

```
src/app/portal/[mandant]/personal/anstellungen/neu/page.tsx   ← existiert
src/server/services/personal/einstellung.ts:329               ← insert into person
```

Die Maske legt **sowohl die `person` als auch die `anstellung` an**, mit
Dublettenprüfung über Gesellschaftsgrenzen (`app.person_dublettenpruefung`,
`drizzle/0365`) — genau wie D-09 es verlangt.

**Die Funktion fehlt nicht. Der Weg dorthin fehlt.** `/personal/anstellungen/neu`
liegt auf Tiefe 3 und steht in keinem der 51 Navigationseinträge. Wer nicht
weiss, dass es sie gibt, findet sie nicht.

**Das ist kein kleinerer Befund, sondern ein anderer** — und er wäre durch
Neubauen nicht behoben worden, sondern verdoppelt.

### 1.5 🔴 Fünf Funktionen fehlen wirklich

Alle am Code nachgemessen, mit Datei und Zeile:

| | Befund | Beleg |
|---|---|---|
| **A** | Kein Weg, ein Verwaltungskonto anzulegen | `insert into benutzer` nur in `seed/index.ts:391,468,542,1475` |
| **B** | Stempeluhr vom Arbeiterportal unerreichbar | `grep -rn "check-in" src/app/portal/mein/` → 0 |
| **C** | Korrektur erreicht die Mitarbeiterin nicht | `services/zeit/korrektur.ts` (282 Z.) → 0× `nachricht` |
| **D** | Keine globale Super-Admin-Fläche | `nurGlobal: true` nur in `katalog.generiert.ts:219,227` |
| **E** | Schlüssel des Sprachmodells nur aus der Umgebung | `versand/modell-openai.ts:99` |

**A ist deutlich kleiner, als `ENTWICKLUNGSPLAN.md` §2.1 annimmt.** Die
Einladungsmaschinerie ist vollständig gebaut:

```
drizzle/0155:130   kern.kennwort_token, zweck in ('zuruecksetzen','einladung')
drizzle/0249       benutzt sie fuer den KUNDENzugang (Z. 301, 373, 459)
/auth/einladung/[token]  → leitet auf /auth/passwort-neu?token=…
/auth/passwort-neu       liest den Zweck und beschriftet sich danach
```

Es fehlt **allein die absendende Hälfte für Verwaltungskonten** — und für sie
gibt es mit `services/crm/kundenzugang.ts` ein fertiges, geprüftes Vorbild.
Nachbauen, nicht erfinden.

**B hängt an einer offenen Frage des Mandanten.** `services/zeit/checkin.ts:209`:
die Marke wird **einmal im Klartext zurückgegeben, danach existiert sie
nirgends** — gespeichert ist nur `sha256`. Es gibt also keinen bestehenden
Token, auf den das Arbeiterportal verweisen könnte. Und O-93 (derselbe Dienst,
Z. ~218) fragt den Mandanten, ob der **Portal-Link** überhaupt der richtige
Weg ist — neben SMS, E-Mail und QR-Code am Objekt. B zu bauen, ohne O-93 zu
beantworten, hiesse die Frage an der Entwicklung zu entscheiden.

### 1.6 🟡 Wortlaut-Befunde der `finanzen`-Umstellung

`ENTWICKLUNGSPLAN.md` §2b.1–2b.3, unverändert offen: zwölf Stellen, an denen
`Beleg` im englischen Text zu blossem „document" wurde; fehlende
`Festschreibung`/`Storno` an sieben Stellen; zwei deutsche Wortlaut-Driften.
Rein mechanisch, keine Entscheidung nötig.

---

## 2. Was NICHT kaputt ist — und warum das zählt

Ein Sanierungsplan, der nur Mängel nennt, lädt dazu ein, Tragendes
mitzureissen. Diese Teile sind gemessen in Ordnung:

- **Die Rechnerei.** Die vier Pflichttests aus `CLAUDE.md` sind breit gedeckt:
  Nachtschicht 22:00–06:00 in 39 Testdateien, Zeitumstellung vorwärts in 54,
  rückwärts in 22, gleichzeitige Schichten in 7.
- **Die Zusagen insgesamt:** 3630 Einheitstests, 2943 Isolationstests, alle
  grün (Ausgang je Befehl einzeln gelesen).
- **Die Wachen greifen.** Während dieser Sitzung hat
  `todo-client-nicht-im-register` selbstständig einen `TODO(client, O-39)` in
  `drizzle/0034:72` gemeldet, den niemand gesucht hatte.
- **Die Stempeluhr selbst** (`src/app/check-in/[token]/`) ist vollständig:
  Serveruhr als Wahrheit, Gerätezeit getrennt mit Abweichung,
  Offline-Warteschlange, Schichtfoto. Ihr fehlt der Weg, nicht die Substanz.
- **457 Seiten, keine leere.** Die kürzesten sind Weiterleitungen und
  Auffangrouten, keine Platzhalter.
- **242 `TODO(client)`** sind offene Fragen an den Mandanten mit Nummer und
  Registereintrag — der vorgesehene Zustand, kein Rückstand.

---

## 3. Die Reihenfolge

Vier Wellen. Sie sind so geschnitten, dass **jede für sich ausgeliefert
werden kann** und nichts kaputtmacht, was vorher lief.

### Welle 1 — der Rückweg (§1.1, §1.2)

Die grösste Wirkung je Zeile. Nichts daran ist eine Geschäftsregel, also
nichts daran ist eine Rückfrage.

1. `Zurueck` aus `kunde/bausteine.tsx` nach `src/components/portal/` heben und
   das `ziel` von neun festen Kundenpfaden auf einen allgemeinen Pfad öffnen.
   Das Kundenportal benutzt danach dieselbe Komponente — **eine** Stelle, an
   der der Pfeil sitzt.
2. Auf **jeder** Detailseite von `[mandant]`, `mein` und `gruppe` setzen; das
   Ziel ist die Liste, aus der sie kommt.
3. Die Anmeldeseiten: `/auth/login`, `/auth/mitarbeiter/code`,
   `/auth/kein-zugriff` und die drei 2FA-Seiten bekommen einen Weg zurück.
4. **Eine Wache**, damit es nicht wieder verfällt: eine neue Detailseite ohne
   Rückweg ist ein roter Build — nach dem Muster der
   `seite-ohne-uebersetzung`-Klinke, die sich bewährt hat.

### Welle 2 — die Funktionen, die fehlen (§1.5)

In dieser Reihenfolge, nach „was hängt an einer Entscheidung":

1. **C — die Nachricht bei der Korrektur.** Hängt an nichts: `kern.nachricht`
   steht seit `drizzle/0350`, `/portal/mein/nachrichten` ist gebaut.
2. **A — die Einladung eines Verwaltungskontos.** Durch D-610 entschieden,
   Vorbild in `services/crm/kundenzugang.ts`, Annahmehälfte fertig.
3. **D + E — die Super-Admin-Fläche.** Eigene Wurzel `/portal/system/…`, weil
   `/portal/gruppe` nur liest (Invariante 10). Geheimnisse nie im Klartext.
4. **B — der Weg zur Stempeluhr.** **Erst nach O-93.**

### Welle 3 — die Auffindbarkeit (§1.3, §1.4)

1. `gruppe` als Feld in `NaviEintrag`, die 51 Einträge auf die sieben Gruppen
   aus `DESIGN-PLAN.md` verteilen.
2. Die Wege, die heute niemand findet, in die Navigation holen — allen voran
   **„Mitarbeiter einstellen"** (§1.4).
3. Der „Heute"-Bildschirm und die Fussleiste für Arbeiter.

### Welle 4 — der Text (§1.6, Zweisprachigkeit)

1. §2b.1–2b.3, mechanisch.
2. Die 349 Dateien der Ausnahmeliste, `portal/kunde` zuerst (383 Fundstellen;
   diesen Bildschirm sieht der Auftraggeber).

---

## 4. Was nur der Mandant entscheiden kann

Diese vier blockieren je ein Stück Arbeit. Keine davon wird an der
Entwicklung entschieden (Arbeitsregel 1).

| # | Frage | blockiert |
|---|---|---|
| **O-93** | Ist der Portal-Link ein zulässiger Weg zur Check-in-Marke — oder SMS, E-Mail, QR am Objekt? Wer trägt die SMS-Kosten? | Welle 2, B |
| **O-861** | In welcher Einheit wird Zeit zur Abrechnung freigegeben, und ist eine Freigabe zurücknehmbar? | nichts, läuft mit |
| **O-886** | Darf der Stundennachweis (§ 17 MiLoG) in der Sprache der Arbeiterin stehen? | nichts, läuft mit |
| **O-06** | Gibt es einen Betriebsrat? (§ 87 BetrVG) | Geolokalisierung, Korrekturstatistik |

---

## 5. Was dieses Blatt NICHT verspricht

Der Auftrag lautete „alles vollständig, keine Zeile fehlt". Der ehrliche
Zuschnitt dazu:

- **Welle 1 und 2 machen die Plattform bedienbar** — jede Seite erreichbar
  und wieder verlassbar, jede Funktion, die im täglichen Betrieb fehlt,
  vorhanden.
- **Welle 3 macht sie auffindbar.**
- **Welle 4 macht sie zweisprachig fertig.**
- Die **242 `TODO(client)`** bleiben, bis der Mandant sie beantwortet. Sie
  sind der vorgesehene Zustand einer Plattform, die keine Geschäftsregel
  erfindet — sie verschwinden durch Antworten, nicht durch Programmieren.

Nach jeder Welle steht dieses Blatt auf dem neuesten Stand: was erledigt ist,
wird gestrichen; was dazukommt, wird mit Datei und Zeile eingetragen.
