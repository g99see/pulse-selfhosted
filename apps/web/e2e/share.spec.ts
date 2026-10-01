// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 3, блок F (ТЗ §3.7, сценарий 2): кнопка «Поделиться результатом»
// открывает предпросмотр карточки цели «50% к цели», а PNG скачивается файлом.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

interface SentMail {
  to: string;
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

/** Регистрация, подтверждение email и онбординг. */
async function registerAndOnboard(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext): Promise<void> {
  const unique = Date.now().toString().slice(-9);
  const email = `share-${unique}@example.com`;
  const nickname = `share${unique}`;

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

test('карточка цели: предпросмотр и скачивание PNG', async ({ page, request }) => {
  await registerAndOnboard(page, request);

  await page.goto('/goals');
  await page.getByTestId('goal-title').fill('Ноутбук');
  await page.getByTestId('goal-target').fill('120000');
  await page.getByTestId('goal-create').click();

  const card = page.getByTestId('goal-card').first();
  await expect(card).toContainText('Ноутбук', { timeout: 15_000 });

  await card.getByTestId('goal-deposit-amount').fill('60000');
  await card.getByTestId('goal-deposit-submit').click();
  await expect(card.getByTestId('goal-milestone').filter({ hasText: '50' })).toBeVisible({ timeout: 15_000 });

  // Кнопка «Поделиться» открывает предпросмотр карточки.
  await card.getByTestId(/^share-goal_progress-/).click();
  const sheet = page.getByTestId('share-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('share-preview')).toBeVisible({ timeout: 20_000 });

  // Квадратный формат перезагружает предпросмотр.
  await sheet.getByTestId('share-format-square').click();
  await expect(sheet.getByTestId('share-preview')).toBeVisible({ timeout: 20_000 });

  // Скачивание PNG-файла.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByTestId('share-download').click(),
  ]);
  expect(download.suggestedFilename()).toContain('goal_progress');

  // Ссылка «открыть в Telegram» доступна в предпросмотре.
  await expect(sheet.getByTestId('share-telegram')).toBeVisible();
});

test('карточка стрика со страницы достижений открывается', async ({ page, request }) => {
  await registerAndOnboard(page, request);

  // Чек-ин, чтобы на экране достижений был стрик.
  await page.goto('/checkin');
  await page.getByTestId('mood-4').click();
  await page.getByTestId('checkin-save').click();
  await expect(page.getByTestId('checkin-saved')).toBeVisible({ timeout: 15_000 });

  await page.goto('/achievements');
  await expect(page.getByTestId('achievements-page')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('share-checkin_streak').click();
  const sheet = page.getByTestId('share-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('share-preview')).toBeVisible({ timeout: 20_000 });
});
