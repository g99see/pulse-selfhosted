// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 1.1 (ТЗ §3.1): регистрация → подтверждение email → онбординг 4 шага
// → кабинет → выход → повторный вход.
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
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(letter?.link ?? letter?.text ?? '')?.[1];
  expect(token, 'в письме должна быть ссылка с токеном').toBeTruthy();
  return token as string;
}

test('регистрация → подтверждение → онбординг → кабинет, выход и повторный вход', async ({
  page,
  request,
}) => {
  const unique = Date.now().toString().slice(-9);
  const email = `e2e-${unique}@example.com`;
  const nickname = `e2e${unique}`;

  // Шаг 1. Регистрация.
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByLabel('Никнейм').fill(nickname);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/verify-email/);

  // Шаг 2. Подтверждение email по ссылке из письма.
  const token = await verificationTokenFor(request, email);
  await page.goto(`/verify-email?token=${token}`);
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

  // Шаг 3. Онбординг: 4 шага с прогресс-баром.
  await expect(page.getByTestId('onboarding-step-1')).toBeVisible();
  await page.getByLabel('Валюта').selectOption('EUR');
  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-step-2')).toBeVisible();
  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-step-3')).toBeVisible();
  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-step-4')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();

  // Шаг 4. Кабинет.
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();
  await expect(page.getByText(`@${nickname}`)).toBeVisible();

  // Шаг 5. Выход и повторный вход.
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/login/, { timeout: 20_000 });

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByText(`@${nickname}`)).toBeVisible();
});
