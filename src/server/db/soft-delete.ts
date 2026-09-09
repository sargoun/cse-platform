/**
 * S4 finders — a soft-deleted row is invisible by default (K-16, invariant 8).
 *
 * The failure this prevents is quiet: `geloescht_am` is set, every list keeps
 * showing the row because one query forgot the predicate, and the platform
 * reports a headcount that includes people who left. So the predicate is not
 * something each query remembers — it is what these helpers produce, and
 * seeing every row takes saying so.
 *
 * Only tables registered in `schema/rls.ts` as `art: 'soft'` are accepted. A
 * table that carries no `geloescht_am` cannot be filtered on one, and the
 * error says so at the call site rather than in a Postgres message about an
 * unknown column.
 */
import { KEIN_HARD_DELETE, SOFT_DELETE } from './schema/rls.js';

export type Sichtbarkeit =
  /** The default. Rows whose life has not ended. */
  | 'aktiv'
  /** Deleted rows only — a restore screen, or an audit of what was removed. */
  | 'nur_geloescht'
  /** Everything. Never a default, and never reached by omitting an argument. */
  | 'alle';

export class SoftDeleteFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'SoftDeleteFehler';
  }
}

/** `alias` is pasted into SQL, so it is an identifier or it is refused. */
const ALIAS = /^[a-z_][a-z0-9_]{0,62}$/u;

function pruefe(tabelle: string, alias: string): string {
  if (!SOFT_DELETE.includes(tabelle)) {
    const bekannt = KEIN_HARD_DELETE.find((l) => l.tabelle === tabelle);
    throw new SoftDeleteFehler(
      bekannt === undefined
        ? `\`${tabelle}\` steht nicht in KEIN_HARD_DELETE (src/server/db/schema/rls.ts).`
        : `\`${tabelle}\` ist als \`${bekannt.art}\` registriert und hat kein geloescht_am. `
          + 'K-16: eine Soft-Delete-Spalte auf einer unlöschbaren Tabelle ist eine Einladung.',
    );
  }
  if (alias !== '' && !ALIAS.test(alias)) {
    throw new SoftDeleteFehler(`\`${alias}\` ist kein gültiger SQL-Alias.`);
  }
  return alias === '' ? '' : `${alias}.`;
}

/**
 * The `WHERE` fragment for one visibility.
 *
 * `sicht` defaults to `'aktiv'`: a caller who says nothing gets the safe
 * answer, and `'alle'` has to be typed out.
 */
export function loeschPraedikat(
  tabelle: string,
  sicht: Sichtbarkeit = 'aktiv',
  alias = '',
): string {
  const q = pruefe(tabelle, alias);
  switch (sicht) {
    case 'aktiv':
      return `${q}geloescht_am is null`;
    case 'nur_geloescht':
      return `${q}geloescht_am is not null`;
    case 'alle':
      return 'true';
  }
}

/**
 * A `SELECT` over a soft-deleted table, with the predicate already in it.
 *
 * `spalten` and `zusatz` are SQL the caller writes; values belong in bound
 * parameters, which is why this returns a statement and takes none.
 */
export function baueSelect(
  tabelle: string,
  spalten = '*',
  optionen: { readonly sicht?: Sichtbarkeit; readonly alias?: string; readonly zusatz?: string } = {},
): string {
  const alias = optionen.alias ?? '';
  const praedikat = loeschPraedikat(tabelle, optionen.sicht ?? 'aktiv', alias);
  const von = alias === '' ? tabelle : `${tabelle} ${alias}`;
  const zusatz = optionen.zusatz === undefined ? '' : ` and (${optionen.zusatz})`;
  return `select ${spalten} from ${von} where ${praedikat}${zusatz}`;
}

/**
 * The one statement that ends a row's life.
 *
 * `geloescht_von` comes from the session, never from the caller: the actor is
 * a fact the server knows and the client asserts. Re-deleting an already
 * deleted row is a no-op rather than an overwrite — the first deletion is the
 * one that happened.
 */
export function baueSoftDelete(tabelle: string): string {
  pruefe(tabelle, '');
  return `update ${tabelle}
             set geloescht_am = now(),
                 geloescht_von = app.aktueller_benutzer()
           where id = $1 and geloescht_am is null
       returning id`;
}
