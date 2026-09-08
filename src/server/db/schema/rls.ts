/**
 * The delete-lock and audit registries.
 *
 * `01-ORDNERSTRUKTUR.md` §6.2 makes this file the single enumeration —
 * "`rls.ts.kein_hard_delete` enumerates them and `db/triggers/no-hard-delete.sql`
 * is generated from that list". The generator is `scripts/generate-triggers.ts`
 * and the generated block is embedded verbatim in `drizzle/0005`; a test fails
 * the build if the three drift apart.
 *
 * **Deletion protection is stated per table, never assumed globally** (K-16).
 * A table absent from this list is deletable, and that has to be a decision
 * somebody made rather than a line nobody wrote. So every entry carries the
 * reason, and the test enumerating the database refuses a table that carries
 * the trigger without appearing here — the registry cannot go stale in either
 * direction.
 */

/**
 * How a delete-locked table records the end of a row's life. K-16 and
 * `01-ORDNERSTRUKTUR.md` §6.2 are explicit that these are not interchangeable:
 * "a soft-delete column on a table that must never be deleted is an invitation".
 */
export type Loeschart =
  /** S4: `geloescht_am` / `geloescht_von`. The row is gone from the domain but
   *  kept for reconstruction. Finders exclude it by default. */
  | 'soft'
  /** The row stays and its *state* changes — `archiviert_am`, `storniert_am`.
   *  Nothing is "deleted", so no `geloescht_am` column exists to invite it. */
  | 'archiv'
  /** Append-only. Nothing ever ends a row here; there is no liveness column
   *  at all and no path that writes one. */
  | 'append';

export interface Loeschsperre {
  readonly tabelle: string;
  readonly art: Loeschart;
  /** Why this table may never be hard-deleted. A legal or domain reason, not
   *  "for safety" — the reason is what a reviewer checks. */
  readonly grund: string;
}

/**
 * Tables carrying `kern.verhindere_loeschung()` and holding no `DELETE` grant.
 *
 * Only tables that exist today are listed. The finance and time domains
 * (`finanz.ts`, `zeit.ts`), `freigabe*`, `wachbuch_eintrag`,
 * `schluessel_quittung`, `da_kenntnisnahme` and the finance document
 * categories join this list as their PRs land — §6.2 names them, and each
 * arrives with its table rather than being reserved here against a table that
 * does not exist.
 */
export const KEIN_HARD_DELETE: readonly Loeschsperre[] = [
  {
    tabelle: 'audit_log',
    art: 'append',
    grund:
      'SEC-A9. An audit trail with a delete path is not an audit trail. No liveness '
      + 'column either: a redacted or archived audit row is still a row somebody chose '
      + 'to stop showing.',
  },
  {
    tabelle: 'mandant',
    art: 'archiv',
    grund:
      'LEG-01. A mandant owns financial records under a ten-year retention, and its id '
      + 'is the tenant key every one of those records carries. `archiviert_am` ends its '
      + 'operational life; the row stays for as long as its data does.',
  },
  {
    tabelle: 'person',
    art: 'soft',
    grund:
      'LEG-02, D-09. The human behind every time record. Art. 17 DSGVO erasure '
      + 'anonymises this row where a statutory retention duty stands against removal '
      + '(§6.3) — it never deletes it, because the costed records point here.',
  },
  {
    tabelle: 'anstellung',
    art: 'soft',
    grund:
      'LEG-01, LEG-02. Everything costed hangs off `anstellung_id` (D-09). Deleting an '
      + 'employment orphans the wage evidence a MiLoG or ArbZG dispute is settled with.',
  },
] as const;

/**
 * Tables whose every write is mirrored into `audit_log` by
 * `kern.protokolliere_aenderung()`.
 *
 * `audit_log` is deliberately absent: a table that audits itself recurses, and
 * there is no write path to it other than `app.protokolliere` anyway.
 */
export const AUDITIERT: readonly string[] = ['mandant', 'person', 'anstellung'] as const;

/** Tables carrying S4 (`geloescht_am` / `geloescht_von`) — the finders' domain. */
export const SOFT_DELETE: readonly string[] = KEIN_HARD_DELETE.filter(
  (l) => l.art === 'soft',
).map((l) => l.tabelle);

/** Tables carrying S2 (`geaendert_am`, maintained by `kern.setze_geaendert_am()`). */
export const GEAENDERT_AM: readonly string[] = ['mandant', 'person', 'anstellung'] as const;
