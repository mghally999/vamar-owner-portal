import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import AllTestFilesRan from '../../tooling/ci/vitest-all-files-ran';

/** Small packages the shell and most pages use; they share one cached `vendor` chunk. */
const SHELL_PACKAGES = new Set([
  'lucide-react',
  'radix-ui',
  'zod',
  'react-hook-form',
  '@hookform/resolvers',
  // Used by the shell's buttons (asChild); the rest of Radix loads with the dialogs that need it.
  '@radix-ui/react-slot',
  '@radix-ui/react-compose-refs',
]);

/**
 * App modules the shell loads at start and every page shares; kept together in `index-core`.
 * Page modules are left out: they load with their routes.
 */
const CORE_SOURCES = [
  /\/apps\/dashboard\/src\/lib\/(messages|i18n|api|auth|theme|hooks|firebase)\.tsx?$/,
  /\/apps\/dashboard\/src\/ui\/(primitives|shell|logo|search-shortcut)\.tsx?$/,
  /\/apps\/dashboard\/src\/v2\/index\.tsx?$/,
  /\/packages\/shared\/src\/(dates|money)\.ts$/,
];

/** The chunk a module belongs to, or null to leave it with the route chunk that imports it. */
function chunkName(id: string): string | null {
  const path = id.replaceAll('\\', '/');
  if (CORE_SOURCES.some((re) => re.test(path))) return 'index-core';
  const m = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(path);
  const pkg = m?.[1];
  if (!pkg) return null;
  if (pkg === 'xlsx') return 'xlsx';
  if (pkg === 'firebase' || pkg.startsWith('@firebase/')) return 'firebase';
  if (pkg.startsWith('@tanstack/')) return 'tanstack';
  if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react';
  if (pkg.startsWith('@fullcalendar/') || pkg === 'preact') return 'fullcalendar';
  if (pkg === 'react-day-picker' || pkg === 'date-fns' || pkg.startsWith('@date-fns/'))
    return 'datepicker';
  if (SHELL_PACKAGES.has(pkg)) return 'vendor';
  return null;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // During dashboard work the API runs in wrangler dev on 8787; cookies stay same-site through the proxy.
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  test: {
    // Fails the run when a selected test file never ran (tooling/ci/vitest-all-files-ran.ts).
    reporters: ['default', new AllTestFilesRan()],
    // Unit tests only; the Playwright suite in e2e/ runs through `pnpm e2e`.
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    // Each jsdom worker takes a few hundred MB: on the 8 GB dev laptop more than two workers swap
    // and lazy pages miss their waits. CI runners (16 GB, four cores) use four.
    maxWorkers: process.env['CI'] ? 4 : 2,
    coverage: {
      provider: 'v8',
      // The whole app source: every page, lib and ui module. Left out are the tests, the type-only
      // modules and the createRoot bootstrap in main.tsx.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/vite-env.d.ts', 'src/lib/types.ts', 'src/main.tsx'],
      // Floors measured over all of src on 25 Oct 2026; raised as tests are added, never lowered.
      thresholds: { lines: 96, functions: 93, statements: 95, branches: 89 },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Chunks are named on purpose so the bundle budget (tooling/ci/bundle-budget.mjs) measures
        // what each one is:
        // - the libraries every page needs (React, TanStack, Firebase) and the shell's small ones
        //   (`vendor`), matched on the package name: matching "react" anywhere in the path used to
        //   pull react-day-picker, @fullcalendar/react and react-hook-form into the React chunk;
        // - the app core every page shares (messages, primitives, i18n, the API client) as
        //   `index-core`, so it counts in the initial download instead of getting an arbitrary name;
        // - the date-picker and calendar libraries in their own lazy chunks, downloaded only by the
        //   pages that use them; every other package stays with the lazy route chunk importing it.
        // `includeDependenciesRecursively: false` keeps each group to its own modules: by default
        // Rolldown pulls a group's dependencies (React, for react-day-picker) into that group, and
        // the startup chunks then had to load the date picker and the calendar.
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [{ name: chunkName }],
        },
      },
    },
  },
});
