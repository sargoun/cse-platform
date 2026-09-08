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
  /** The row stays and its *state* changes — `archiviert_am`, `storniert_am`,
   *  `geschlossen_am`. Nothing is "deleted", so no `geloescht_am` column
   *  exists to invite it. */
  | 'archiv'
  /** Append-only. Nothing ever ends a row here; there is no liveness column
   *  at all and no path that writes one. */
  | 'append';

export interface TabelleJeMigration {
  readonly tabelle: string;
  readonly migration: string;
}

export interface Loeschsperre {
  readonly tabelle: string;
  readonly art: Loeschart;
  /**
   * The migration that creates the table, and therefore the one that must
   * carry its locks. A trigger cannot be created before its table exists, so
   * the generator emits one block per migration rather than one block for
   * everything — which is what a single block would silently get wrong the
   * first time a table arrived later than `0005`.
   */
  readonly migration: string;
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
    migration: '0005',
    grund:
      'SEC-A9. An audit trail with a delete path is not an audit trail. No liveness '
      + 'column either: a redacted or archived audit row is still a row somebody chose '
      + 'to stop showing.',
  },
  {
    tabelle: 'mandant',
    art: 'archiv',
    migration: '0005',
    grund:
      'LEG-01. A mandant owns financial records under a ten-year retention, and its id '
      + 'is the tenant key every one of those records carries. `archiviert_am` ends its '
      + 'operational life; the row stays for as long as its data does.',
  },
  {
    tabelle: 'nummernkreis',
    art: 'archiv',
    migration: '0006',
    grund:
      'FIN-03, LEG-01. Die Zählerzeile IST der Beweis der Lückenlosigkeit: sie zu '
      + 'löschen und neu anzulegen setzt den Zähler zurück und erzeugt zweimal '
      + 'dieselbe Rechnungsnummer. `geschlossen_am` beendet die Vergabe; die Zeile '
      + 'bleibt, solange die Nummern gelten, die sie ausgegeben hat.',
  },
  {
    tabelle: 'rolle',
    art: 'archiv',
    migration: '0007',
    grund:
      'AUT-03, SEC-A9. Die Historie in `benutzer_mandant` verweist auf die Rolle, unter '
      + 'der jemand gehandelt hat. Die Rolle zu löschen macht zehn Jahre Rechtevergabe '
      + 'unlesbar; `archiviert_am` beendet ihre Verwendung.',
  },
  {
    tabelle: 'benutzer',
    art: 'archiv',
    migration: '0007',
    grund:
      'SEC-A9, LEG-01. `audit_log` benennt dieses Konto als Akteur — dauerhaft. Ein '
      + 'gelöschter Benutzer macht jede Zeile, die er geschrieben hat, herrenlos. '
      + '`deaktiviert_am` beendet den Zugang.',
  },
  {
    tabelle: 'benutzer_mandant',
    art: 'archiv',
    migration: '0007',
    grund:
      'AUT-08, LEG-01. Wer wann in welchem Bereich welche Rolle hatte, ist die Antwort '
      + 'auf "wer durfte das". `entzogen_am` beendet den Zugang und behält die Antwort.',
  },
  {
    tabelle: 'benutzer_sitzung',
    art: 'archiv',
    migration: '0007',
    grund:
      'SEC-A9, AUT-08. Sitzungen sind Teil des Sicherheitsprotokolls: von welchem Gerät '
      + 'und welcher IP wann gearbeitet wurde. `beendet_am` beendet sie.',
  },
  {
    tabelle: 'person',
    art: 'soft',
    migration: '0005',
    grund:
      'LEG-02, D-09. The human behind every time record. Art. 17 DSGVO erasure '
      + 'anonymises this row where a statutory retention duty stands against removal '
      + '(§6.3) — it never deletes it, because the costed records point here.',
  },
  {
    tabelle: 'anstellung',
    art: 'soft',
    migration: '0005',
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
export const AUDITIERT: readonly TabelleJeMigration[] = [
  { tabelle: 'mandant', migration: '0005' },
  { tabelle: 'person', migration: '0005' },
  { tabelle: 'anstellung', migration: '0005' },
  { tabelle: 'nummernkreis', migration: '0006' },
] as const;

/** Tables carrying S4 (`geloescht_am` / `geloescht_von`) — the finders' domain. */
export const SOFT_DELETE: readonly string[] = KEIN_HARD_DELETE.filter(
  (l) => l.art === 'soft',
).map((l) => l.tabelle);

/** Tables carrying S2 (`geaendert_am`, maintained by `kern.setze_geaendert_am()`). */
export const GEAENDERT_AM: readonly TabelleJeMigration[] = [
  { tabelle: 'mandant', migration: '0005' },
  { tabelle: 'person', migration: '0005' },
  { tabelle: 'anstellung', migration: '0005' },
  // `nummernkreis` trägt zusätzlich fin.nummernkreis_pruefen() (0006), das
  // entscheidet, WAS sich ändern darf; dieser hier setzt nur, WANN.
  { tabelle: 'nummernkreis', migration: '0006' },
  { tabelle: 'rolle', migration: '0007' },
  { tabelle: 'benutzer', migration: '0007' },
  { tabelle: 'benutzer_mandant', migration: '0007' },
  // `benutzer_sitzung` führt `letzte_aktivitaet_am` selbst, in derselben
  // Anweisung, die die Sitzung validiert.
] as const;

/** Every migration that carries a generated block, in order. */
export const MIGRATIONEN: readonly string[] = [
  ...new Set([
    ...KEIN_HARD_DELETE.map((l) => l.migration),
    ...AUDITIERT.map((a) => a.migration),
    ...GEAENDERT_AM.map((g) => g.migration),
  ]),
].sort();
