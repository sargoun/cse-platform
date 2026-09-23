# Lokal starten — die Demo auf einem eigenen Rechner

Diese Seite beschreibt den vollständigen Weg von einem leeren Rechner zu einer
laufenden Demo mit Berliner Beispieldaten. Sie ist bewusst **eine Liste ohne
Auslassungen**: jede Zeile, die hier fehlt, fehlt später als Fehlermeldung.

Voraussetzungen: Node ≥ 22, `pnpm`, Docker.

---

## 1. Der kurze Weg

**Windows: ein Befehl.**

```powershell
.\scripts\windows-start.ps1
```

Er macht alles, was unten steht — und drei Dinge, die eine Befehlsliste nicht
kann:

- **Er beendet einen laufenden Server ZUERST.** Der haeufigste Fehlschlag beim
  zweiten Anlauf: auf 3001 haengt noch ein Server von vorhin, `pnpm build`
  bricht ab, und die uebrigen Befehle laufen trotzdem weiter, weil PowerShell
  bei einem Fehler nicht stehenbleibt. Am Ende stehen drei Meldungen, von denen
  nur die erste zaehlt. Vorher wird geprueft, ob der Server auf dem Hafen
  ueberhaupt UNSERER ist (`/healthz`) — ein fremdes Programm wird nicht
  abgeschossen.
- **Er bleibt bei jedem Fehlschlag stehen** und nennt den Schritt.
- **Er setzt die Datenbank frisch auf.** Sonst laeuft der Seed ueber vorhandene
  Daten, legt (richtigerweise) nichts nach und meldet ueberall `0` — was sich
  wie ein kaputter Seed liest und keiner ist. Wer eigene Eingaben behalten
  will: `-DatenBehalten`.

Schalter: `-Port 3002` · `-DatenBehalten` · `-OhneBau`.

**Speicher.** Das Skript setzt `NODE_OPTIONS=--max-old-space-size=6144`, wenn
nichts anderes gesetzt ist. Ohne das stirbt `pnpm build` auf einem frischen
Rechner im letzten Schritt mit `JavaScript heap out of memory` — Node gibt
einem Prozess von sich aus rund 2 GB, und die Typprüfung des ganzen Projekts
braucht gemessen rund 3,3 GB. Wer die Befehle von Hand ausführt, setzt es
vorher selbst:

```powershell
$env:NODE_OPTIONS = "--max-old-space-size=6144"
```

Am Ende nennt er die Adresse fuer das Telefon und die Konten zum Anmelden.

---

Derselbe Weg von Hand, Windows (PowerShell):

```powershell
$env:DATABASE_URL   = "postgres://postgres@localhost:5433/postgres"
$env:CSE_DEV_FLAECHEN = "1"
$env:PORT           = "3001"

# Alten Build und Cache verwerfen — sie tragen geloeschte Routen
Remove-Item -Recurse -Force .next, node_modules\.cache -ErrorAction SilentlyContinue

pnpm install

# Frische Datenbank — `pgvector/pgvector:pg16`, NICHT `postgres:16`.
# Es ist dasselbe Postgres 16, nur mit der Erweiterung `vector` darin. Der
# Wissensindex (0151) braucht sie; ohne sie bricht `db:migrate` ab und die
# Datenbank bleibt halb migriert.
docker rm -f cse-db
docker run -d --name cse-db -e POSTGRES_USER=postgres -e POSTGRES_HOST_AUTH_METHOD=trust `
  -p 5433:5432 pgvector/pgvector:pg16

# Warten, bis der ECHTE Server antwortet — und zwar ueber TCP.
# Hier stand `Start-Sleep -Seconds 6`, und das ist ein Muenzwurf: das Abbild
# faehrt fuer `initdb` erst einen VORUEBERGEHENDEN Server hoch, der nur auf
# dem Unix-Socket horcht, und faehrt ihn danach wieder herunter. Wer in die
# Luecke zwischen beiden trifft, bekommt
#   „connection to server on socket .../.s.PGSQL.5432 failed: No such file or directory"
# Der voruebergehende Server horcht GAR NICHT auf TCP — ein Treffer ueber
# 127.0.0.1 kann deshalb nur der echte sein.
# Die Umleitung steht INNERHALB des Behaelters: sonst macht Windows
# PowerShell aus „the database system is starting up" einen terminierenden
# Fehler — und das ist genau die Meldung, auf die diese Schleife wartet.
foreach ($i in 1..60) {
  Start-Sleep -Seconds 1
  docker exec cse-db sh -c 'psql -h 127.0.0.1 -U postgres -tAc "select 1" >/dev/null 2>&1'
  if ($LASTEXITCODE -eq 0) { break }
}

# K-06-Schluessel — siehe Abschnitt 3. OHNE DIESE ZEILE bleibt der Seed unvollstaendig.
docker exec cse-db psql -h 127.0.0.1 -U postgres -c `
  "alter database postgres set cse.fenster_schluessel = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O'"

pnpm db:migrate
pnpm db:seed
pnpm content:import      # ohne ihn antwortet `/` mit 404 (PUB-07)

pnpm build
pnpm start
```

macOS/Linux (bash) — dieselbe Reihenfolge:

```bash
export DATABASE_URL="postgres://postgres@localhost:5433/postgres"
export CSE_DEV_FLAECHEN=1 PORT=3001

rm -rf .next node_modules/.cache
pnpm install

docker rm -f cse-db 2>/dev/null || true
docker run -d --name cse-db -e POSTGRES_USER=postgres -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 5433:5432 pgvector/pgvector:pg16

# Warten, bis der ECHTE Server antwortet — ueber TCP, nicht ueber den Socket.
# Begruendung siehe die PowerShell-Fassung darueber: `sleep 6` ist ein
# Muenzwurf gegen den voruebergehenden initdb-Server.
for i in $(seq 60); do
  docker exec cse-db psql -h 127.0.0.1 -U postgres -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done

docker exec cse-db psql -h 127.0.0.1 -U postgres -c \
  "alter database postgres set cse.fenster_schluessel = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O'"

pnpm db:migrate && pnpm db:seed && pnpm content:import
pnpm build && pnpm start
```

Danach: <http://localhost:3001> (oeffentliche Website) und
<http://localhost:3001/dev/anmelden> (Rollenkonten der Demo).

---

## 1b. Schlüssel und Anbindungen

Was hier steht, bringt die Demo zum Laufen. **Welche Schlüssel es sonst gibt,
wo sie hingehören und was ohne sie passiert**, steht in einem eigenen Blatt —
in zwei Sprachen, weil es auch der Betreiber lesen können muss:

- `docs/EINRICHTEN-DE.md`
- `docs/EINRICHTEN-AR.md`

Die vollständige Liste der Umgebungsvariablen liegt als `.env.example` im
Projektordner. Anfangen: `cp .env.example .env.local`.

---

## 1a. Wer sich wie anmeldet

**Verwaltung, Leitung, Kunde — `/auth/login`**, Kennwort fuer alle:
`demo-cse-2026`.

| E-Mail | Rolle | sieht |
|---|---|---|
| `admin@cse-gruppe.de` | super_admin | Gruppensicht und alle vier Gesellschaften |
| `leitung.reinigung@cse-gruppe.de` | leitung | CSE Dienstleistungen |
| `leitung.bau@cse-gruppe.de` | leitung | REALTIME Service |
| `leitung.security@cse-gruppe.de` | leitung | SSE Security |
| `admin.reinigung@cse-gruppe.de` | admin | Verwaltung der Reinigung |
| `kunde.demo@example.test` | kunde | Kundenportal |

Die `admin`- und `super_admin`-Konten laufen in den zweiten Faktor (2FA ist fuer
sie Pflicht). **Der kuerzeste Weg hinein ist deshalb `leitung.*`.**

**Beschaeftigte — `/auth/mitarbeiter`, Mobilnummer und Einmalcode, KEIN
Kennwort** (EMP-01). Die Nummern der Demopersonen stehen auf
<http://localhost:3001/dev/anmelden>; ohne SMS-Gateway (O-82) erscheint der Code
dort auf dem Bildschirm, wo sonst die SMS ankaeme.

| Nummer | Mensch | besonders |
|---|---|---|
| `0170 1000000` | Fatima Yildiz | ein Mensch, ZWEI Gesellschaften (D-09) |
| `0170 1000002` | Amir Haddad | dieselbe Oberflaeche auf Arabisch (EMP-12) |

Die nationale Schreibweise mit fuehrender Null ist die richtige — sie wird auf
E.164 normalisiert, bevor verglichen wird. Der Rest der Seed-Personen hat
absichtlich keinen Portalzugang; ihre Nummern fuehren auf die Codeseite und
dort nicht weiter (D-543).

---

## 1b. `CSE_DEV_FLAECHEN=1` ist nicht optional — sonst kommt das Telefon nicht rein

Die Flagge steht oben in derselben Zeile wie `DATABASE_URL`, und sie entscheidet
mehr, als ihr Name sagt:

- sie legt die **Demodaten** an (ohne sie bleibt der Seed bei der Struktur),
- sie zeigt den **Einmalcode auf dem Bildschirm**, solange kein SMS-Gateway
  verbunden ist,
- sie oeffnet **`/dev/anmelden`**,
- und seit D-541 entscheidet sie, ob die Anmeldekekse **`Secure`** tragen.

Der letzte Punkt ist der, an dem eine Anmeldung am Telefon frueher unmoeglich
war. `pnpm start` setzt `NODE_ENV=production`; das Telefon erreicht den Rechner
aber ueber `http://192.168.x.x`, und einen `Secure`-Keks verwirft dort **jeder**
Browser (RFC 6265bis §5.5). Ohne die Flagge kommt man auf einem Telefon im
eigenen Netz also nicht hinein — nicht weil etwas kaputt ist, sondern weil die
Verbindung unverschluesselt ist. Die Anmeldeseite sagt das inzwischen auch hin.

**Produktiv gilt das Gegenteil:** dort steht die Flagge NICHT, die Kekse tragen
`Secure` und den `__Host-`-Namen, und die Plattform gehoert hinter HTTPS.

---

## 2. Die Reihenfolge ist kein Zufall

| Schritt | Warum er nicht verschoben werden darf |
|---|---|
| `.next` verwerfen | Ein alter Build haelt geloeschte Routen fest und beantwortet sie weiter — der Fehler sieht dann wie ein Codefehler aus und ist keiner. |
| `alter database … cse.fenster_schluessel` | `alter database … set` wirkt erst fuer **neue** Verbindungen. Nach `db:seed` gesetzt, kommt er fuer diesen Seed zu spaet. |
| `db:migrate` vor `db:seed` | Der Seed schreibt gegen das fertige Schema, nicht gegen ein halbes. |
| `content:import` | Der Seed legt Seiten**gerueste** an, der Import die Texte. Ohne ihn antwortet `/` mit 404 (PUB-07, D-302). |

---

## 3. `cse.fenster_schluessel` — warum er laut fehlt

Er ist der HMAC-Schluessel hinter `fenster_gruppe` (K-06): er macht die
ArbZG-Belastung einer Person ueber Gesellschaftsgrenzen hinweg vergleichbar,
**ohne** preiszugeben, wer wo arbeitet. Er steht deshalb bewusst nicht in der
Umgebung, sondern als Datenbankeinstellung (`07-INTEGRATIONEN` §Betriebsgeheimnisse)
— und ein `drop database` nimmt ihn mit (D-302).

Fehlt er, meldet der Besetzungslauf je Schicht

```
· Schicht 47d69e71 bleibt offen: unrecognized configuration parameter "cse.fenster_schluessel"
```

und der Seed endet mit `0 Einteilungen, 0 Zeiteintraege`. **Das ist die
gewollte Richtung:** eine ArbZG-Pruefung, die ohne Schluessel still ein leeres
Ergebnis lieferte, bestuende immer — und zwar auch dann, wenn ein Mensch in
zwei Gesellschaften zwoelf Stunden gearbeitet hat.

Der Wert oben ist base64 von `TEST-KEY-NICHT-FUER-PRODUKTION` und gehoert in
keine echte Installation. Produktiv wird er einmal erzeugt
(`openssl rand -base64 32`), im Geheimnisspeicher abgelegt und alle 180 Tage
gewechselt.

---

## 4. Wenn etwas klemmt

| Meldung | Ursache | Behebung |
|---|---|---|
| `listen EADDRINUSE: address already in use :::3001` | Eine frueher gestartete Instanz haelt den Port. | PowerShell: `Get-NetTCPConnection -LocalPort 3001 -State Listen \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` · bash: `kill $(lsof -ti tcp:3001)` |
| Seite kommt **ohne Gestaltung** (Times New Roman, blaue unterstrichene Verweise, kein Menue) | Ein zweiter Next-Server hat `.next` ueberschrieben — siehe Abschnitt 5. | Alle laufenden Server beenden, dann `pnpm build` und `pnpm start` erneut. |
| `psql: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory` — meist beim Schritt **ArbZG-Fensterschluessel (K-06)** | **Nicht** Ihr Rechner, und der Behaelter laeuft. Das Postgres-Abbild faehrt fuer `initdb` einen **voruebergehenden** Server hoch, der nur auf dem Unix-Socket horcht, und faehrt ihn danach wieder herunter. `pg_isready` meldet in diesem Fenster Erfolg — der naechste Befehl trifft dann die Luecke zwischen beiden Servern. | Behoben: `windows-start.ps1` und die Handfassungen oben warten jetzt ueber **TCP** (`psql -h 127.0.0.1 -tAc 'select 1'`). Der voruebergehende Server horcht gar nicht auf TCP, ein Treffer kann also nur der echte sein. Bei einem alten Stand des Skripts: `docker rm -f cse-db` und erneut starten. |
| `unrecognized configuration parameter "cse.fenster_schluessel"` | Abschnitt 3. | Einstellung setzen, dann `pnpm db:seed` erneut. |
| `/` antwortet mit 404 | `content:import` fehlt. | `pnpm content:import` |
| `Ignored build scripts: esbuild@…` | pnpm fuehrt Installationsskripte nicht ungefragt aus. | Folgenlos fuer die Demo. |
| `The Next.js plugin was not detected in your ESLint configuration` | Die Regelwerke stehen in `eslint.config.js`, nicht im Next-Plugin. | Folgenlos; `pnpm lint` ist die maßgebliche Pruefung. |
| Seed meldet `O-134`, `O-01` | Keine Stoerung, sondern die offene Liste: ohne bestaetigte Nummernmaske entsteht bewusst keine Rechnung. | `docs/DECISIONS.md`, Abschnitt „Offen". |

---

## 5. Ein Server zur Zeit — sonst kommt die Seite ohne Gestaltung

**Der Befund, wie er auf dem Telefon ankam:** die Startseite laedt, die Bilder
sind da, der Text steht in Times New Roman, die Fusszeilenverweise sind blau
und unterstrichen, das Menue tut nichts. Keine Fehlermeldung, nirgends.

**Die Ursache ist eine Zeile, die jeder wegklickt.** Lief noch ein
`pnpm dev` von vorhin (es meldet sich nur mit `EADDRINUSE`), und laeuft dann
`pnpm build`, so schreibt der Bau **dasselbe Verzeichnis**, das der laufende
Server gerade ausliefert: `.next`. Danach gibt es die Datei
`.next/static/css/app/layout.css` nicht mehr, der Entwicklungsserver antwortet
darauf mit `404`, und der Browser bekommt eine Seite ohne eine einzige Zeile
CSS und ohne JavaScript. Die Bilder kommen weiter, denn die liegen in
`public/` und nicht in `.next` — was den Eindruck vollendet, es sei „nur das
Layout kaputt".

**Die Gegenrichtung ist genauso still:** startet `pnpm dev`, waehrend
`pnpm start` laeuft, raeumt es den Produktionsbau weg, und der laufende Server
antwortet fortan mit *Could not find a production build*.

**Seit D-414 faengt das ein Waechter ab.** `pnpm dev` und `pnpm build` fragen
vorher auf `PORT`, 3000 und 3001 nach `/healthz`. Antwortet dort ein Server
dieses Projekts, brechen sie ab und nennen den Befehl zum Beenden — fuer
Windows und fuer bash. Wer einen Fehlalarm hat (auf 3000 antwortet ein fremdes
Projekt), setzt `CSE_BAU_OHNE_WACHE=1`.

Die Regel dahinter ist einfacher als ihre Begruendung: **erst beenden, dann
bauen.**

---

## 6. Testdatenbanken — getrennt von der Demo

Die Suiten fassen die Demo-Datenbank nie an:

```bash
pnpm db:test:up        # Isolationsdatenbank, setzt cse.fenster_schluessel selbst
pnpm test              # Vitest, ohne Datenbank
pnpm test:isolation    # RLS, Ausloeser, Rechte — vier Arbeiter, je eine Datenbank (D-424)
pnpm e2e:db            # Datenbank fuer den Browser: verwerfen, migrieren, seeden, importieren
pnpm test:e2e          # Playwright
```

Die Isolationssuite legt sich ihre Datenbanken selbst an, alle im Testcluster
auf Port 55432: `cse_test_w1` … `cse_test_w4` fuer die vier Arbeiter,
`cse_test_vorlage` und `cse_test_vorlage_inhalt` als geseedete Vorlagen, dazu
die fuenf eigenen der Dateien, die den echten Seed pruefen (`cse_seed`,
`cse_oeffentlich`, …). Die Vorlagen werden nur neu gebaut, wenn sich unter
`src`, `drizzle` oder `scripts`, an `package.json`, `pnpm-lock.yaml` oder den
Aufbauhelfern unter `tests/isolation/` etwas geaendert hat — und einmal am
Tag, weil der Seed relativ zu heute plant. Sonst kostet der Aufbau eine
Sekunde je Klon. Zwei Laeufe auf derselben `cse_test` zugleich gibt es nicht:
der zweite wird abgewiesen, solange der erste die Sperre haelt. Faellt eine
Datei nur in Gesellschaft anderer, hilft der alte, serielle Lauf:

```bash
CSE_ISOLATION_WORKER=1 pnpm test:isolation
```
