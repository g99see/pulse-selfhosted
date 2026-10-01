// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E внешнего входа (ТЗ §3.1, §7). Без ключей владельца кнопки Google/Telegram
// скрыты, эндпоинты отвечают 404 provider_disabled, а обычный вход по паролю
// работает как раньше. Раздел «Способы входа» в настройках показывает пароль.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

interface SentMail {
  to: string;
  subject: string;
  text: string;
  link?: string;
  kind?: string;
}

async function verificationTokenFor(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.get(`${API_URL}/api/auth/dev/outbox`);
  expect(response.ok()).toBeTruthy();

  const body = (await response.json()) as { messages: SentMail[] };
  const letter = [...body.messages]
    .reverse()
    .find((message) => message.to === email && message.kind === 'email-verification');

  expect(letter, `письмо для ${email} должно быть в outbox`).toBeTruthy();
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(
    letter?.link ?? letter?.text ?? '',
  )?.[1];
  expect(token, 'в письме должна быть ссылка с токеном').toBeTruthy();
  return token as string;
}

test('без ключей провайдеры выключены, пароль остаётся рабочим способом входа', async ({
  page,
  request,
}) => {
  // 1. Список провайдеров: всё выключено.
  const providers = await request.get(`${API_URL}/api/auth/providers`);
  expect(providers.ok()).toBeTruthy();
  expect(await providers.json()).toEqual({
    google: false,
    telegram: false,
    telegramBotUsername: null,
  });

  // 2. Выключенный эндпоинт отвечает 404 provider_disabled.
  const google = await request.get(`${API_URL}/api/auth/google/start`, { maxRedirects: 0 });
  expect(google.status()).toBe(404);
  expect(((await google.json()) as { code: string }).code).toBe('provider_disabled');

  // 3. На /login и /register кнопок провайдеров нет.
  await page.goto('/login');
  await expect(page.getByTestId('provider-buttons')).toHaveCount(0);
  await expect(page.getByTestId('google-login')).toHaveCount(0);

  await page.goto('/register');
  await expect(page.getByTestId('provider-buttons')).toHaveCount(0);
  await expect(page.getByTestId('google-login')).toHaveCount(0);

  // 4. Обычный вход по паролю по-прежнему работает: регистрация и подтверждение.
  const unique = Date.now().toString().slice(-9);
  const email = `e2e-oauth-${unique}@example.com`;
  const nickname = `oauth${unique}`;

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByLabel('Никнейм').fill(nickname);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/verify-email/);

  const token = await verificationTokenFor(request, email);
  await page.goto(`/verify-email?token=${token}`);
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

  // 5. Раздел «Способы входа» в настройках: пароль, внешних привязок нет.
  await page.goto('/settings');
  await expect(page.getByTestId('linked-accounts')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('password-status')).toHaveText('Задан');
  await expect(page.getByTestId('identity-google')).toHaveCount(0);
  await expect(page.getByTestId('identity-telegram')).toHaveCount(0);
});
