import { defineConfig } from 'vitest/config';
import AllTestFilesRan from '../../tooling/ci/vitest-all-files-ran';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Fails the run when a selected test file never ran (tooling/ci/vitest-all-files-ran.ts).
    reporters: ['default', new AllTestFilesRan()],
  },
});
