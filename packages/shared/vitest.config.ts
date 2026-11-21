import { defineConfig } from 'vitest/config';
import AllTestFilesRan from '../../tooling/ci/vitest-all-files-ran';

export default defineConfig({
  test: {
    // Fails the run when a selected test file never ran (tooling/ci/vitest-all-files-ran.ts).
    reporters: ['default', new AllTestFilesRan()],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/schemas/index.ts'],
      // Floors raised on 21 Nov 2026 (measured 99.4 / 99.3 / 99.2 / 95.6); raised as tests are
      // added, never lowered.
      thresholds: { lines: 99, functions: 98, statements: 99, branches: 95 },
    },
  },
});
