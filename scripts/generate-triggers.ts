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
import {
  AUDITIERT,
  GEAENDERT_AM,
  KEIN_HARD_DELETE,
  MIGRATIONEN,
} from '../src/server/db/schema/rls.js';

const WURZEL = resolve(import.meta.dirname, '..');
export const ZIEL = join(WURZEL, 'src/server/db/triggers/no-hard-delete.sql');

/** Which migration file carries which generated block. */
export const MIGRATIONS_DATEIEN: Readonly<Record<string, string>> = {
  '0005': join(WURZEL, 'drizzle/0005_immutability_audit.sql'),
  '0006': join(WURZEL, 'drizzle/0006_nummernkreis.sql'),
  '0007': join(WURZEL, 'drizzle/0007_benutzer_auth.sql'),
  '0009': join(WURZEL, 'drizzle/0009_dokument.sql'),
  '0012': join(WURZEL, 'drizzle/0012_freigabe.sql'),
};
export const BEGINN = '-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern';
export const ENDE = '-- >>> Ende des generierten Blocks';

/**
 * The block for one migration, or — with no argument — every block in order,
 * which is what the one reviewable file holds.
 */
export function erzeuge(migration?: string): string {
  const gewaehlt = <T extends { readonly migration: string }>(xs: readonly T[]): readonly T[] =>
    migration === undefined ? xs : xs.filter((x) => x.migration === migration);

  if (migration === undefined) {
    return MIGRATIONEN.map((m) => erzeuge(m)).join('\n');
  }

  const zeilen: string[] = [
    `${BEGINN} (${migration})`,
    '-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.',
    '',
  ];

  for (const { tabelle, art, grund } of gewaehlt(KEIN_HARD_DELETE)) {
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

  for (const { tabelle } of gewaehlt(GEAENDERT_AM)) {
    zeilen.push(
      `create trigger trg_${tabelle}_geaendert_am`,
      `  before update on ${tabelle}`,
      `  for each row execute function kern.setze_geaendert_am();`,
    );
  }
  zeilen.push('');

  for (const { tabelle } of gewaehlt(AUDITIERT)) {
    zeilen.push(
      `create trigger trg_${tabelle}_audit`,
      `  after insert or update or delete on ${tabelle}`,
      `  for each row execute function kern.protokolliere_aenderung();`,
    );
  }

  zeilen.push('', ENDE, '');
  return zeilen.join('\n');
}

/** The generated block as it currently sits inside a migration file. */
export function blockAusMigration(inhalt: string): string | null {
  const von = inhalt.indexOf(BEGINN);
  const bis = inhalt.indexOf(ENDE);
  if (von < 0 || bis < 0) return null;
  return inhalt.slice(von, bis + ENDE.length + 1);
}

/** Replaces (or appends) the generated block in one migration's text. */
export function blockEinsetzen(inhalt: string, block: string): string {
  const vorhanden = blockAusMigration(inhalt);
  if (vorhanden !== null) return inhalt.replace(vorhanden, block);
  return `${inhalt.replace(/\s*$/u, '')}\n\n${block}`;
}

const direktAufgerufen =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (direktAufgerufen) {
  const erwartet = erzeuge();
  const pruefen = process.argv.includes('--check');

  const veraltet = (): boolean => {
    if (readFileSync(ZIEL, 'utf8') !== erwartet) return true;
    return MIGRATIONEN.some(
      (m) => blockAusMigration(readFileSync(MIGRATIONS_DATEIEN[m]!, 'utf8')) !== erzeuge(m),
    );
  };

  if (pruefen) {
    if (veraltet()) {
      process.stderr.write('Trigger sind veraltet. `pnpm db:triggers` ausführen.\n');
      process.exit(1);
    }
    process.stdout.write('Trigger sind aktuell.\n');
  } else {
    writeFileSync(ZIEL, erwartet);
    for (const m of MIGRATIONEN) {
      const pfad = MIGRATIONS_DATEIEN[m]!;
      writeFileSync(pfad, blockEinsetzen(readFileSync(pfad, 'utf8'), erzeuge(m)));
      process.stdout.write(`  → ${pfad}\n`);
    }
    process.stdout.write(`geschrieben: ${ZIEL}\n`);
  }
}
