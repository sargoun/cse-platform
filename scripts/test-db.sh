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
# Die erste Fassung kannte nur `su`. Auf einem GitHub-Runner laeuft der Job als
# `runner`, `su` fragte nach einem Passwort, das es nicht gibt, und der Lauf
# starb an "su: Authentication failure" — nachdem Wachen, Lint, Typecheck und
# alle Unit-Tests durchgelaufen waren.
set -euo pipefail

PGDATA="${PGDATA:-/var/lib/postgresql/cse-test}"
PORT="${PGPORT:-55432}"
DB="${PGDATABASE:-cse_test}"

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

case "${1:-up}" in
  up)
    if ! pg_isready -h localhost -p "$PORT" >/dev/null 2>&1; then
      server_binaries
      [ -d "$PGDATA" ] || als_postgres "initdb -D $PGDATA -U postgres --auth=trust -E UTF8 --locale=C"
      als_postgres "pg_ctl -D $PGDATA -o '-p $PORT -c listen_addresses=localhost -c timezone=UTC' -l /tmp/pg.log start"
      sleep 2
    fi
    # Offene Verbindungen zuerst kappen: `drop database` scheitert an einer
    # einzigen idle-Sitzung, und die Suite haelt ihren Pool ueber Dateigrenzen
    # hinweg offen. Ohne diese Zeile haengt der Fehlschlag davon ab, welche
    # Datei zufaellig zuletzt lief.
    psql -h localhost -p "$PORT" -U postgres -q -c \
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB';" >/dev/null 2>&1 || true
    psql -h localhost -p "$PORT" -U postgres -q -c "drop database if exists $DB;" -c "create database $DB;"
    for f in drizzle/0*.sql; do
      echo "  → $f"
      psql -h localhost -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
    done
    echo "Testdatenbank bereit: postgres://postgres@localhost:$PORT/$DB"
    ;;
  down)
    if [ -n "${PGBIN:-}" ] || [ -d "$PGDATA" ]; then
      server_binaries
      als_postgres "pg_ctl -D $PGDATA -m fast stop" || true
    fi
    ;;
  *) echo "usage: test-db.sh [up|down]" >&2; exit 2 ;;
esac
