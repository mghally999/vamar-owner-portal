import './scripts/load-env.js';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://vamar:vamar@localhost:5432/vamar',
  },
  strict: true,
  verbose: true,
});
