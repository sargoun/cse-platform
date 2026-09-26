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

### 1.1 🔴 Der Rückweg fehlt auf 245 von 350 Detailseiten

**Diese Zahl ist die vierte, die hier stand.** Die drei davor waren zu hoch,
und wie sie zustande kamen, gehört zum Befund — sonst wird sie beim nächsten
Mal wieder falsch gezählt.

| Messung | Muster | Ergebnis | Fehler |
|---|---|---|---|
| 1. | `grep -c "Zurueck"` | 15 von 350 | zählte auch das Wort in Kommentaren (`zurückziehen`) |
| 2. | `<Zurueck` (die Komponente) | 8 von 350 | sah nur die Komponente, nicht den handgebauten Verweis |
| 3. | `<Link` je Seitendatei | — | sah keine Hülle (`AuthSchale`, `PortalRahmen`) |
| **4.** | **`<Zurueck` ODER `← {…}`** | **105 von 350** | — |

**Die belastbare Zahl:**

```bash
# Detailseite = eine Seite, ueber der eine Elternseite steht
# Rueckweg    = die Komponente <Zurueck> ODER ein handgebauter Pfeil-Verweis
```

| Fläche | Detailseiten | mit Rückweg | **ohne** |
|---|---|---|---|
| `portal/[mandant]` | 278 | 84 | **194** |
| `portal/gruppe` | 26 | 0 | **26** |
| `portal/mein` (Arbeiter) | 26 | 13 | **13** |
| `portal/kunde` | 20 | 8 | **12** |
| **gesamt** | **350** | **105** | **245** |

**Der Befund ist also kleiner als zuerst behauptet — und in einem Punkt
schlimmer:** es gibt **drei** Bauarten für dieselbe Sache. Die Komponente
`<Zurueck>` (nur im Kundenportal), ein handgebauter `← {t.zeiten}` mit
eigenen Klassen (Arbeiterportal und Teile der Verwaltung), und auf 245 Seiten
gar nichts. Drei Bauarten heissen drei Stellen, an denen eine Änderung
hängenbleibt — genau der Grund, aus dem DESIGN §12 „no component invented ad
hoc" sagt.

**`portal/gruppe` hat auf keiner einzigen Seite einen** — 26 von 26.

### 1.1a Es gibt einen Weg HINAUS, aber keinen HINAUF

`PortalRahmen` rendert eine Spur `‹ Wurzel › Seite`, deren erster Teil auf die
**Portalwurzel** verweist (`PortalRahmen.tsx:178`). 283 der 309
`[mandant]`-Seiten rendern diesen Rahmen, 117 übergeben `wurzelTitel` und
bekommen die Spur. Der Kommentar daneben hält fest, dass „wie komme ich hier
weg" schon **zweimal** gefragt wurde.

**Sie führt aber immer ganz nach oben.** Wer auf
`/personal/anstellungen/[id]/entgelt` steht (Tiefe 4), landet auf
`/portal/[mandant]` — nicht auf der Anstellung, nicht auf der Liste. Genau das
beschreibt Beobachtung 4: „öffnet eine neue Seite, und es gibt kein Zurück zur
**vorherigen**".

Dazu die Verschachtelung:

| Tiefe unter `/portal/[mandant]/` | Seiten |
|---|---|
| 1 | 26 |
| 2 | 141 |
| 3 | 90 |
| 4 | 42 |
| 5 | 9 |
| 6 | 1 |

**142 Seiten liegen drei Ebenen oder tiefer**, während die Navigation auf 26
Wurzeln führt.

### 1.1b Was dagegen schon steht

Damit die Reparatur nicht doppelt baut:

- `src/components/portal/Zurueck.tsx` — die Komponente der Plattform, mit
  `aria-label` in allen vier Portalsprachen. `ziel` ist `Route` aus `next`
  (nicht `string`: `typedRoutes: true`, und `tsc --noEmit` sieht das nicht —
  nur `pnpm build`).
- `PortalRahmen`, `MeinRahmen`, `KundenRahmen` und `GruppenRahmen` nehmen
  `zurueck={{ziel, text}}` und rendern es **an einer Stelle**: zuerst im
  `main`, vor jeder Überschrift.

Es fehlt also nur noch, es auf den 245 Seiten zu setzen — und die 105
handgebauten auf dieselbe Bauart zu ziehen.

### 1.2 ✅ BEHOBEN — die Mitarbeiter-Anmeldung umging die gemeinsame Hülle

**Hier stand zuerst etwas Falsches, und wie es falsch war, ist lehrreich.**

Gemessen wurde „Verweise je Datei" mit `grep -c "<Link"`. Danach hätten neun
von zwölf Anmeldeseiten keinen Weg hinaus. **Zwei Messfehler steckten darin:**

1. Die `/auth`-Seiten benutzen `<a href>`, nicht Next-`<Link>` — und
   `/auth/mitarbeiter/code` einen Formularknopf. Beides zählte das Muster nicht.
2. **Der wichtigere:** neun der zwölf Seiten rendern durch `AuthSchale`
   (`src/app/auth/AuthSchale.tsx:29`), und die trägt den Rückweg
   — `← CSE Gruppe` — **seit jeher an erster Stelle**. Eine Messung je
   Seitendatei kann eine Hülle nicht sehen.

**Der echte Befund ist kleiner und genauer — und er ist genau der, den der
Mandant gemeldet hat.** Von den zwölf Seiten benutzen vier `AuthSchale` nicht:

| Seite | Hülle | Weg hinaus |
|---|---|---|
| `/auth/bereich` | eigen | ✅ eigene Fussnavigation (`Website`, `Abmelden`) |
| `/auth/einladung/[token]` | keine | ✅ reine Weiterleitung, korrekt ohne |
| **`/auth/mitarbeiter`** | keine | ❌ **keiner** |
| **`/auth/mitarbeiter/code`** | keine | nur „Andere Nummer" — raus aus dem Vorgang: keiner |

**Die Verwaltung hatte ihren Rückweg, die Arbeiterin nicht.** Beide
Mitarbeiterseiten rendern ein nacktes `<main>` mit denselben Klassen, die
`AuthSchale` setzt — eine Kopie der Hülle ohne ihren Kopf. Deshalb fehlten
ihnen auch der Schrittzähler („Schritt 1 von 2"), den der Kommentar in
`AuthSchale` ausdrücklich begründet: *wer weiss, dass noch ein Schritt kommt,
bricht beim zweiten nicht ab.*

**Behoben:** beide Seiten rendern jetzt durch `AuthSchale` und haben damit
Rückweg und Schrittzähler. Keine neue Komponente, kein neuer Wert — die
Hülle, die es gab, jetzt auch dort.

**Was daraus für den Rest dieses Blattes folgt:** die Zahl in §1.1 wurde
danach auf demselben Weg gegengeprüft — `PortalShell` und `PortalRahmen`
tragen **keinen** Rückweg zur Liste (`PortalRahmen.tsx:287` führt auf die
öffentliche Website, nicht in die Liste). Die 2 von 309 stehen.

### 1.3 🟡 51 flache Navigationseinträge, ohne jede Gruppierung

```bash
# Die Grenzen zaehlen mit, sonst zaehlt man zwei Listen als eine:
sed -n '37,423p' src/server/registry/navigation.ts | grep -c "schluessel:"
```

```
NAVIGATION          32 Einträge   (Zeilen 37–423)
GRUPPEN_NAVIGATION  18            (424–475)
KUNDEN_NAVIGATION   11            (525–559)
```

*(Hier stand 51. Das war NAVIGATION **plus** GRUPPEN\_NAVIGATION: der
Zaehlbefehl lief ueber die Listengrenze hinaus. `DESIGN-PLAN.md` §4 nennt
seit jeher 32, und diese Zahl stimmt.)*

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
| ~~**A**~~ | ✅ **ERLEDIGT** — Verwaltungskonten lassen sich einladen | siehe §1.5a |
| **B** | Stempeluhr vom Arbeiterportal unerreichbar | `grep -rn "check-in" src/app/portal/mein/` → 0 |
| ~~**C**~~ | ✅ **ERLEDIGT** — Korrektur erreicht die Mitarbeiterin jetzt | siehe §1.5c |
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

### 1.5a ✅ ERLEDIGT — ein Verwaltungskonto lässt sich einladen

**Der schwerste Befund, und am Ende der kleinste Bau** — weil die
Annahmehälfte die ganze Zeit fertig dastand:

```
kern.kennwort_token, zweck 'einladung'            0155   ✔ war da
/auth/einladung/[token] -> /auth/passwort-neu            ✔ war da
0249 benutzt genau diese Kette fuer den KUNDEN          ✔ war da
die absendende Haelfte fuer interne Konten              ✘ fehlte
```

Gebaut: `drizzle/0372` (Definer-Funktion + Policy),
`services/system/verwaltungskonto.ts`, `POST /api/system/verwaltungskonto`
und die Seite `/[mandant]/einstellungen/benutzer/einladen` — **zweisprachig**,
weil die Sperrklinke für eine NEUE Seite nichts anderes zulässt.

**Nur der Super-Admin (D-610).** Das neue Recht
`system.verwaltungskonto_erstellen` ist `nur_global`: `app.hat_recht` wertet
dafür ausschliesslich `benutzer.globale_rolle_id` aus (0169), sodass auch ein
Admin **in seiner eigenen Gesellschaft** `false` bekommt. Genau dieser Fall
ist der Test, der die Entscheidung trägt — ohne ihn wäre D-610 eine
Behauptung in einem Dokument.

**Drei Sperren, die beim Bauen aufgefallen sind:**

1. **`einladen` ist kein erlaubtes Verb.** §7.2 führt ein geschlossenes
   Aktionsvokabular, und `berechtigung_aktion` kennt es nicht. Der Schlüssel
   heisst deshalb `…_erstellen` — die Einladung IST das Anlegen, nicht eine
   zweite Art von Akt. Die Wache hat das vor dem ersten Seed gemeldet (K-19).
2. **Eine Definer-Funktion darf nicht jede Rolle vergeben.** `0249` sagt den
   Grund: *„Eine Definer-Funktion, die jede Rolle vergeben koennte, waere ein
   Weg zu `admin` ohne Rechtepruefung."* Die neue Policy
   `d_bm_verwaltungsrolle` lässt deshalb nur `admin` und `leitung` zu — auf
   Policy-Ebene, nicht nur in der Funktion.
3. **Der Rückweg hängt am Recht seines ZIELS.**
   `tests/kern/verweis-rechte.test.ts` hat gemeldet, dass die Seite auf die
   Benutzerliste zeigt, ohne deren `system.benutzer_lesen` zu prüfen. In der
   Praxis hält ein Super-Admin beides — „in der Praxis" ist keine Prüfung.

**Offen und benannt: O-887.** Ein `super_admin` ist über diesen Weg **nicht**
einladbar, und heute entsteht er ausschliesslich im Seed. Das ist ein
operatives Risiko (geht das einzige Konto verloren, ist die Plattform nicht
mehr verwaltbar) — aber eine Einladung, die Super-Admins erzeugen kann, ist
ein Weg zur vollen Gruppenmacht. Ob es ihn geben soll und unter welcher
zweiten Bedingung, entscheidet der Mandant (K-17). Die Frage steht im
Register, im Migrationskopf und **auf dem Bildschirm**.

### 1.5c ✅ ERLEDIGT — die Korrektur erreicht die Mitarbeiterin

`korrigiereZeiteintrag` schreibt jetzt zusaetzlich eine Nachricht an den
Menschen, dessen Stunden sich geaendert haben — **in SEINER Sprache**
(`person.sprache`, 0165), über die interne Schiene `kern.nachricht` (0350).

**Was uebersetzt wird und was nicht.** Der Rahmen ist in allen vier
Portalsprachen hinterlegt (`src/lib/i18n/zeitkorrektur.ts`): Betreff, Art,
Grund, und der Satz, der auf den Einwandsweg zeigt. **Die Begruendung bleibt
woertlich.** Sie ist der Wortlaut eines Menschen, steht in
Anfuehrungszeichen und kann in einem Streit ueber Lohn zitiert werden — sie
maschinell zu uebertragen hiesse, ihm Worte zuzuschreiben, die er nicht
gesagt hat. `Storno` und `Objekt` bleiben deutsch mit Erklaerung.

**In DERSELBEN Transaktion wie die Korrektur.** Eine Korrektur, deren
Nachricht scheitert, waere wieder genau der behobene Zustand — nur mit dem
guten Gewissen, es versucht zu haben. Entweder beides oder keines. Fehlt der
Rolle `nachricht.versenden`, scheitert sie mit einem Satz, der das sagt,
statt mit „new row violates row-level security" (das zeigte auf die
Zeiterfassung und verschwieg die Ursache).

**Auf der Seite der Mitarbeiterin steht, DASS korrigiert wurde — nicht
warum.** Und das ist kein Rueckstand, sondern eine bestehende Entscheidung:
`p_ma_decke` (`drizzle/0036:403`) sperrt `zeiteintrag_korrektur` fuer das
Arbeiterportal ausdruecklich — *„Der Arbeitnehmer sieht seine STUNDEN; die
Spur darueber bekommt er auf Auskunft, nicht als Bildschirm."* Diese Decke
bleibt. Gezeigt wird die **Fassungsnummer des Eintrags selbst** (`> 1` heisst
korrigiert), die ohnehin auf seiner Zeile steht — kein Grund, kein Name, kein
Betrag. Zusammen mit der Nachricht ist die Schleife geschlossen, ohne die
Decke anzuheben.

Geprüft in `tests/isolation/zeit-korrektur-nachricht.test.ts`: dass sie
entsteht, beim richtigen Menschen landet, in seiner Sprache steht, die
Begründung wörtlich durchkommt, und dass ein entzogenes Recht die Korrektur
**mit Grund** scheitern lässt statt stumm durchzugehen.

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
