import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Die Konformitaetspruefungen — eigene Konfiguration, eigener CI-Auftrag.
 *
 * Sie stehen NICHT in `pnpm test`, weil sie ein Java-Werkzeug und zwei
 * heruntergeladene Dateien brauchen; ein Entwicklungsrechner ohne beides
 * saehe sonst bei jedem Lauf einen roten Test, der nichts ueber seine
 * Aenderung aussagt. In CI laufen sie als eigener Auftrag
 * (`.github/workflows/compliance.yml`), und dort ist ein fehlender Pruefer
 * ein Fehlschlag.
 */
export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/compliance/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'UTC' },
    testTimeout: 300_000,
  },
});
