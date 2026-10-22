import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/schemas/index.ts'],
      // Floors measured on 22 Oct 2026; raised as tests are added, never lowered.
      thresholds: { lines: 96, functions: 94, statements: 96, branches: 94 },
    },
  },
});
