import { defineConfig } from 'vitest/config';
import AllTestFilesRan from '../../tooling/ci/vitest-all-files-ran';

// Pure logic only; React Native components are tested with jest-expo (jest.config.js).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Fails the run when a selected test file never ran (tooling/ci/vitest-all-files-ran.ts).
    reporters: ['default', new AllTestFilesRan()],
  },
});
