#!/usr/bin/env bash
# A throwaway Postgres for the isolation suite.
#
# The suite proves RLS at the database level, so it needs a real Postgres —
# a mock would prove nothing at all. This applies every migration in order
# against a server on port 55432.
#
# **Two ways to get that server, and the script does not care which.**
#
#   - CI reicht ihn als Dienst-Container herein. Dann laeuft er schon, und
#     dieses Skript legt nur die Datenbank an und wandert durch die
#     Migrationen. Kein `su`, kein `sudo`, keine Rechtefrage.
#   - Lokal ist keiner da, also wird einer gestartet. Das braucht den
#     `postgres`-Benutzer — im Entwicklungscontainer per `su` (er laeuft als
#     root), sonst per `sudo -n`.
#
# **`up` sorgt dafuer, dass sie steht; `neu` baut sie neu.** Der Unterschied
# ist keine Bequemlichkeit — siehe die Begruendung am Neuaufbau weiter unten.
#
# Die erste Fassung kannte nur `su`. Auf einem GitHub-Runner laeuft der Job als
# `runner`, `su` fragte nach einem Passwort, das es nicht gibt, und der Lauf
# starb an "su: Authentication failure" — nachdem Wachen, Lint, Typecheck und
# alle Unit-Tests durchgelaufen waren.
set -euo pipefail

PGDATA="${PGDATA:-/var/lib/postgresql/cse-test}"

# Die Zieldatenbank kommt aus `TEST_DATABASE_URL`, wenn eine gesetzt ist.
#
# Vorher stand hier fest `cse_test`, und das Skript setzte SIE zurueck — auch
# wenn die Suite auf eine andere Datenbank zeigte. Fuenf Isolationsdateien
# rufen dieses Skript selbst auf; sie liefen damit gegen eine Datenbank, die
# der Rest des Laufs gar nicht benutzt, und meldeten „skipped" statt eines
# Ergebnisses. Schlimmer noch in die andere Richtung: wer die Suite auf eine
# Demodatenbank zeigen laesst, um Screenshots zu machen, verlor sie hier.
DSN="${TEST_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -n "$DSN" ]; then
  # postgres://user@host:PORT/DBNAME  — Port und Name herausschneiden.
  DSN_DB="${DSN##*/}"; DSN_DB="${DSN_DB%%\?*}"
  DSN_HOSTPORT="${DSN#*://}"; DSN_HOSTPORT="${DSN_HOSTPORT%%/*}"
  DSN_PORT="${DSN_HOSTPORT##*:}"
  case "$DSN_PORT" in (*[!0-9]*) DSN_PORT="" ;; esac
fi
PORT="${PGPORT:-${DSN_PORT:-55432}}"
DB="${PGDATABASE:-${DSN_DB:-cse_test}}"

# `psql` und `pg_isready` liegen nicht ueberall auf dem PATH.
for kandidat in /usr/lib/postgresql/*/bin; do
  [ -d "$kandidat" ] && PATH="$PATH:$kandidat"
done
export PATH

als_postgres() {
  if [ "$(id -u)" -eq 0 ]; then
    su postgres -c "export PATH=\$PATH:$PGBIN; $1"
  else
    sudo -n -u postgres bash -c "export PATH=\$PATH:$PGBIN; $1"
  fi
}

# Nur noetig, wenn wir selbst einen Server starten — mit Dienst-Container gibt
# es die Serverbinaries womoeglich gar nicht, und ein harter Abbruch hier
# haette CI aus dem falschen Grund rot gemacht.
server_binaries() {
  if [ -z "${PGBIN:-}" ]; then
    PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  fi
  if [ -z "${PGBIN:-}" ] || [ ! -x "$PGBIN/initdb" ]; then
    echo "Kein PostgreSQL-Server unter /usr/lib/postgresql/*/bin gefunden, und" >&2
    echo "auf Port $PORT antwortet keiner. Die Isolationssuite braucht einen" >&2
    echo "echten Server — ein Mock beweist nichts." >&2
    exit 1
  fi
}

# Der Fingerabdruck der Migrationen — Namen UND Inhalte. Er beantwortet die
# einzige Frage, auf die es bei `up` ankommt: traegt die vorhandene Datenbank
# noch genau das, was der Baum beschreibt?
abdruck() {
  md5sum drizzle/0*.sql | md5sum | cut -d' ' -f1
}

case "${1:-up}" in
  up|neu)
    if ! pg_isready -h localhost -p "$PORT" >/dev/null 2>&1; then
      server_binaries
      [ -d "$PGDATA" ] || als_postgres "initdb -D $PGDATA -U postgres --auth=trust -E UTF8 --locale=C"
      als_postgres "pg_ctl -D $PGDATA -o '-p $PORT -c listen_addresses=localhost -c timezone=UTC' -l /tmp/pg.log start"
      sleep 2
    fi

    # Ohne Migrationen gibt es nichts aufzubauen, und ein Fingerabdruck ueber
    # eine leere Menge waere ein stabiler Wert, der nichts bedeutet.
    ls drizzle/0*.sql >/dev/null 2>&1 || {
      echo "Keine Migrationen unter drizzle/0*.sql — falsches Arbeitsverzeichnis?" >&2
      exit 1
    }

    # Nur EIN Aufbau zur Zeit. Dieselbe Datenbank wird von mehreren Laeufen
    # benutzt; zwei gleichzeitige `drop database` sind nicht bloss langsam,
    # sondern zerlegen einander.
    LOCK="${TMPDIR:-/tmp}/cse-test-db-$PORT-$DB.lock"
    exec 9>"$LOCK"
    if command -v flock >/dev/null 2>&1; then
      flock -w 600 9 || { echo "Warte-Zeit fuer $LOCK abgelaufen." >&2; exit 1; }
    fi

    ABDRUCK="$(abdruck)"

    # **`up` wirft nichts mehr weg, was schon richtig ist.**
    #
    # Vorher war `up` bedingungslos zerstoerend: `drop database`, neu anlegen,
    # alle Migrationen. Aufgerufen wird es aber nicht nur einmal vor dem Lauf
    # — FUENF Dateien der Isolationssuite rufen es in ihrem `beforeAll` selbst
    # auf. Jede davon riss mitten im Lauf die Datenbank weg, an der die Suite
    # gerade arbeitete, und kappte davor ausdruecklich alle offenen
    # Verbindungen — auch die des Pools, den die Harness ueber Dateigrenzen
    # hinweg offen haelt. Was danach passierte, hing an der Reihenfolge der
    # Dateien: mal lief alles, mal fiel eine Datei mit einer toten Verbindung,
    # mal fehlten einer spaeteren Datei die Zeilen einer frueheren. Und die
    # Fehlschlaege sahen aus wie RLS-Defekte — das schlechteste denkbare
    # Signal ausgerechnet in der Suite, die RLS beweisen soll.
    #
    # `up` heisst jetzt "sorge dafuer, dass sie steht", nicht "bau sie neu".
    # Steht sie schon und traegt denselben Migrationsstand, passiert nichts:
    # keine Verbindung wird gekappt, kein Zustand verschwindet. Wer den
    # Neuaufbau WILL, sagt `neu`. In CI aendert das nichts: dort steht der
    # Dienst-Container frisch da, die Datenbank gibt es noch gar nicht, und
    # `pnpm db:test:up` baut sie wie bisher vollstaendig auf.
    if [ "${1:-up}" = up ] \
      && [ "$(psql -h localhost -p "$PORT" -U postgres -d postgres -tAc \
             "select 1 from pg_database where datname = '$DB';" 2>/dev/null || true)" = 1 ]; then
      GESEHEN="$(psql -h localhost -p "$PORT" -U postgres -d "$DB" -tAc \
        "select current_setting('cse.migrationen', true);" 2>/dev/null || true)"
      if [ "$GESEHEN" = "$ABDRUCK" ]; then
        echo "Testdatenbank steht bereits auf diesem Migrationsstand — nichts angefasst."
        echo "postgres://postgres@localhost:$PORT/$DB"
        exit 0
      fi
    fi

    # Offene Verbindungen zuerst kappen: `drop database` scheitert an einer
    # einzigen idle-Sitzung, und die Suite haelt ihren Pool ueber Dateigrenzen
    # hinweg offen. Ohne diese Zeile haengt der Fehlschlag davon ab, welche
    # Datei zufaellig zuletzt lief.
    psql -h localhost -p "$PORT" -U postgres -q -c \
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB';" >/dev/null 2>&1 || true
    psql -h localhost -p "$PORT" -U postgres -q -c "drop database if exists $DB;" -c "create database $DB;"
    # `cse.fenster_schluessel` ist der HMAC-Schluessel hinter `fenster_gruppe`
    # (K-06). In der Auslieferung wird er als Datenbankeinstellung injiziert
    # und steht in keiner Tabelle; hier steht ein OFFENSICHTLICHER Testwert
    # (base64 von "TEST-KEY-NICHT-FUER-PRODUKTION"),
    # denn ein echter Schluessel im Repository ist keiner. Ohne die Zeile wirft
    # `app.arbzg_belastung` „unrecognized configuration parameter" — laut, und
    # das ist die richtige Richtung.
    psql -h localhost -p "$PORT" -U postgres -q -c \
      "alter database $DB set cse.fenster_schluessel = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O';"
    for f in drizzle/0*.sql; do
      echo "  → $f"
      psql -h localhost -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
    done
    # Der Fingerabdruck wird ERST hier gesetzt, nach der letzten Migration.
    # Eine halb migrierte Datenbank — abgebrochener Lauf, Fehler in der Mitte —
    # traegt dann keinen, und der naechste `up` baut sie neu auf, statt sie
    # fuer fertig zu halten.
    psql -h localhost -p "$PORT" -U postgres -q -c \
      "alter database $DB set cse.migrationen = '$ABDRUCK';"
    echo "Testdatenbank bereit: postgres://postgres@localhost:$PORT/$DB"
    ;;
  down)
    if [ -n "${PGBIN:-}" ] || [ -d "$PGDATA" ]; then
      server_binaries
      als_postgres "pg_ctl -D $PGDATA -m fast stop" || true
    fi
    ;;
  *) echo "usage: test-db.sh [up|neu|down]" >&2; exit 2 ;;
esac
