/**
 * Component tests (React Native Testing Library on jest-expo). Pure logic stays on Vitest
 * (`*.test.ts`); screens, UI components and the modules behind them are `*.test.tsx` and run here.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.tsx'],
  // Native modules, the router and the network replaced for every test (src/test/setup.ts).
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
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
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'app/**/*.tsx',
    '!**/*.test.{ts,tsx}',
    '!**/__tests__/**',
    '!src/test/**',
    // Type declarations only, nothing runs.
    '!src/types/**',
    '!src/lib/types.ts',
    // Web variants run only in the browser build (react-native-web), never on the phone or here.
    '!**/*.web.{ts,tsx}',
  ],
  // Floors measured on 23 Oct 2026; raised as tests are added, never lowered.
  coverageThreshold: { global: { lines: 53, statements: 51, branches: 48, functions: 53 } },
};
