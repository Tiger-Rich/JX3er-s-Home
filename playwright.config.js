import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/e2e.spec.js',
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  webServer: [
    {
      command: 'npm run api',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
