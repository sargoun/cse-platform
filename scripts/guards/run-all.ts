/**
 * The merge-safety guards of PR 0.
 *
 * Each one refuses a change that would otherwise pass review and fail
 * silently in production. They run in `pnpm lint`, so a branch that breaks one
 * cannot merge.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const WURZEL = process.cwd();

interface Befund {
  readonly wache: string;
  readonly datei: string;
  readonly zeile: number;
  readonly text: string;
}

function dateien(verzeichnis: string, endungen: readonly string[]): string[] {
  const treffer: string[] = [];
  const gehe = (pfad: string): void => {
    let eintraege: string[];
    try {
      eintraege = readdirSync(pfad);
    } catch {
      return;
    }
    for (const e of eintraege) {
      if (e === 'node_modules' || e === '.next' || e === '.git' || e === 'coverage') continue;
      const voll = join(pfad, e);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (endungen.some((x) => e.endsWith(x))) treffer.push(voll);
    }
  };
  gehe(join(WURZEL, verzeichnis));
  return treffer;
}

const befunde: Befund[] = [];
const melde = (wache: string, datei: string, zeile: number, text: string): void => {
  befunde.push({ wache, datei: relative(WURZEL, datei), zeile, text: text.trim().slice(0, 160) });
};

/**
 * Guard 1 — money is never `numeric` or a float column (invariant 1, K-16).
 * A `numeric` money column is the schema-level twin of a float cent.
 */
function wacheGeldSpalte(): void {
  const GELD = /(betrag|preis|summe|saldo|entgelt|kosten|wert|satz|honorar|einbehalt)/iu;
  for (const datei of [...dateien('src/server/db', ['.ts']), ...dateien('drizzle', ['.sql'])]) {
    readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        if (!GELD.test(zeile)) return;
        if (/\b(numeric|decimal|real|double precision|float)\b/iu.test(zeile)) {
          melde('geld-nie-numeric', datei, i + 1, zeile);
        }
      });
  }
}

/**
 * Guard 2 — every timestamp carries a time zone (invariant 2).
 * `timestamp without time zone` silently drops the offset, and every DST
 * calculation downstream is then wrong by an hour twice a year.
 */
function wacheZeitstempel(): void {
  for (const datei of [...dateien('src/server/db', ['.ts']), ...dateien('drizzle', ['.sql'])]) {
    readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        if (/timestamp\s+without\s+time\s+zone/iu.test(zeile)) {
          melde('zeit-immer-tz', datei, i + 1, zeile);
        }
        if (/\btimestamp\s*\(/iu.test(zeile) && !/withTimezone|with\s+time\s+zone/iu.test(zeile)) {
          melde('zeit-immer-tz', datei, i + 1, zeile);
        }
      });
  }
}

/**
 * Guard 3 — a route handler never touches the database directly.
 * CLAUDE.md: authorize → call a service → return. A handler holding a query
 * is a handler that can be given one without a tenant predicate.
 */
function wacheRouteOhneDb(): void {
  for (const datei of dateien('src/app', ['.ts', '.tsx'])) {
    if (!/route\.tsx?$/u.test(datei)) continue;
    readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        if (/\bdb\s*\./u.test(zeile) || /\bdrizzle\b/u.test(zeile) || /\bsql`/u.test(zeile)) {
          melde('route-ohne-db', datei, i + 1, zeile);
        }
      });
  }
}

/**
 * Guard 4 — every `TODO(client)` carries an O-number that DECISIONS.md holds.
 * This is what makes the open register real rather than aspirational: a
 * question raised in code and not written down is a question nobody answers.
 */
function wacheTodoClient(): void {
  const register = readFileSync(join(WURZEL, 'docs/DECISIONS.md'), 'utf8');
  const bekannt = new Set(
    [...register.matchAll(/^\|\s*(O-\d{1,3})\s*\|/gmu)].map((m) => m[1] ?? ''),
  );
  const zuPruefen = [
    ...dateien('src', ['.ts', '.tsx']),
    ...dateien('scripts', ['.ts']),
    // Migrations too. `0001` and `0002` each raise a real client question in a
    // SQL comment, and a question the guard cannot see is a question that can
    // fall out of the register without anything noticing.
    ...dateien('drizzle', ['.sql']),
  ].filter(
    // The scanner is not scanned: this file names the marker in order to look
    // for it, and a guard that trips over its own documentation is a guard
    // people disable.
    (d) => !d.includes(join('scripts', 'guards')),
  );
  for (const datei of zuPruefen) {
    readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        if (!/TODO\(client\)/u.test(zeile)) return;
        const nummer = /\b(O-\d{1,3})\b/u.exec(zeile)?.[1];
        if (nummer === undefined) {
          melde('todo-client-ohne-nummer', datei, i + 1, zeile);
        } else if (!bekannt.has(nummer)) {
          melde('todo-client-nicht-im-register', datei, i + 1, zeile);
        }
      });
  }
}

/** Guard 5 — the database region is pinned, and a test can read it (D-04). */
function wacheEuRegion(): void {
  const pfad = join(WURZEL, 'supabase/config.toml');
  const inhalt = readFileSync(pfad, 'utf8');
  if (!/eu-central-1/u.test(inhalt)) {
    melde('eu-region', pfad, 1, 'supabase/config.toml nennt keine EU-Region (D-04)');
  }
}

wacheGeldSpalte();
wacheZeitstempel();
wacheRouteOhneDb();
wacheTodoClient();
wacheEuRegion();

if (befunde.length > 0) {
  console.error(`\n${befunde.length} Verstoß/Verstöße gegen die Merge-Wachen:\n`);
  for (const b of befunde) {
    console.error(`  [${b.wache}] ${b.datei}:${b.zeile}\n      ${b.text}`);
  }
  console.error('');
  process.exit(1);
}
console.log('Merge-Wachen: alle sauber.');
