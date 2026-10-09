import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  retries: 0,
  // One worker: the TOTP secret enrolled by the first login is shared through process.env.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env['DASHBOARD_URL'] ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    locale: 'ar-AE',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env['PW_CHANNEL'] ?? 'msedge' },
    },
  ],
});
