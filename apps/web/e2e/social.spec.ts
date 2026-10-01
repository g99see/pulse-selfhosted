// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 3, блок B (ТЗ §3.7): лента — пост появляется после достижения,
// реакция и комментарий работают, комментарий удаляется автором.
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
  const email = `social-${unique}@example.com`;
  const nickname = `social${unique}`;

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
  // Публичный профиль — чтобы посты были видны подписчикам (ТЗ §3.7).
  await page.locator('#visibility').selectOption('public');
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-4')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
}

test('лента: пост о достижении, реакция и комментарий', async ({ page, request }) => {
  await signUpAndOnboard(page, request);

  // Чек-ин даёт достижение first_checkin и пост в ленту.
  await page.getByTestId('mood-4').click();
  await expect(page.getByTestId('checkin-card-saved')).toBeVisible({ timeout: 15_000 });

  await page.goto('/feed');
  await expect(page.getByTestId('feed-page')).toBeVisible();
  const card = page.getByTestId('post-card').first();
  await expect(card).toBeVisible({ timeout: 15_000 });

  // Реакция: нажатие переключает reactedByMe.
  const fire = page.getByTestId('reaction-🔥').first();
  await expect(fire).toHaveAttribute('data-reacted', 'false');
  await fire.click();
  await expect(fire).toHaveAttribute('data-reacted', 'true');

  // Комментарий: добавляем и удаляем.
  await page.getByTestId('comments-toggle').first().click();
  await page.getByTestId('comment-input').first().fill('Отличная работа!');
  await page.getByTestId('comment-submit').first().click();
  await expect(page.getByText('Отличная работа!')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Удалить' }).first().click();
  await expect(page.getByText('Отличная работа!')).toHaveCount(0, { timeout: 10_000 });
});
