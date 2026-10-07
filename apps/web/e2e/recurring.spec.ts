// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 2 (ТЗ §3.2): регулярный платёж создаётся на экране «Финансы»,
// появляется в списке и в ближайших списаниях, ставится на паузу и удаляется.
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

test('регулярный платёж: создание, пауза и удаление', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `rec-${unique}@example.com`;
  const nickname = `rec${unique}`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByLabel('Никнейм').fill(nickname);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

  const token = await verificationTokenFor(request, email);
  await page.goto(`/verify-email?token=${token}`);
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

  await expect(page.getByTestId('onboarding-step-1')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-2')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-3')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-4')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  // Секция регулярных платежей на экране финансов.
  await page.goto('/finance?tab=recurring');
  await expect(page.getByTestId('recurring-section')).toBeVisible();

  await page.getByTestId('recurring-form-toggle').click();
  await page.getByTestId('recurring-name-input').fill('Аренда');
  await page.getByTestId('recurring-amount-input').fill('30000');
  await page.getByTestId('recurring-day').fill('1');
  await page.getByTestId('recurring-submit').click();

  const item = page.getByTestId('recurring-list').getByTestId('recurring-item').first();
  await expect(item.getByTestId('recurring-name')).toHaveText('Аренда');
  await expect(item.getByTestId('recurring-amount')).toContainText('30');
  await expect(page.getByTestId('recurring-upcoming')).toContainText('Аренда');

  // Пауза и возобновление.
  await item.getByTestId('recurring-toggle').click();
  await expect(item.getByTestId('recurring-toggle')).toHaveText('Возобновить', { timeout: 15_000 });
  await item.getByTestId('recurring-toggle').click();
  await expect(item.getByTestId('recurring-toggle')).toHaveText('Пауза', { timeout: 15_000 });

  // Удаление.
  await item.getByTestId('recurring-remove').click();
  await expect(page.getByTestId('recurring-empty')).toBeVisible({ timeout: 15_000 });
});
