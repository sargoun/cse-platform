/** VORÜBERGEHEND (Agent bau): Isolationslauf gegen die eigene Datenbank, ohne globalSetup. */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/isolation/bau-abnahme.test.ts', 'tests/isolation/bau-lv-import.test.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
  },
});
