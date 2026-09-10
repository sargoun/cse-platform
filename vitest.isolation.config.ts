import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The isolation suite talks to a REAL Postgres and seeds it, so the files run
 * one at a time. Parallel files would truncate each other's fixtures and the
 * failures would look like RLS defects, which is the worst possible false
 * signal for this particular suite.
 */
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
    poolOptions: { forks: { singleFork: true } },
  },
});
