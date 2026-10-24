import { defineConfig, devices } from '@playwright/test';

/**
 * Checks against the deployed staging Worker, before anyone signs in: the dashboard sign-in page
 * in both themes and languages (with axe), health and readiness, API headers and refusals, missing
 * bundles and the download page. The tests skip with a message when STAGING_URL is not set.
 *   STAGING_URL=https://vamar-owner-portal-staging.vamar-api.workers.dev pnpm e2e:staging
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'staging.spec.ts',
  timeout: 60_000,
  retries: 1,
  reporter: [['list']],
  use: {
    ...(process.env['STAGING_URL'] ? { baseURL: process.env['STAGING_URL'] } : {}),
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1440, height: 900 },
        browserName: 'chromium',
        channel: process.env['PW_CHANNEL'] ?? 'msedge',
      },
    },
    {
      name: 'phone',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        channel: process.env['PW_CHANNEL'] ?? 'msedge',
      },
    },
  ],
});
