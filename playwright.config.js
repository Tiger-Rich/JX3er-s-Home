import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

const e2eDirectory = join(process.cwd(), '.superpowers', 'playwright');
const e2eDatabasePath = join(e2eDirectory, `fanshu-e2e-${Date.now()}.db`);
const e2eApiPort = 8787;
const e2eWebPort = 5173;

mkdirSync(e2eDirectory, { recursive: true });

function webServerEnv(overrides = {}) {
  const env = { ...process.env, NODE_NO_WARNINGS: '1', ...overrides };
  delete env.FORCE_COLOR;
  return env;
}

export default defineConfig({
  testDir: './tests',
  testMatch: '**/e2e.spec.js',
  use: {
    baseURL: `http://127.0.0.1:${e2eWebPort}`,
  },
  webServer: [
    {
      command: 'npm run api',
      env: webServerEnv({
        FANSHU_DB_FILENAME: e2eDatabasePath,
        FANSHU_DB_RESET: '1',
        FANSHU_HOST: '127.0.0.1',
        FANSHU_PORT: String(e2eApiPort),
      }),
      url: `http://127.0.0.1:${e2eApiPort}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev',
      env: webServerEnv({
        FANSHU_API_ORIGIN: `http://127.0.0.1:${e2eApiPort}`,
      }),
      url: `http://127.0.0.1:${e2eWebPort}`,
      reuseExistingServer: false,
    },
  ],
});
