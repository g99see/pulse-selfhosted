// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E внешнего входа (v3 §7.3). Telegram-вход и 2FA удалены: вход только логином
// и паролем. Без ключей владельца кнопка Google скрыта, вход через Telegram
// отвечает 404. Раздел «Способы входа» показывает пароль и (при наличии) Google.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

test('провайдеры: Telegram-входа нет, Google выключен без ключей, пароль остаётся', async ({
  page,
  request,
}) => {
  // 1. Список провайдеров: только Google, и он выключен без ключей владельца.
  const providers = await request.get(`${API_URL}/api/auth/providers`);
  expect(providers.ok()).toBeTruthy();
  expect(await providers.json()).toEqual({ google: false });

  // 2. Выключенный Google отвечает 404 provider_disabled.
  const google = await request.get(`${API_URL}/api/auth/google/start`, { maxRedirects: 0 });
  expect(google.status()).toBe(404);
  expect(((await google.json()) as { code: string }).code).toBe('provider_disabled');

  // 3. Входа через Telegram и 2FA больше нет.
  expect((await request.post(`${API_URL}/api/auth/telegram`, { data: { id: 1 } })).status()).toBe(
    404,
  );
  expect(
    (await request.post(`${API_URL}/api/auth/link/telegram`, { data: { id: 1 } })).status(),
  ).toBe(404);

  // 4. На /login и /register кнопок провайдеров нет.
  await page.goto('/login');
  await expect(page.getByTestId('provider-buttons')).toHaveCount(0);
  await expect(page.getByTestId('google-login')).toHaveCount(0);

  await page.goto('/register');
  await expect(page.getByTestId('provider-buttons')).toHaveCount(0);
  await expect(page.getByTestId('google-login')).toHaveCount(0);

  // 5. Регистрация логином и паролем по-прежнему работает: сразу сессия и онбординг.
  const unique = Date.now().toString().slice(-9);
  const nickname = `oauth${unique}`;

  await page.getByLabel('Никнейм').fill(nickname);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

  await expect(page.getByTestId('onboarding-step-1')).toBeVisible();
  await page.getByLabel('Валюта').selectOption('EUR');
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-2')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-3')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-4')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  // 6. Раздел «Способы входа»: пароль задан, внешних привязок нет.
  await page.goto('/settings');
  await expect(page.getByTestId('linked-accounts')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('password-status')).toHaveText('Задан');
  await expect(page.getByTestId('identity-google')).toHaveCount(0);
  await expect(page.getByTestId('identity-telegram')).toHaveCount(0);
});
