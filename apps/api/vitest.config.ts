import { defineConfig } from 'vitest/config';

// API tests run the Hono app in Node against an in-process Postgres (PGlite) so the full
// integration suite, including owner isolation, needs no external services.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
