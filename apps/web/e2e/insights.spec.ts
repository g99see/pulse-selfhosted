// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E рекомендаций (ТЗ §3.5, §8): лента инсайтов на правилах, оценка
// «полезно / не полезно», применение предложения кнопкой и блок последнего
// инсайта на главной.
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

test('лента, оценка и применение предложения', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `insights-${unique}@example.com`;
  const nickname = `insights${unique}`;

  // Регистрация, подтверждение email и онбординг с первым счётом.
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

  // Траты: «обед 450» (Еда) и «такси 1400» (Транспорт) — быстрым вводом.
  for (const text of ['обед 450', 'такси 1400']) {
    await page.getByTestId('quick-add-open').first().click();
    await expect(page.getByTestId('quick-add-sheet')).toBeVisible();
    await page.getByTestId('quick-add-text').fill(text);
    await page.getByTestId('quick-add-submit').click();
    await expect(page.getByTestId('quick-add-sheet')).toBeHidden({ timeout: 15_000 });
  }

  // Бюджет на «Еду» меньше траты — правило превышения бюджета срабатывает.
  await page.goto('/finance');
  await page.getByTestId('budget-form-toggle').click();
  await page.getByTestId('budget-category').selectOption({ label: 'Еда' });
  await page.getByTestId('budget-limit').fill('100');
  await page.getByRole('button', { name: 'Добавить бюджет' }).click();
  await expect(page.getByTestId('finance-budgets')).toContainText('Еда');

  // Лента рекомендаций: наблюдение о превышении бюджета и предложение недели.
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: 'Рекомендации', level: 1 })).toBeVisible();
  await expect(page.getByTestId('insights-feed')).toBeVisible();

  const exceeded = page.locator('[data-insight-type="budget_exceeded"]');
  await expect(exceeded).toContainText('Еда');

  // Оценка «Полезно» сохраняется и переключает карточку в состояние «оценено».
  await exceeded.getByTestId('insight-feedback-useful').click();
  await expect(exceeded.getByTestId('insight-feedback-given')).toBeVisible();

  // Применение предложения создаёт бюджет через финансы.
  const suggestion = page.locator('[data-insight-type="budget_suggestion"]');
  await expect(suggestion).toContainText('Транспорт');
  await suggestion.getByTestId('insight-apply').click();
  await expect(suggestion.getByTestId('insight-applied')).toBeVisible();

  // На главной виден блок последнего наблюдения.
  await page.goto('/app');
  await expect(page.getByTestId('latest-insight')).toBeVisible();
  await expect(page.getByTestId('latest-insight')).toContainText('Последнее наблюдение');
});
