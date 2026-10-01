// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const apiURL = process.env.E2E_API_URL ?? 'http://localhost:3001';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    locale: 'ru-RU',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Регистрация и онбординг требуют живого API (ТЗ §7, Фаза 1.1).
  webServer:
    process.env.E2E_BASE_URL
      ? undefined
      : [
          {
            command: 'pnpm --filter @puls/api build && pnpm --filter @puls/api start',
            url: `${apiURL}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
          },
          {
            command: 'pnpm start',
            url: baseURL,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ],
});
