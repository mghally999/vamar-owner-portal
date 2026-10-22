import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

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
    // Unit tests only; the Playwright suite in e2e/ runs through `pnpm e2e`.
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      // Unit-tested modules; pages and flows are covered end to end by the Playwright suite.
      include: [
        'src/lib/batch.ts',
        'src/lib/theme.ts',
        'src/ui/cheque-grid.tsx',
        'src/ui/primitives.tsx',
      ],
      // Floors measured on 23 Oct 2026; raised as tests are added, never lowered.
      thresholds: { lines: 56, functions: 40, statements: 57, branches: 53 },
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
