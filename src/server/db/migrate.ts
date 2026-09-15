/**
 * Applies every migration in `drizzle/` in filename order.
 *
 * Migrations live in the repository and are applied by the migrator role —
 * never edited in a dashboard, because a schema change nobody can review is a
 * schema change nobody can revert.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const url = process.env['DATABASE_URL'];
if (url === undefined || url === '') {
  throw new Error('DATABASE_URL fehlt — die Migration hat kein Ziel.');
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const verzeichnis = join(process.cwd(), 'drizzle');

/**
 * **Was der Server koennen muss, BEVOR die erste Migration laeuft.**
 *
 * Ohne diese Pruefung laeuft der Lauf 151 Dateien weit und bricht dann mit
 * `extension "vector" is not available` ab — einer Meldung, die den Grund
 * nennt und nicht den Weg heraus. Schlimmer: die Datenbank ist danach HALB
 * migriert, und jeder folgende Befehl scheitert an etwas anderem
 * (`function app.demo_kennwort_setzen does not exist`), sodass drei Fehler
 * einen einzigen Ursprung verbergen.
 *
 * Geprueft wird deshalb am Anfang, und die Meldung nennt den Befehl, der es
 * behebt. Eine Pruefung, die nur sagt, was fehlt, kostet den naechsten
 * Menschen eine halbe Stunde.
 */
async function pruefeVoraussetzungen(): Promise<void> {
  const fehlt: string[] = [];

  const [vektor] = await sql.unsafe<{ da: boolean }[]>(
    `select exists (select 1 from pg_available_extensions where name = 'vector') as da`);
  if (vektor?.da !== true) {
    fehlt.push(
      'Die Erweiterung `vector` (pgvector) fehlt auf diesem Server.\n'
      + '  Der Wissensindex (0151, AGT-06) braucht sie. Das nackte `postgres:16`-Bild\n'
      + '  hat sie nicht — `pgvector/pgvector:pg16` IST dasselbe Postgres 16, nur mit\n'
      + '  der Erweiterung darin (D-496). So kommt der Container zustande:\n\n'
      + '    docker rm -f cse-db\n'
      + '    docker run -d --name cse-db -e POSTGRES_USER=postgres \\\n'
      + '      -e POSTGRES_HOST_AUTH_METHOD=trust -p 5433:5432 pgvector/pgvector:pg16\n');
  }

  /*
   * **Der K-06-Schluessel ist keine Kleinigkeit** (0040, ArbZG-Fenster).
   * Fehlt er, laeuft die Migration durch und der SEED bleibt unvollstaendig:
   * jede Schichtplanung scheitert einzeln, meldet `unrecognized configuration
   * parameter`, und am Ende stehen null Einteilungen und null Zeiteintraege da
   * -- ohne dass irgendwo steht, dass das ein Fehler war.
   */
  const [schluessel] = await sql.unsafe<{ wert: string | null }[]>(
    `select current_setting('cse.fenster_schluessel', true) as wert`);
  if (schluessel?.wert === null || schluessel?.wert === '') {
    fehlt.push(
      'Der Fensterschluessel `cse.fenster_schluessel` ist nicht gesetzt.\n'
      + '  Ohne ihn migriert die Datenbank zwar, aber der Seed legt KEINE\n'
      + '  Einteilungen und KEINE Zeiteintraege an — er meldet je Schicht\n'
      + '  `unrecognized configuration parameter` und macht weiter.\n'
      + '  Auf einer Entwicklungsflaeche genuegt ein Wegwerfwert:\n\n'
      + "    docker exec cse-db psql -U postgres -c \\\n"
      + "      \"alter database postgres set cse.fenster_schluessel = "
      + "'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O'\"\n\n"
      + '  Danach den Container einmal neu starten: docker restart cse-db\n');
  }

  if (fehlt.length === 0) return;
  process.stderr.write(
    `\nDie Datenbank ist fuer diese Migrationen nicht vorbereitet `
    + `(${String(fehlt.length)} ${fehlt.length === 1 ? 'Punkt' : 'Punkte'}):\n\n`
    + fehlt.map((f, i) => `${String(i + 1)}. ${f}`).join('\n')
    + '\nEs wurde NICHTS migriert — die Datenbank ist unveraendert.\n'
    + 'Die ganze Reihenfolge steht in docs/LOKAL-STARTEN.md.\n\n');
  await sql.end();
  process.exit(1);
}

await pruefeVoraussetzungen();

await sql.unsafe(`create table if not exists __drizzle_migrations (
  name text primary key, angewendet_am timestamptz not null default now())`);

const angewendet = new Set(
  (await sql.unsafe<{ name: string }[]>(`select name from __drizzle_migrations`)).map((r) => r.name),
);

for (const datei of readdirSync(verzeichnis).filter((d) => d.endsWith('.sql')).sort()) {
  if (angewendet.has(datei)) continue;
  process.stdout.write(`  → ${datei}\n`);
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(join(verzeichnis, datei), 'utf8'));
    await tx.unsafe(`insert into __drizzle_migrations (name) values ($1)`, [datei]);
  });
}

await sql.end();
process.stdout.write('Migrationen angewendet.\n');
