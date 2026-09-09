import { defineConfig } from 'vitest/config';

/**
 * The isolation suite talks to a REAL Postgres and seeds it, so the files run
 * one at a time. Parallel files would truncate each other's fixtures and the
 * failures would look like RLS defects, which is the worst possible false
 * signal for this particular suite.
 */
export default defineConfig({
  test: {
    include: ['tests/isolation/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 60_000,
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
  },
});
