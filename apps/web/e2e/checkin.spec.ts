// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 1.3 (ТЗ §3.3, §5 сценарий 1): чек-ин отвечается за пару кликов
// прямо с главной, история и расширенный ответ работают на /checkin.
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

async function signUpAndOnboard(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
): Promise<void> {
  const unique = Date.now().toString().slice(-9);
  const email = `checkin-${unique}@example.com`;
  const nickname = `chk${unique}`;

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
  await expect(page.getByTestId('onboarding-step-2')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-3')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-4')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
}

test('чек-ин отвечается за пару кликов с главной', async ({ page, request }) => {
  await signUpAndOnboard(page, request);

  // Карточка на главной: один клик по эмодзи — ответ сохранён.
  await expect(page.getByTestId('checkin-card')).toBeVisible();
  await page.getByTestId('mood-4').click();
  await expect(page.getByTestId('checkin-card-saved')).toBeVisible({ timeout: 15_000 });

  // Страница чек-инов: запись появилась в истории.
  await page.goto('/checkin');
  await expect(page.getByRole('heading', { name: 'Чек-ины', exact: true })).toBeVisible();
  await expect(page.getByTestId('checkin-history').getByRole('listitem').first()).toBeVisible();

  // Расширенный чек-ин: настроение, итог дня и сохранение.
  await page.getByTestId('mood-5').click();
  await page.getByTestId('checkin-day-summary').fill('Успел на тренировку');
  await page.getByTestId('checkin-save').click();
  await expect(page.getByTestId('checkin-saved')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('checkin-history')).toContainText('Успел на тренировку');

  // Расписание: по умолчанию 3 раза в день, меняется на 5.
  await expect(page.getByTestId('checkin-times-per-day')).toHaveValue('3');
  await page.getByTestId('checkin-times-per-day').selectOption('5');
  await page.getByTestId('checkin-schedule-save').click();
  await expect(page.getByTestId('checkin-schedule-saved')).toBeVisible({ timeout: 15_000 });
});
