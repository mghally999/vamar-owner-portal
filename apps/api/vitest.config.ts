import { defineConfig } from 'vitest/config';
import AllTestFilesRan from '../../tooling/ci/vitest-all-files-ran';

// API tests run the Hono app in Node against an in-process Postgres (PGlite) so the full
// integration suite, including owner isolation, needs no external services.
export default defineConfig({
  test: {
    // Fails the run when a selected test file never ran (tooling/ci/vitest-all-files-ran.ts).
    reporters: ['default', new AllTestFilesRan()],
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // Each file builds a fresh PGlite database with the seed; slow machines need more than 60 s.
    hookTimeout: 180_000,
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The Node dev server is local tooling, not part of the Worker.
      exclude: ['src/dev-server.ts'],
      // Floors measured on 23 Oct 2026; raised as tests are added, never lowered.
      thresholds: { lines: 86, functions: 88, statements: 81, branches: 67 },
    },
  },
});
