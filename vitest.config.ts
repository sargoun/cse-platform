import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'tests/fixtures/**', 'node_modules/**'],
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
