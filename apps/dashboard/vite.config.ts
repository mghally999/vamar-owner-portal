import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import AllTestFilesRan from '../../tooling/ci/vitest-all-files-ran';

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
    rollupOptions: {
      output: {
        // Keep the vendor chunk small and stable; route chunks are split by React.lazy.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('xlsx')) return 'xlsx';
          if (id.includes('firebase')) return 'firebase';
          if (id.includes('@tanstack')) return 'tanstack';
          if (id.includes('react')) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
