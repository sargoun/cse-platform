import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { anzahlWorker } from './tests/isolation/parallel.js';

/**
 * The isolation suite talks to a REAL Postgres and seeds it. Two files on ONE
 * database would truncate each other's fixtures and the failures would look
 * like RLS defects — the worst possible false signal for this suite. So files
 * do not share a database: every worker gets its own clone of the migrated
 * `cse_test` (`tests/isolation/global-setup.ts`, `harness.ts`), files inside a
 * worker still run one after another, and `seed()` still resets before each
 * file. Same tests, same rigour, four at a time instead of one (D-424).
 *
 * `CSE_ISOLATION_WORKER=1` gives the old serial run for debugging.
 */
const WORKER = anzahlWorker(process.env, availableParallelism());

export default defineConfig({
  /**
   * `server-only` wirft beim Import ausserhalb einer Server-Umgebung — das
   * ist sein Zweck. Vitest ist keine, also bekommt es hier einen leeren
   * Ersatz; sonst liesse sich kein Modul prüfen, das die Zusicherung trägt,
   * und die Zusicherung wegzulassen wäre der falsche Weg herum.
   */
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
      /**
       * Derselbe `@/`-Alias wie in `tsconfig.json`.
       *
       * Ohne ihn liess sich jedes Modul, das ihn benutzt, aus einem Test gar
       * nicht importieren — und die Antwort darauf war bisher, den Test um das
       * Modul herum zu schreiben. Das prueft dann eine Kopie der Abfrage statt
       * der Abfrage.
       */
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/isolation/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 60_000,
    
    fileParallelism: false,
    pool: 'forks',
    /*
     * **Nur noch die Obergrenze.** Vitest 4 kennt `minWorkers` nicht mehr;
     * geblieben ist `maxWorkers`, und das ist die Angabe, auf die es hier
     * ankommt: `global-setup.ts` legt GENAU so viele Datenbanken an, und
     * `harness.ts` wählt seine über `VITEST_POOL_ID`. Eine Obergrenze darüber
     * hinaus wäre ein Arbeiter ohne Datenbank. Startet der Läufer weniger
     * Arbeiter als erlaubt, bleibt höchstens ein Klon ungenutzt — das kostet
     * Zeit und keine Zusage.
     */
    maxWorkers: 1,
    /*
     * Eine Datei je Fork zur Zeit; `isolate` (Vorgabe) laedt jede Datei frisch.
     * Der serielle Fall steht in `fileParallelism` — das frühere
     * `poolOptions.forks.singleFork` sagte dasselbe ein zweites Mal und ist in
     * Vitest 4 weggefallen.
     */
  },
});
