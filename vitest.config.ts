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
    // The isolation suite needs a live Postgres and its own runner (four
    // workers, one database each — D-424): `pnpm test:isolation`,
    // vitest.isolation.config.ts. The
    // compliance suite needs Java and the downloaded KoSIT validator —
    // `pnpm test:compliance`, vitest.compliance.config.ts. Neither belongs in
    // the suite a developer runs on every save.
    exclude: [
      'tests/e2e/**', 'tests/fixtures/**', 'tests/isolation/**',
      'tests/compliance/**', 'node_modules/**',
    ],
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
    /*
     * **Vier Forks, ausdrücklich.** In Vitest 4 ist `poolOptions` weggefallen;
     * die Angaben stehen jetzt oben. Stehen geblieben wäre die alte Form nicht
     * etwa ein Fehler, sondern WIRKUNGSLOS — die Obergrenze fiele still auf die
     * Kernzahl der Maschine zurück, und ein Läufer, der 138 Dateien auf einem
     * kleinen CI-Rechner gleichzeitig startet, wird langsamer statt schneller.
     * `pool` steht mit dabei, weil die alte Form ihn über `forks` mitgesagt hat.
     */
    pool: 'forks',
    maxWorkers: 4,
  },
});
