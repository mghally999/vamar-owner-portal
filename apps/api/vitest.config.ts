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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The Node dev server is local tooling, not part of the Worker.
      exclude: ['src/dev-server.ts'],
      // Floors measured on 22 Oct 2026; raised as tests are added, never lowered.
      thresholds: { lines: 84, functions: 84, statements: 78, branches: 63 },
    },
  },
});
