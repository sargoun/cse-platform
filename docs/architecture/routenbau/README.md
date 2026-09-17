# Routenbau: die 117 offenen Adressen

**Stand: 17.09.2026.** Dieses Verzeichnis ist eine **Werkbank, kein Archiv.**
Was hier liegt, gehört an eine andere Stelle im Baum und wartet nur darauf,
dorthin getragen zu werden. Ist es dort, verschwindet es hier.

Der Grund, dass es dieses Verzeichnis überhaupt gibt: die Arbeit läuft über
viele Sitzungen und mehrere Container, und ein Container ist flüchtig. Was in
`/tmp` liegt, ist beim nächsten Neustart weg — und der Plan für diese 117
Adressen hat 30 Agenten und 4,8 Millionen Token gekostet. Er liegt deshalb im
Verlauf, wo ihn nichts mehr verliert.

---

## Was der Stand ist

Die Seitenkarte führt 439 Adressen. 322 davon sind gebaut. **117 waren offen** —
73 trugen einen Platzhalter, 44 gab es gar nicht. Sie sind der Gegenstand dieser
Werkbank.

Nicht offen, obwohl es von aussen so aussieht: die Adressen, die die Zählung
früher als „dynamisch gefangen" führte. Die funktionieren; sie haben nur keine
eigene Datei.

| Aufwand | Zahl | Was es heisst |
|---|---|---|
| `klein` | 28 | Seite allein — Dienst und Tabellen stehen |
| `mittel` | 60 | Seite und neue Dienstfunktionen |
| `gross` | 29 | braucht vorher eine Migration |

Dazu **62 Tabellen und Spalten**, die `docs/architecture/02-datenmodell/`
vollständig beschreibt und die keine Migration angelegt hat. Das ist der eine
Befund, der die Zahl 29 erklärt: nicht die Seiten fehlten, sondern das Fundament
darunter.

### Je Domäne

| Domäne | Routen | Migrationen | Zustand |
|---|---|---|---|
| finanzen | 15 | 0180–0189 | Bau fertig, Kritik offen |
| personal | 7 | 0190–0199 | Bau fertig, Kritik offen |
| einstellungen | 6 | 0200–0209 | Bau fertig, Kritik offen |
| bau | 6 | 0210–0219 | im Bau |
| datenschutz | 5 | 0220–0229 | Bau fertig, Kritik offen |
| aufgaben-nachrichten-oeffentlich | 9 | 0230–0244 | Bau fertig, Kritik offen |
| crm-rest | 7 | 0245–0254 | im Bau |
| kundenportal | 10 | 0255–0264 | offen |
| dienstplan-zeit | 6 | 0265–0274 | im Bau |
| stammdaten | 5 | 0275–0279 | im Bau |
| website-pflege | 9 | 0280–0284 | offen |
| reinigung-security-qualitaet | 11 | 0285–0289 | offen |
| agenten-freigaben-radar | 6 | 0290–0294 | offen |
| vertrieb-rest | 9 | 0295–0299 | offen |
| mitarbeiterportal | 6 | 0300–0304 | offen |

**Die Nummernbereiche sind nicht Kosmetik.** Acht Agenten arbeiten gleichzeitig
im selben Arbeitsbaum. Der Migrator sortiert nach Dateinamen; zwei Agenten, die
beide „die nächste Nummer" nehmen, schreiben sich in dieselbe und die Reihenfolge
ist verloren. Deshalb ist jeder Bereich vorher zugeteilt, und die Reihenfolge der
Bereiche ist die Reihenfolge der Abhängigkeiten:

- `werbewiderspruch` entsteht in **0220** (datenschutz), weil **0230**
  (Nachrichten) darauf zeigt.
- `aufgabe` entsteht in **0230**, weil **0245** (CRM-Wiedervorlage) darauf zeigt.
- `anstellung_kondition` entsteht in **0192** (personal), weil **0200**
  (einstellungen) darauf zeigt.
- Die Nachrichtenspalten entstehen in **0231**, weil **0255** (Kundenportal)
  seine `t_kunde`-Policy daran hängt.

Ebenso zugeteilt sind die Nummern für offene Geschäftsfragen, damit zwei Agenten
nicht dieselbe `O-NN` für zwei verschiedene Fragen vergeben:
O-600 ff. finanzen · O-610 personal · O-620 einstellungen · O-630 bau ·
O-640 datenschutz · O-650 aufgaben/nachrichten · O-660 crm · O-670 kundenportal ·
O-680 website · O-690 stammdaten · O-700 reinigung/security/qualität ·
O-710 dienstplan · O-720 agenten · O-730 vertrieb · O-740 mitarbeiterportal.
Mehr als drei Ziffern darf eine O-Nummer nicht haben — die Wache liest
`O-\d{1,3}`.

---

## Was in diesem Verzeichnis liegt

### `plan/<domäne>.md` — der Bauplan

Je Domäne: für jede offene Adresse der Zustand, ob Dienst und Tabellen schon da
sind, das nötige Recht und ob es im Rechtekatalog steht, eine **Vorbildseite**,
der Aufwand, der Blocker und ein ausformulierter Plan.

Ganz unten steht die **KRITIK** — ein zweiter, adversarieller Agent hat jeden
Plan gegen die lebende Datenbank und die Migrationen geprüft und 110 Korrekturen
gefunden. **Wo die Kritik dem Plan widerspricht, gilt die Kritik.** Sie ist
später entstanden und hat nachgemessen, was der Plan annahm.

Diese Dateien bleiben, bis die Domäne fertig ist. Danach sind sie Geschichte und
können weg.

### `register/<domäne>.md` — die Warteschlange

Was ein Agent nicht selbst einträgt, weil sonst acht Hände in derselben Datei
schreiben:

- `src/server/registry/dienste.ts`
- `src/server/auth/route-manifest.ts`
- `src/server/db/schema/rls.ts`
- `src/server/registry/navigation.ts`, `tableiste.ts`, `modul.ts`
- `docs/DECISIONS.md` (Abschnitt „Offen")
- `docs/architecture/04-SEITENKARTE.md`

Jede Datei nennt die Einträge fertig formuliert. **Eingetragen heisst gelöscht:**
solange ein Abschnitt hier steht, ist er nicht im Baum, und solange er hier
steht, weiss der nächste Mensch, dass er fehlt.

### `bau-welle.mjs` — der Ablauf

Das Workflow-Skript, das eine Domäne durch drei Schritte fährt: **Bau**, dann
**Kritik**, dann **Behebung**. Es trägt die Domänentabelle mit allen
Nummernbereichen und Eigentumsregeln in sich. Aufruf:

```
Workflow({ scriptPath: 'docs/architecture/routenbau/bau-welle.mjs',
           args: { nur: ['kundenportal', 'website-pflege'] } })
```

Das Skript ist im Verlauf, damit der nächste Lauf nicht wieder erfunden werden
muss. Was darin am wenigsten offensichtlich und am wichtigsten ist: jeder Agent
prüft seine SQL gegen eine **eigene, frisch angelegte Datenbank** —

```bash
export PGPASSWORD=postgres
psql -h 127.0.0.1 -p 55432 -U postgres \
  -c "drop database if exists w_x" -c "create database w_x"
psql -h 127.0.0.1 -p 55432 -U postgres -q \
  -c "alter database w_x set cse.fenster_schluessel = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O'"
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/w_x pnpm db:migrate
```

— nicht gegen die gemeinsame. Ein voller Lauf dauert drei Sekunden, und ohne den
Fensterschlüssel bricht er mit einer Meldung ab, die nach einem kaputten Server
aussieht.

---

## Wie es weitergeht

In dieser Reihenfolge, und die Reihenfolge ist der Punkt:

1. **Die Wellen laufen lassen, bis alle 15 Domänen `Bau → Kritik → Behebung`
   hinter sich haben.** Offene Domänen siehe Tabelle oben.

2. **Die Warteschlange leeren.** `register/*.md` in die gemeinsamen Dateien
   tragen — eine Hand, eine Sitzung. Danach die Einträge dort löschen.

3. **`pnpm db:triggers`.** Die Löschsperren entstehen aus `schema/rls.ts`; ohne
   Schritt 2 erzeugt der Lauf einen Block ohne die neuen Tabellen, und
   `unveraenderbarkeit.test.ts` zählt Datenbank gegen Register **in beide
   Richtungen** — eine Tabelle mit Sperre, die nicht im Register steht, ist
   genauso rot wie eine im Register ohne Sperre.

4. **`pnpm seitenkarte`** — die Adressliste neu erzeugen.

5. **Prüfen, in genau dieser Folge:**

   ```
   pnpm guards && pnpm typecheck && pnpm eslint
   pnpm test                 # Einheiten
   pnpm test:isolation       # RLS gegen echtes Postgres
   pnpm e2e:db               # NACH der Isolationssuite
   pnpm test:e2e             # ZULETZT, allein
   ```

   Zwei Fallen, die je einen ganzen Lauf gekostet haben:

   - Der `globalSetup` der Isolationssuite **setzt `cse_test` auf den
     jungfräulich migrierten Stand zurück.** Läuft `pnpm e2e:db` davor, ist der
     Seed danach weg und die Browsersuite läuft gegen leere Tabellen.
   - Während die Browsersuite läuft, darf **nichts** an den Quellen ändern und
     **nichts** die Datenbank anfassen. Next baut während des Laufs; eine
     Änderung mitten darin bricht ihn mit einer Meldung, die aussieht wie ein
     kaputter Server. Das Zeitlimit steht auf 600 s, weil ein warmer Neubau
     3 min 13 s braucht.

   Und eine, die `tsc` nicht findet: `npx tsc --noEmit` sieht **keine**
   Routentypfehler. Ein zusätzlicher Export in einer `page.tsx`, ein `<Link
   href>` mit einer zur Laufzeit gebauten Zeichenkette — beides erscheint erst
   in `pnpm build`. Dafür gibt es die Wachen `page-fremder-export` und
   `verweis-rechte`.

6. **Dieses Verzeichnis abräumen.** Ist eine Domäne fertig und ihre Einträge
   sind im Baum, gehen `plan/<domäne>.md` und `register/<domäne>.md` weg. Bleibt
   am Ende nur diese README, kann auch sie gehen.

---

## Die Regeln, an denen hier am meisten scheitert

Sie stehen vollständig in `CLAUDE.md`. Drei davon entscheiden in diesem
Arbeitspaket über Richtig und Falsch, weil fast jede der 117 Adressen an eine
Frage stösst, die niemand entschieden hat:

**Nie eine Geschäftsregel erfinden.** Offen bleibt offen: eine Schnittstelle, ein
klar bezeichneter Platzhalter, `// TODO(client, O-NN): <die genaue Frage>` mit der
Nummer in derselben Zeile, und eine Zeile in `docs/DECISIONS.md` unter „Offen".
Eine plausibel geratene Frist, ein plausibel geratener Steuersatz, eine plausibel
geratene Grenze — das ist der teuerste Fehler, den dieses Projekt machen kann,
weil er aussieht wie eine Antwort.

**Der Blocker ist kein Grund, die Seite nicht zu bauen.** Die Seite entsteht
vollständig — Daten, Tabelle, Filter, Rechte, Leerzustand. Nur die eine unbekannte
Regel wird der Platzhalter, in der Oberfläche sichtbar als „offen (O-NN)". Eine
leere Seite ist kein Ergebnis.

**Nichts vortäuschen.** Ohne Zugangsdaten: die Schnittstelle bauen, in der
Oberfläche „nicht verbunden" schreiben, und **nie** einen erfolgreichen externen
Aufruf simulieren.
