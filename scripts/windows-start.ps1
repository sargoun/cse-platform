<#
.SYNOPSIS
  Die CSE-Plattform auf einem Windows-Rechner starten -- ein Befehl.

.DESCRIPTION
  Der Grund fuer diese Datei ist ein Protokoll: die Anleitung war eine Liste von
  zehn Befehlen zum Einzelkopieren, und beim Einfuegen ging genau das schief,
  was eine Liste nicht auffangen kann.

   - Ein Server von vorhin hielt Hafen 3001. `pnpm build` brach ab (der
     Waechter sagte sogar, was zu tun ist) -- und die uebrigen Befehle liefen
     WEITER, weil PowerShell bei einem Fehler nicht stehenbleibt. Am Ende stand
     `EADDRINUSE`, und der Mensch davor hatte drei Fehlermeldungen, von denen
     nur die erste zaehlte.
   - Beim zweiten Anlauf lief der Seed gegen eine Datenbank, die schon Daten
     hatte. Er ist idempotent, also legte er nichts nach und meldete ueberall
     `0` -- "0 Werkzeugzeilen", "0 Einteilungen", "Social: 0 Kanaele". Das las
     sich wie ein kaputter Seed und war ein gesunder.

  Dieses Skript macht beides unmoeglich: es beendet einen laufenden Server
  ZUERST, es bleibt bei jedem Fehlschlag stehen, und es setzt die Datenbank
  standardmaessig frisch auf, damit die Zahlen am Ende die vollen sind.

.PARAMETER Port
  Hafen fuer die Anwendung. Vorgabe 3001.

.PARAMETER DatenBehalten
  Die Datenbank NICHT neu aufsetzen. Dann laeuft der Seed ueber die
  vorhandenen Daten und meldet ueberall `0` -- das ist richtig so, sieht aber
  aus wie ein Fehlschlag. Nur benutzen, wenn eigene Eingaben erhalten bleiben
  sollen.

.PARAMETER OhneBau
  Nur Datenbank und Daten herrichten, nicht bauen und nicht starten.

.EXAMPLE
  .\scripts\windows-start.ps1
  Alles: Datenbank frisch, migrieren, seeden, Texte importieren, bauen, starten.
#>
[CmdletBinding()]
param(
  [int]    $Port = 3001,
  [switch] $DatenBehalten,
  [switch] $OhneBau
)

# `Stop` gilt nur fuer PowerShell-Fehler. Externe Programme (pnpm, docker)
# melden ueber den Rueckgabewert, und den fragt niemand von selbst -- deshalb
# unten `Schritt`.
$ErrorActionPreference = 'Stop'

$DatenbankUrl = 'postgres://postgres@localhost:5433/postgres'
$Behaelter    = 'cse-db'
# Base64 von `TEST-KEY-NICHT-FUER-PRODUKTION`. Gehoert in keine echte
# Installation -- siehe docs/LOKAL-STARTEN.md, Abschnitt 3.
$FensterKey   = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O'

function Titel($text) {
  Write-Host ''
  Write-Host "  $text" -ForegroundColor Cyan
}

function Hinweis($text) { Write-Host "    $text" -ForegroundColor DarkGray }

# Ein Schritt, der WIRKLICH stehenbleibt. `pnpm` gibt bei Fehlschlag einen
# Rueckgabewert ungleich 0 zurueck und schreibt nach stderr; ohne diese
# Pruefung laeuft das Skript darueber hinweg, und der erste Fehler versteckt
# sich hinter dem dritten.
function Schritt($beschreibung, [scriptblock] $block) {
  Titel $beschreibung
  # Zuruecksetzen, BEVOR der Block laeuft. `$LASTEXITCODE` haelt den Wert des
  # letzten NATIVEN Befehls -- endet ein Block auf einem Cmdlet, stuende hier
  # sonst der Rueckgabewert von irgendwoher, und das Skript braeche an einer
  # Stelle ab, an der nichts schiefging.
  $global:LASTEXITCODE = 0
  & $block
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "  ABGEBROCHEN bei: $beschreibung" -ForegroundColor Red
    Write-Host "  Rueckgabewert $LASTEXITCODE. Die Meldung darueber ist die, die zaehlt." -ForegroundColor Red
    exit 1
  }
}

# -- Vorbedingungen --------------------------------------------------------
foreach ($werkzeug in @('pnpm', 'docker')) {
  if (-not (Get-Command $werkzeug -ErrorAction SilentlyContinue)) {
    Write-Host "  '$werkzeug' ist nicht installiert oder nicht im PATH." -ForegroundColor Red
    exit 1
  }
}

$env:DATABASE_URL     = $DatenbankUrl
$env:CSE_DEV_FLAECHEN = '1'
$env:PORT             = "$Port"

Titel 'Umgebung'
Hinweis "DATABASE_URL     = $env:DATABASE_URL"
Hinweis "CSE_DEV_FLAECHEN = $env:CSE_DEV_FLAECHEN  (Demodaten, Code auf dem Bildschirm, Kekse ohne Secure)"
Hinweis "PORT             = $env:PORT"

# -- Einen laufenden Server ZUERST beenden ---------------------------------
# Das ist der Schritt, dessen Fehlen das Protokoll oben erzeugt hat.
Titel "Laeuft schon etwas auf Hafen $Port ?"
$belegt = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($belegt) {
  # Erst fragen, ob es UNSER Server ist: `/healthz` braucht keine Datenbank
  # und keine Sitzung, und ein fremder Dienst bildet die Antwort nicht nach.
  $unser = $false
  try {
    $antwort = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 2
    $unser = ($antwort.status -eq 'ok')
  } catch { $unser = $false }

  if (-not $unser) {
    Write-Host ''
    Write-Host "  Auf Hafen $Port antwortet etwas, das NICHT diese Plattform ist." -ForegroundColor Red
    Write-Host "  Es wird nichts beendet, was nicht uns gehoert." -ForegroundColor Red
    Write-Host "  Entweder das fremde Programm schliessen -- oder einen anderen Hafen nehmen:" -ForegroundColor Red
    Write-Host "      .\scripts\windows-start.ps1 -Port 3002" -ForegroundColor Red
    exit 1
  }

  Hinweis 'Ja -- ein Server dieses Projekts. Er wird beendet.'
  $belegt | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  Hinweis 'beendet.'
} else {
  Hinweis 'nein, der Hafen ist frei.'
}

# -- Alten Bau verwerfen ---------------------------------------------------
Titel 'Alten Bau und Cache verwerfen'
Remove-Item -Recurse -Force '.next', 'node_modules\.cache' -ErrorAction SilentlyContinue
Hinweis 'Ein alter Bau haelt geloeschte Routen fest und beantwortet sie weiter.'

Schritt 'Abhaengigkeiten' { pnpm install }

# -- Datenbank -------------------------------------------------------------
if ($DatenBehalten) {
  Titel 'Datenbank bleibt stehen (-DatenBehalten)'
  Hinweis 'Der Seed legt dann nichts nach und meldet ueberall 0. Das ist richtig,'
  Hinweis 'sieht aber aus wie ein Fehlschlag.'
} else {
  Titel 'Datenbank frisch aufsetzen'
  Hinweis 'pgvector/pgvector:pg16 -- dasselbe Postgres 16 MIT der Erweiterung `vector`.'
  Hinweis 'Der Wissensindex (0151) braucht sie; mit `postgres:16` bricht db:migrate ab.'
  docker rm -f $Behaelter 2>$null | Out-Null
  docker run -d --name $Behaelter -e POSTGRES_USER=postgres -e POSTGRES_HOST_AUTH_METHOD=trust -p 5433:5432 pgvector/pgvector:pg16 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  Der Datenbankbehaelter liess sich nicht starten. Laeuft Docker?' -ForegroundColor Red
    exit 1
  }

  Hinweis 'warte auf die Datenbank ...'
  # ---------------------------------------------------------------------
  # `pg_isready` LUEGT waehrend der Erstinitialisierung -- und das ist kein
  # Fehler des Werkzeugs, sondern die Bauart des Abbilds.
  #
  # Der Einstiegspunkt von `postgres:16` faehrt fuer `initdb` und die
  # Init-Skripte einen VORUEBERGEHENDEN Server hoch. Der horcht mit
  # `listen_addresses=''` ausschliesslich auf dem Unix-Socket. Danach faehrt
  # der Einstiegspunkt ihn wieder HERUNTER und startet den echten.
  #
  # `pg_isready` spricht ueber genau diesen Socket und meldet in diesem
  # Fenster Erfolg. Wer dann zuschlaegt, trifft die Luecke zwischen beiden
  # Servern und bekommt:
  #
  #   psql: error: connection to server on socket
  #   "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory
  #
  # Gemeldet von einem frischen Windows-Rechner, abgebrochen bei
  # 'ArbZG-Fensterschluessel (K-06)' -- dem ersten Befehl nach dieser
  # Schleife. Das Skript lief also richtig; die Frage war falsch.
  #
  # ZWEI Aenderungen, und beide zaehlen:
  #   1. Ueber TCP statt ueber den Socket. Der voruebergehende Server horcht
  #      GAR NICHT auf TCP -- ein Treffer ueber 127.0.0.1 kann deshalb nur
  #      der echte sein. Das ist der eigentliche Riegel.
  #   2. Mit einer ABFRAGE statt mit `pg_isready`. Wer `select 1` beantwortet,
  #      beantwortet auch das naechste `alter database`.
  # ---------------------------------------------------------------------
  $bereit = $false
  foreach ($versuch in 1..60) {
    Start-Sleep -Seconds 1
    docker exec $Behaelter psql -h 127.0.0.1 -U postgres -tAc 'select 1' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $bereit = $true; break }
  }
  if (-not $bereit) {
    Write-Host '  Die Datenbank antwortet nach 60 Sekunden nicht.' -ForegroundColor Red
    Write-Host '  Was der Behaelter selbst sagt:' -ForegroundColor Red
    docker logs --tail 30 $Behaelter
    exit 1
  }
  Hinweis 'bereit -- und zwar der echte Server, nicht der Init-Server.'

  # MUSS vor dem Seed gesetzt sein: `alter database ... set` wirkt erst fuer NEUE
  # Verbindungen. Danach gesetzt, kommt der Schluessel fuer diesen Seed zu
  # spaet, und der Besetzungslauf endet mit 0 Einteilungen.
  Schritt 'ArbZG-Fensterschluessel (K-06)' {
    # `-h 127.0.0.1` aus demselben Grund wie in der Schleife darueber: ueber
    # TCP kann nur der echte Server antworten.
    docker exec $Behaelter psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 `
      -c "alter database postgres set cse.fenster_schluessel = '$FensterKey'" | Out-Null
  }
}

Schritt 'Schema migrieren'  { pnpm db:migrate }
Schritt 'Demodaten anlegen' { pnpm db:seed }
Schritt 'Texte importieren' { pnpm content:import }

if ($OhneBau) {
  Titel 'Fertig (-OhneBau): nicht gebaut, nicht gestartet.'
  exit 0
}

Schritt 'Bauen' { pnpm build }

# -- Wo man hineinkommt ----------------------------------------------------
$lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host ''
Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
Write-Host '   Bereit.' -ForegroundColor Green
Write-Host ''
Write-Host "   Am Rechner   http://localhost:$Port"
if ($lan) { Write-Host "   Am Telefon   http://${lan}:$Port" }
Write-Host ''
Write-Host '   Verwaltung   /auth/login    leitung.reinigung@cse-gruppe.de'
Write-Host '                               Kennwort: demo-cse-2026'
Write-Host '   Beschaeftigte /auth/mitarbeiter   0170 1000000  (Fatima Yildiz)'
Write-Host '                               Der Code steht danach auf dem Bildschirm.'
Write-Host '   Alle Rollen  /dev/anmelden  ein Klick, kein Kennwort'
Write-Host ''
Write-Host '   Die admin-Konten laufen in den zweiten Faktor -- leitung.* ist kuerzer.'
Write-Host '  ------------------------------------------------------------' -ForegroundColor Green
Write-Host ''
Write-Host '   Zum Beenden: Strg+C' -ForegroundColor DarkGray
Write-Host ''

pnpm start
