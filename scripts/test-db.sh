#!/usr/bin/env bash
# A throwaway Postgres for the isolation suite.
#
# The suite proves RLS at the database level, so it needs a real Postgres —
# a mock would prove nothing at all. This starts one on port 55432, applies
# every migration in order, and tears it down again.
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/lib/postgresql/cse-test}"
PORT="${PGPORT:-55432}"
DB="${PGDATABASE:-cse_test}"

als_postgres() { su postgres -c "export PATH=\$PATH:$PGBIN; $1"; }

case "${1:-up}" in
  up)
    if ! pg_isready -h localhost -p "$PORT" >/dev/null 2>&1; then
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
    als_postgres "pg_ctl -D $PGDATA -m fast stop" || true
    ;;
  *) echo "usage: test-db.sh [up|down]" >&2; exit 2 ;;
esac
