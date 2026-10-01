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
    // Сервис-воркер PWA перехватывает запросы, и page.route() их не видит —
    // для e2e с подменой API воркеры блокируем (сам /sw.js проверяет pwa.spec).
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Регистрация и онбординг требуют живого API (ТЗ §7, Фаза 1.1).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          // Telegram-бот включён для e2e (ТЗ §3.6): реальных запросов к
          // Telegram нет — тест шлёт вебхук сам, режим webhook.
          command:
            'export TELEGRAM_BOT_TOKEN=e2e-telegram-token TELEGRAM_WEBHOOK_SECRET=e2e-telegram-secret TELEGRAM_MODE=webhook TELEGRAM_API_FAKE=1; pnpm --filter @puls/api build && pnpm --filter @puls/api start',
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
