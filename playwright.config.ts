import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * The pre-installed Chromium is used where it exists, rather than downloading
 * a second copy: this environment ships one at /opt/pw-browsers/chromium and a
 * pinned @playwright/test may want a different build number.
 */
const VORHANDEN = '/opt/pw-browsers/chromium';
const chromium = existsSync(VORHANDEN) ? { executablePath: VORHANDEN } : {};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] !== undefined ? 2 : 0,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...chromium,
          // The container runs as root; Chromium's sandbox needs user
          // namespaces that are not available here.
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000/healthz',
    env: {
      // The suite must axe-test the real production build, not a development
      // render with its overlays — so the dev surfaces are switched on for this
      // one build. Nothing else sets the flag, so a deployment ships a 404.
      CSE_DEV_FLAECHEN: '1',
      /**
       * The public pages read their content from `seite`/`abschnitt` (PUB-07),
       * so the suite needs a real database — the same throwaway Postgres the
       * isolation suite uses, seeded and content-imported first.
       *
       * A fixture page with hard-coded copy would need none of this, and that
       * was the problem: it could keep every promise while the delivered page
       * broke them.
       */
      DATABASE_URL:
        process.env['DATABASE_URL']
        ?? process.env['TEST_DATABASE_URL']
        ?? 'postgres://postgres@localhost:55432/cse_test',
      // O-08 is open, so the canonical host is the request host. Pinning it
      // here keeps `sitemap.xml` and every JSON-LD `@id` assertable.
      CSE_KANONISCHE_BASIS: 'http://localhost:3000',
    },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
