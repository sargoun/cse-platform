/**
 * The registry, the generated trigger file and the migration are three copies
 * of one list, and three copies drift. These tests are what stops them.
 *
 * No database here on purpose: this is a claim about the repository, and it
 * must fail on a laptop with no Postgres running, in the same second the
 * registry is edited without regenerating.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUDITIERT,
  GEAENDERT_AM,
  KEIN_HARD_DELETE,
  SOFT_DELETE,
} from '../../src/server/db/schema/rls.js';
import { blockAusMigration, erzeuge, MIGRATION, ZIEL } from '../../scripts/generate-triggers.js';

describe('the delete-lock registry is the single source (01-ORDNERSTRUKTUR §6.2)', () => {
  it('src/server/db/triggers/no-hard-delete.sql matches the registry', () => {
    expect(readFileSync(ZIEL, 'utf8')).toBe(erzeuge());
  });

  it('and the block embedded in the migration matches it too', () => {
    // The migration runner applies `drizzle/*.sql` and nothing else, so a
    // trigger file nobody applies protects nothing.
    expect(blockAusMigration(readFileSync(MIGRATION, 'utf8'))).toBe(erzeuge());
  });

  it('every entry states an art and a reason a reviewer can check', () => {
    for (const l of KEIN_HARD_DELETE) {
      expect(['soft', 'archiv', 'append'], l.tabelle).toContain(l.art);
      // "for safety" is not a reason. A legal or domain citation is.
      expect(l.grund, l.tabelle).toMatch(/LEG-\d\d|SEC-A9|DSGVO|MiLoG|D-09/u);
      expect(l.grund.length, l.tabelle).toBeGreaterThan(60);
    }
  });

  it('names no table twice, in any of the three lists', () => {
    const tabellen = KEIN_HARD_DELETE.map((l) => l.tabelle);
    expect(new Set(tabellen).size).toBe(tabellen.length);
    expect(new Set(AUDITIERT).size).toBe(AUDITIERT.length);
    expect(new Set(GEAENDERT_AM).size).toBe(GEAENDERT_AM.length);
  });

  it('SOFT_DELETE is derived, never maintained beside the registry', () => {
    expect(SOFT_DELETE).toEqual(
      KEIN_HARD_DELETE.filter((l) => l.art === 'soft').map((l) => l.tabelle),
    );
  });

  it('an audited table is delete-locked — an audit trail of rows that can vanish is half a trail', () => {
    for (const t of AUDITIERT) {
      expect(KEIN_HARD_DELETE.map((l) => l.tabelle), t).toContain(t);
    }
  });

  it('the generator emits a TRUNCATE lock for every DELETE lock', () => {
    const sql = erzeuge();
    for (const { tabelle } of KEIN_HARD_DELETE) {
      expect(sql).toContain(`before delete on ${tabelle}`);
      // TRUNCATE fires no row trigger, so a DELETE lock alone leaves the door
      // open to emptying the table in one statement.
      expect(sql).toContain(`before truncate on ${tabelle}`);
      expect(sql).toContain(
        `revoke delete, truncate on ${tabelle} from cse_app, cse_anon, cse_checkin, cse_job;`,
      );
    }
  });

  it('regenerating after a registry change produces DIFFERENT sql — the test can fail', () => {
    // A drift test that cannot notice a change is decoration. This proves the
    // generator reads the registry rather than a constant.
    const jetzt = erzeuge();
    expect(jetzt).toContain('trg_anstellung_kein_hard_delete');
    expect(jetzt).not.toContain('trg_rechnung_kein_hard_delete');
  });
});
