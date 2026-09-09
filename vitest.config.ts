import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
    include: ['tests/**/*.test.ts'],
    // The isolation suite needs a live Postgres and its own sequential
    // runner — `pnpm test:isolation`, vitest.isolation.config.ts.
    exclude: ['tests/e2e/**', 'tests/fixtures/**', 'tests/isolation/**', 'node_modules/**'],
    environment: 'node',
    // The reference cases are Berlin wall-clock. Pinning the runner's zone to
    // UTC is deliberate: a test that only passes because the CI box happens to
    // sit in Europe/Berlin proves nothing about the conversion.
    env: { TZ: 'UTC' },
    // The invariant tests spawn a real `tsc` and a real `eslint` — they assert
    // that the compiler and the lint rules refuse a fixture, which cannot be
    // faked. That is seconds per case, so the default five is too short.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    poolOptions: { forks: { singleFork: false, maxForks: 4 } },
  },
});
