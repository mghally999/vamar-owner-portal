/**
 * Component tests (React Native Testing Library on jest-expo). Pure logic stays on Vitest
 * (`*.test.ts`); screens and UI components are `*.test.tsx` and run here.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.tsx'],
  // The first render loads React Native and Expo modules: slow on a cold or busy machine.
  testTimeout: 30_000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // The hoisted root react belongs to the dashboard; the app and the renderer must share one.
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    // Workspace packages are ESM TypeScript with `.js` import suffixes.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: ['src/ui/**/*.tsx'],
  // Floors measured on 23 Oct 2026; raised as tests are added, never lowered.
  coverageThreshold: { global: { lines: 48, statements: 47, branches: 44, functions: 46 } },
};
