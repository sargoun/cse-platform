import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/*.ts',
  out: './drizzle',
  // Migrations live in the repository and are applied by the migrator role,
  // never edited in a dashboard (CLAUDE.md, stack constraints).
  migrations: { table: '__drizzle_migrations', schema: 'public' },
  strict: true,
  verbose: true,
});
