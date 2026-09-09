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
