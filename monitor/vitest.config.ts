import { defineConfig } from 'vitest/config';
import AllTestFilesRan from '../tooling/ci/vitest-all-files-ran';

export default defineConfig({
  test: {
    reporters: ['default', new AllTestFilesRan()],
    include: ['test/**/*.test.ts'],
  },
});
