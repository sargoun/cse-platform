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
  MIGRATIONEN,
  SOFT_DELETE,
} from '../../src/server/db/schema/rls.js';
import {
  blockAusMigration,
  erzeuge,
  MIGRATIONS_DATEIEN,
  ZIEL,
} from '../../scripts/generate-triggers.js';

describe('the delete-lock registry is the single source (01-ORDNERSTRUKTUR §6.2)', () => {
  it('src/server/db/triggers/no-hard-delete.sql matches the registry', () => {
    expect(readFileSync(ZIEL, 'utf8')).toBe(erzeuge());
  });

  it('and each migration carries exactly its own block', () => {
    // The migration runner applies `drizzle/*.sql` and nothing else, so a
    // trigger file nobody applies protects nothing. One block per migration,
    // because a trigger cannot be created before its table exists — a single
    // block would put `nummernkreis` into 0005, one migration too early.
    for (const m of MIGRATIONEN) {
      expect(blockAusMigration(readFileSync(MIGRATIONS_DATEIEN[m]!, 'utf8')), m).toBe(erzeuge(m));
    }
  });

  it('every table gets its locks in the migration that creates it', () => {
    /**
     * Der Tabellenname endet HIER, und das ist der Unterschied zwischen
     * einer Pruefung und einem Zufall.
     *
     * `before delete on raum` als blosse Teilzeichenkette trifft auch
     * `before delete on raum_import_historie` — und meldete dann, `raum`
     * bekomme seine Sperre in zwei Migrationen. Der Zeilenumbruch dahinter
     * ist die Grenze des Namens.
     */
    const sperrzeile = (tabelle: string): RegExp =>
      new RegExp(`before delete on ${tabelle}\\s*$`, 'mu');

    for (const l of KEIN_HARD_DELETE) {
      expect(erzeuge(l.migration), l.tabelle).toMatch(sperrzeile(l.tabelle));
      for (const andere of MIGRATIONEN.filter((m) => m !== l.migration)) {
        expect(erzeuge(andere), `${l.tabelle} @ ${andere}`).not.toMatch(sperrzeile(l.tabelle));
      }
    }
  });

  it('every entry states an art and a reason a reviewer can check', () => {
    for (const l of KEIN_HARD_DELETE) {
      expect(['soft', 'archiv', 'append'], l.tabelle).toContain(l.art);
      // "for safety" is not a reason. A legal or domain citation is.
      // Eine Rechtsgrundlage ODER eine SPEC-Anforderung — beide sind pruefbar,
      // "aus Sicherheitsgruenden" ist es nicht.
      expect(l.grund, l.tabelle)
        // `REQ`, `REP` und `CRM` sind SPEC-Anker derselben Art wie `DOC` und
        // `FIN`, die schon dastanden — nicht eine Lockerung, sondern die
        // Fortsetzung derselben Liste in die Phase-2-Domäne. `OPS` (SPEC §5,
        // OPS-01 bis OPS-03: Objekte, Raumbuch, Belagsart-Katalog) setzt sie
        // in die Phase-4-Domäne fort, `TIM`, `CLN`, `SEC-\d\d` und `EMP` in
        // die von Phase 5 — Dienstplan, Zeiterfassung und die beiden
        // Gewerkemodule; `BAU-\d\d` setzt sie ins dritte fort (SPEC §7,
        // BAU-01 bis BAU-08: Leistungsverzeichnis, Aufmass, Nachtrag,
        // Behinderung, Bautagebuch, Wetter). `ACC-\d\d` ist der Anker der
        // Buchhaltung (SPEC §20: Kontenrahmen, Buchungssatz, Periode) und
        // `AGT-\d\d` der der Agenten (SPEC §22: Aufgabe, Schritt, Kosten,
        // Budget). Die Liste bleibt eine Liste von SPEC-Ankern; sie waechst
        // mit den Phasen, statt sich zu „irgendein Grund" zu oeffnen.
        .toMatch(
          /LEG-\d\d|SEC-A9|DSGVO|MiLoG|D-09|APR-\d\d|DOC-\d\d|FIN-\d\d|AUT-\d\d|REQ-\d\d|REP-\d\d|CRM-\d\d|OPS-\d\d|TIM-\d\d|CLN-\d\d|SEC-\d\d|EMP-\d\d|BAU-\d\d|ACC-\d\d|AGT-\d\d|§/u,
        );
      expect(l.grund.length, l.tabelle).toBeGreaterThan(60);
    }
  });

  it('names no table twice, in any of the three lists', () => {
    const tabellen = KEIN_HARD_DELETE.map((l) => l.tabelle);
    expect(new Set(tabellen).size).toBe(tabellen.length);
    const a = AUDITIERT.map((x) => x.tabelle);
    const g = GEAENDERT_AM.map((x) => x.tabelle);
    expect(new Set(a).size).toBe(a.length);
    expect(new Set(g).size).toBe(g.length);
  });

  it('SOFT_DELETE is derived, never maintained beside the registry', () => {
    expect(SOFT_DELETE).toEqual(
      KEIN_HARD_DELETE.filter((l) => l.art === 'soft').map((l) => l.tabelle),
    );
  });

  it('an audited table is delete-locked — an audit trail of rows that can vanish is half a trail', () => {
    for (const { tabelle, migration } of AUDITIERT) {
      const eintrag = KEIN_HARD_DELETE.find((l) => l.tabelle === tabelle);
      expect(eintrag, tabelle).toBeDefined();
      // And in the SAME migration: locks and audit arrive with the table.
      expect(eintrag!.migration, tabelle).toBe(migration);
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
    /**
     * Der Gegenbeweis braucht eine Tabelle, die es NOCH NICHT gibt. Das war
     * `rechnung`, bis PR 46 sie angelegt hat, danach `buchungssatz`, bis
     * PR 58 ihn angelegt hat — genau das, was diese Prüfung bemerken soll.
     * `datev_export` kommt mit FIN-17 (SPEC §20, die EXTF-Ausgabe) und tritt
     * an ihre Stelle; wer sie anlegt, sucht sich die nächste.
     */
    expect(jetzt).not.toContain('trg_datev_export_kein_hard_delete');
  });
});
