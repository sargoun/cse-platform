/**
 * Generates `src/server/db/triggers/no-hard-delete.sql` from the registry in
 * `src/server/db/schema/rls.ts` (01-ORDNERSTRUKTUR §6.2).
 *
 *   pnpm db:triggers          write the file
 *   pnpm db:triggers --check  fail if the file is stale (this is what CI runs)
 *
 * The generated block is embedded verbatim in `drizzle/0005_immutability_audit.sql`
 * between the two sentinels below, because the migration runner applies
 * `drizzle/*.sql` and nothing else — a trigger file nobody applies protects
 * nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUDITIERT, GEAENDERT_AM, KEIN_HARD_DELETE } from '../src/server/db/schema/rls.js';

const WURZEL = resolve(import.meta.dirname, '..');
export const ZIEL = join(WURZEL, 'src/server/db/triggers/no-hard-delete.sql');
export const MIGRATION = join(WURZEL, 'drizzle/0005_immutability_audit.sql');
export const BEGINN = '-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern';
export const ENDE = '-- >>> Ende des generierten Blocks';

export function erzeuge(): string {
  const zeilen: string[] = [
    BEGINN,
    '-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.',
    '',
  ];

  for (const { tabelle, art, grund } of KEIN_HARD_DELETE) {
    zeilen.push(
      `-- ${tabelle} (${art}): ${grund.replace(/\s+/gu, ' ')}`,
      `create trigger trg_${tabelle}_kein_hard_delete`,
      `  before delete on ${tabelle}`,
      `  for each row execute function kern.verhindere_loeschung();`,
      // TRUNCATE is a hard delete of every row at once and fires no row-level
      // trigger. Without this a maintenance session empties the table in one
      // statement past a BEFORE DELETE that never runs.
      `create trigger trg_${tabelle}_kein_truncate`,
      `  before truncate on ${tabelle}`,
      `  for each statement execute function kern.verhindere_loeschung();`,
      `revoke delete, truncate on ${tabelle} from cse_app, cse_anon, cse_checkin, cse_job;`,
      '',
    );
  }

  for (const tabelle of GEAENDERT_AM) {
    zeilen.push(
      `create trigger trg_${tabelle}_geaendert_am`,
      `  before update on ${tabelle}`,
      `  for each row execute function kern.setze_geaendert_am();`,
    );
  }
  zeilen.push('');

  for (const tabelle of AUDITIERT) {
    zeilen.push(
      `create trigger trg_${tabelle}_audit`,
      `  after insert or update or delete on ${tabelle}`,
      `  for each row execute function kern.protokolliere_aenderung();`,
    );
  }

  zeilen.push('', ENDE, '');
  return zeilen.join('\n');
}

/** The generated block as it currently sits inside the migration. */
export function blockAusMigration(inhalt: string): string | null {
  const von = inhalt.indexOf(BEGINN);
  const bis = inhalt.indexOf(ENDE);
  if (von < 0 || bis < 0) return null;
  return inhalt.slice(von, bis + ENDE.length + 1);
}

const direktAufgerufen =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (direktAufgerufen) {
  const erwartet = erzeuge();
  const pruefen = process.argv.includes('--check');

  if (pruefen) {
    const datei = readFileSync(ZIEL, 'utf8');
    const inMigration = blockAusMigration(readFileSync(MIGRATION, 'utf8'));
    if (datei !== erwartet || inMigration !== erwartet) {
      process.stderr.write(
        'Trigger-Datei ist veraltet. `pnpm db:triggers` ausführen und die Migration angleichen.\n',
      );
      process.exit(1);
    }
    process.stdout.write('Trigger-Datei ist aktuell.\n');
  } else {
    writeFileSync(ZIEL, erwartet);
    process.stdout.write(`geschrieben: ${ZIEL}\n`);
  }
}
