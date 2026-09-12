# Lokal starten — die Demo auf einem eigenen Rechner

Diese Seite beschreibt den vollständigen Weg von einem leeren Rechner zu einer
laufenden Demo mit Berliner Beispieldaten. Sie ist bewusst **eine Liste ohne
Auslassungen**: jede Zeile, die hier fehlt, fehlt später als Fehlermeldung.

Voraussetzungen: Node ≥ 22, `pnpm`, Docker.

---

## 1. Der kurze Weg

Windows (PowerShell):

```powershell
$env:DATABASE_URL   = "postgres://postgres@localhost:5433/postgres"
$env:CSE_DEV_FLAECHEN = "1"
$env:PORT           = "3001"

# Alten Build und Cache verwerfen — sie tragen geloeschte Routen
Remove-Item -Recurse -Force .next, node_modules\.cache -ErrorAction SilentlyContinue

pnpm install

# Frische Datenbank
docker rm -f cse-db
docker run -d --name cse-db -e POSTGRES_USER=postgres -e POSTGRES_HOST_AUTH_METHOD=trust `
  -p 5433:5432 postgres:16
Start-Sleep -Seconds 6

# K-06-Schluessel — siehe Abschnitt 3. OHNE DIESE ZEILE bleibt der Seed unvollstaendig.
docker exec cse-db psql -U postgres -c `
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
  -p 5433:5432 postgres:16
sleep 6

docker exec cse-db psql -U postgres -c \
  "alter database postgres set cse.fenster_schluessel = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O'"

pnpm db:migrate && pnpm db:seed && pnpm content:import
pnpm build && pnpm start
```

Danach: <http://localhost:3001> (oeffentliche Website) und
<http://localhost:3001/dev/anmelden> (Rollenkonten der Demo).

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
| `unrecognized configuration parameter "cse.fenster_schluessel"` | Abschnitt 3. | Einstellung setzen, dann `pnpm db:seed` erneut. |
| `/` antwortet mit 404 | `content:import` fehlt. | `pnpm content:import` |
| `Ignored build scripts: esbuild@…` | pnpm fuehrt Installationsskripte nicht ungefragt aus. | Folgenlos fuer die Demo. |
| `The Next.js plugin was not detected in your ESLint configuration` | Die Regelwerke stehen in `eslint.config.js`, nicht im Next-Plugin. | Folgenlos; `pnpm lint` ist die maßgebliche Pruefung. |
| Seed meldet `O-134`, `O-01` | Keine Stoerung, sondern die offene Liste: ohne bestaetigte Nummernmaske entsteht bewusst keine Rechnung. | `docs/DECISIONS.md`, Abschnitt „Offen". |

---

## 5. Testdatenbanken — getrennt von der Demo

Die Suiten fassen die Demo-Datenbank nie an:

```bash
pnpm db:test:up        # Isolationsdatenbank, setzt cse.fenster_schluessel selbst
pnpm test              # Vitest, ohne Datenbank
pnpm test:isolation    # RLS, Ausloeser, Rechte
pnpm e2e:db            # Datenbank fuer den Browser: verwerfen, migrieren, seeden, importieren
pnpm test:e2e          # Playwright
```
