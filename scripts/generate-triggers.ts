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
  '0016': join(WURZEL, 'drizzle/0016_formular.sql'),
  '0017': join(WURZEL, 'drizzle/0017_lead.sql'),
  '0020': join(WURZEL, 'drizzle/0020_crm_identitaet.sql'),
  '0021': join(WURZEL, 'drizzle/0021_objekt_raumbuch.sql'),
  '0022': join(WURZEL, 'drizzle/0022_leistungskatalog.sql'),
  '0023': join(WURZEL, 'drizzle/0023_kalkulation.sql'),
  '0024': join(WURZEL, 'drizzle/0024_angebot.sql'),
  '0025': join(WURZEL, 'drizzle/0025_auftrag.sql'),
  '0026': join(WURZEL, 'drizzle/0026_raumbuch_import.sql'),
  '0028': join(WURZEL, 'drizzle/0028_dienstplan.sql'),
  '0029': join(WURZEL, 'drizzle/0029_revier_turnus.sql'),
  '0030': join(WURZEL, 'drizzle/0030_nachweis_qualifikation.sql'),
  '0031': join(WURZEL, 'drizzle/0031_bewacher_eintrag.sql'),
  '0040': join(WURZEL, 'drizzle/0040_arbzg_konflikt.sql'),
  '0033': join(WURZEL, 'drizzle/0033_mandant_einstellung.sql'),
  '0034': join(WURZEL, 'drizzle/0034_zeiteintrag.sql'),
  '0035': join(WURZEL, 'drizzle/0035_checkin_token.sql'),
  '0036': join(WURZEL, 'drizzle/0036_zeiteintrag_korrektur.sql'),
  '0041': join(WURZEL, 'drizzle/0041_einsatz_medien.sql'),
  '0042': join(WURZEL, 'drizzle/0042_offline_warteschlange.sql'),
  '0050': join(WURZEL, 'drizzle/0050_auftrag_leistung.sql'),
  '0051': join(WURZEL, 'drizzle/0051_zeiteintrag_auftrag.sql'),
  '0052': join(WURZEL, 'drizzle/0052_zeit_einwand.sql'),
  '0060': join(WURZEL, 'drizzle/0060_stundenkonto.sql'),
  '0061': join(WURZEL, 'drizzle/0061_urlaubskonto.sql'),
  '0065': join(WURZEL, 'drizzle/0065_revier_raum.sql'),
  '0066': join(WURZEL, 'drizzle/0066_leistungsnachweis.sql'),
  '0067': join(WURZEL, 'drizzle/0067_sonderleistung.sql'),
  '0068': join(WURZEL, 'drizzle/0068_reklamation_qualitaetspruefung.sql'),
  '0069': join(WURZEL, 'drizzle/0069_posten.sql'),
  '0070': join(WURZEL, 'drizzle/0070_wachbuch.sql'),
  '0073': join(WURZEL, 'drizzle/0073_abwesenheit.sql'),
  '0074': join(WURZEL, 'drizzle/0074_antrag.sql'),
  '0071': join(WURZEL, 'drizzle/0071_lv_position.sql'),
  '0072': join(WURZEL, 'drizzle/0072_aufmass.sql'),
  // Finanzen (PR 46). `0076` traegt keinen Block: es legt keine Tabelle an,
  // sondern nur Ausloeser auf den Tabellen aus `0075`.
  '0075': join(WURZEL, 'drizzle/0075_rechnung.sql'),
  '0077': join(WURZEL, 'drizzle/0077_rechnung_hash.sql'),
  // Security B (PR 42). Der PR-Plan nennt 0057/0058 — beide sind vergeben.
  '0078': join(WURZEL, 'drizzle/0078_dienstanweisung_kenntnisnahme.sql'),
  '0079': join(WURZEL, 'drizzle/0079_schluessel_quittung.sql'),
  // Bau B (PR 44). Der PR-Plan nennt 0061/0062 — beide sind vergeben.
  '0080': join(WURZEL, 'drizzle/0080_nachtrag.sql'),
  '0081': join(WURZEL, 'drizzle/0081_behinderung.sql'),
  // Bau C (PR 45). Der PR-Plan nennt 0063/0064 — beide sind vergeben.
  '0082': join(WURZEL, 'drizzle/0082_bautagebuch.sql'),
  '0083': join(WURZEL, 'drizzle/0083_wetter_beobachtung.sql'),
  // Die fuenf Abrechnungsarten (PR 48). Der PR-Plan nennt 0069/0070 — beide
  // sind vergeben. `0106` traegt keinen Block: es legt keine Tabelle an,
  // sondern typisiert eine Spalte auf `rechnungsposition` (0075).
  '0105': join(WURZEL, 'drizzle/0105_abrechnungsart.sql'),
  // Finanzen (PR 49). Der PR-Plan nennt 0071 — an `lv_position` vergeben.
  '0107': join(WURZEL, 'drizzle/0107_position_herkunft.sql'),
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
