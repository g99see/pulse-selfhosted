// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 2 (ТЗ §3.2): мультивалютность — счёт в USD, ручной курс USD→RUB
// на экране /finance/rates и удаление курса.
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

test('курс USD→RUB создаётся на экране «Курсы валют» и удаляется', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `fx-${unique}@example.com`;
  const nickname = `fx${unique}`;

  // Регистрация, подтверждение email и онбординг.
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByLabel('Никнейм').fill(nickname);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/verify-email/);

  const token = await verificationTokenFor(request, email);
  await page.goto(`/verify-email?token=${token}`);
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

  await expect(page.getByTestId('onboarding-step-1')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  // Счёт в долларах: форма счёта даёт выбрать валюту (ТЗ §3.2).
  await page.goto('/finance?tab=accounts');
  await expect(page.getByRole('heading', { name: 'Финансы' })).toBeVisible();
  await page.getByTestId('account-form-toggle').click();
  await page.getByTestId('account-name').fill('Долларовый');
  await page.getByTestId('account-currency').selectOption('USD');
  await page.getByRole('button', { name: 'Добавить счёт' }).click();
  await expect(page.getByTestId('finance-accounts')).toContainText('Долларовый');

  // Экран курсов: создаём ручной курс USD→RUB.
  await page.getByTestId('rates-link').click();
  await expect(page).toHaveURL(/\/finance\/rates/);
  await expect(page.getByRole('heading', { name: 'Курсы валют' })).toBeVisible();
  await expect(page.getByTestId('rates-empty')).toBeVisible();

  await page.getByTestId('rate-date').fill('2026-10-01');
  await page.getByTestId('rate-base').selectOption('USD');
  await page.getByTestId('rate-quote').selectOption('RUB');
  await page.getByTestId('rate-input').fill('95');
  await page.getByTestId('rate-submit').click();

  const row = page.getByTestId('finance-rates').getByRole('listitem').first();
  await expect(row.getByTestId('rate-pair')).toContainText('USD');
  await expect(row.getByTestId('rate-pair')).toContainText('RUB');
  await expect(row.getByTestId('rate-value')).toContainText('95');
  await expect(page.getByTestId('rate-saved')).toBeVisible();

  // Удаляем курс — список снова пуст.
  await page.getByTestId('finance-rates').getByRole('button').first().click();
  await expect(page.getByTestId('rates-empty')).toBeVisible();
});
