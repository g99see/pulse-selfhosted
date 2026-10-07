// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E уведомлений v2: в настройках две карточки (Telegram и Discord), журнал
// доставок, а браузер ни разу не запрашивает разрешение на уведомления.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

test('настройки уведомлений: Telegram и Discord без запроса разрешения браузера', async ({
  page,
  request,
}) => {
  // Любая попытка запросить разрешение должна упасть в тесте.
  await page.addInitScript(() => {
    (window as unknown as { __notifAsked: number }).__notifAsked = 0;
    const Fake = function () {} as unknown as { requestPermission: () => Promise<string> };
    Fake.requestPermission = async () => {
      (window as unknown as { __notifAsked: number }).__notifAsked += 1;
      return 'granted';
    };
    Object.defineProperty(window, 'Notification', { value: Fake, configurable: true });
  });

  const unique = Date.now().toString().slice(-9);
  const email = `notif-${unique}@example.com`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByLabel('Никнейм').fill(`nt${unique}`);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

  const outbox = await request.get(`${API_URL}/api/auth/dev/outbox`);
  const body = (await outbox.json()) as {
    messages: { to: string; kind?: string; link?: string; text: string }[];
  };
  const letter = [...body.messages]
    .reverse()
    .find((message) => message.to === email && message.kind === 'email-verification');
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(
    letter?.link ?? letter?.text ?? '',
  )?.[1];
  expect(token).toBeTruthy();
  await page.goto(`/verify-email?token=${token}`);
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  await page.goto('/settings');
  await expect(page.getByTestId('notification-settings')).toBeVisible();
  await expect(page.getByTestId('channel-telegram')).toBeVisible();
  await expect(page.getByTestId('channel-discord')).toBeVisible();
  await expect(page.getByTestId('delivery-log-empty')).toBeVisible();

  // Переключатель канала сохраняется на сервере.
  const toggle = page.getByTestId('telegram-enabled');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(page.getByTestId('telegram-enabled')).not.toBeChecked();

  expect(
    await page.evaluate(() => (window as unknown as { __notifAsked: number }).__notifAsked),
  ).toBe(0);
});
