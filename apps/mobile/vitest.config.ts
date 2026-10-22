import { defineConfig } from 'vitest/config';

// Pure logic only; React Native components are tested with jest-expo (jest.config.js).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
