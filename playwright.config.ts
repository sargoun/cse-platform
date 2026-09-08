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
    // The suite must axe-test the real production build, not a development
    // render with its overlays — so the dev surfaces are switched on for this
    // one build. Nothing else sets the flag, so a deployment ships a 404.
    env: { CSE_DEV_FLAECHEN: '1' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
