import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] !== undefined ? 2 : 0,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000/healthz',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 180_000,
  },
});
