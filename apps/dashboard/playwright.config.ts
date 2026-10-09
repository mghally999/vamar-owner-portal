import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
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
