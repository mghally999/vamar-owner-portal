import { defineConfig, devices } from '@playwright/test';

/**
 * The owner web app (PWA) at /app on a deployed environment, on an iPhone-sized screen. No
 * emulator or database: it checks what an owner sees before signing in.
 *   PWA_URL=https://vamar-owner-portal-staging.vamar-api.workers.dev pnpm e2e:pwa
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'pwa.spec.ts',
  timeout: 60_000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env['PWA_URL'] ?? 'https://vamar-owner-portal-staging.vamar-api.workers.dev',
    locale: 'ar-AE',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'iphone',
      use: {
        ...devices['iPhone 13'],
        // Chromium with the iPhone viewport, touch and user agent (WebKit is not installed in CI).
        browserName: 'chromium',
        channel: process.env['PW_CHANNEL'] ?? 'msedge',
      },
    },
  ],
});
