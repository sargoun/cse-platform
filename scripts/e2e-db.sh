#!/usr/bin/env bash
# Eine FRISCHE Datenbank fuer die Browsersuite — und zwar jedes Mal.
#
# **Warum das ein eigenes Skript braucht.** Die Browsersuite schreibt. Sie legt
# Posten, Auftraege, Projekte, Aufmassblaetter, Wachbuchseiten und ganze
# Personen an — sie muss, denn sie prueft das Anlegen. Loeschen kann sie
# nichts: in Finanzen, Zeiterfassung und Audit gibt es keine harten Loeschungen
# (Invariante 8), und genau das ist richtig so.
#
# Die Folge sah man erst beim zweiten Lauf gegen dieselbe Datenbank: eine
# Zeile, die einmal eindeutig war, stand nun doppelt da, und Playwright meldete
# im strikten Modus einen Fehler, der wie ein kaputter Bildschirm aussah und
# keiner war. Ein Lauf ergab 24 Fehlschlaege, der naechste gegen dieselbe
# Datenbank 38 — dieselbe Anwendung, derselbe Commit. Eine Messung, die vom
# Zustand der Vorgaengermessung abhaengt, ist keine.
#
# **Der `content:import` ist kein Zusatz, sondern Teil des Seeds.** Die
# oeffentlichen Seiten lesen ihren Inhalt aus `seite`/`abschnitt` (PUB-07);
# ohne den Import antwortet `/` mit 404, und zweiundvierzig Faelle scheitern
# an etwas, das wie ein kaputtes Routing aussieht.
set -euo pipefail

DSN="${TEST_DATABASE_URL:-${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:55432/cse_e2e}}"
DB="${DSN##*/}"; DB="${DB%%\?*}"
VERWALTUNG="${DSN%/*}/postgres"

echo "▸ Datenbank $DB wird verworfen und neu angelegt"
psql "$VERWALTUNG" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB\" with (force)"
psql "$VERWALTUNG" -v ON_ERROR_STOP=1 -q -c "create database \"$DB\""

# `cse.fenster_schluessel` ist der HMAC-Schluessel hinter `fenster_gruppe` (K-06).
# Er ist eine DATENBANKEINSTELLUNG und ueberlebt `drop database` deshalb nicht —
# ohne diese Zeile wirft `app.arbzg_belastung` "unrecognized configuration
# parameter", und der Besetzungslauf des Seeds laesst jede Schicht offen, mit
# einer Meldung, die nach einem kaputten Dienstplan aussieht. Derselbe
# OFFENSICHTLICHE Testwert wie in `scripts/test-db.sh` (base64 von
# "TEST-KEY-NICHT-FUER-PRODUKTION"): ein echter Schluessel im Repository ist keiner.
psql "$VERWALTUNG" -v ON_ERROR_STOP=1 -q -c \
  "alter database \"$DB\" set cse.fenster_schluessel = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O'"

echo "▸ Migrationen"
DATABASE_URL="$DSN" TEST_DATABASE_URL="$DSN" pnpm db:migrate

echo "▸ Seed"
DATABASE_URL="$DSN" TEST_DATABASE_URL="$DSN" pnpm db:seed

echo "▸ Inhalt der oeffentlichen Seiten"
DATABASE_URL="$DSN" TEST_DATABASE_URL="$DSN" pnpm content:import

echo "▸ fertig — $DB ist frisch."
