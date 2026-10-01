// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 5, блок K (ТЗ §4, P3): виджет цели. Публичная цель публичного
// профиля встраивается через iframe: кнопка «Встроить» даёт сниппет и ссылку,
// а сама страница /widget/goal/:id рисует прогресс-бар без AppShell.
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

test('виджет цели встраивается: сниппет, ссылка и страница прогресса', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `widget-${unique}@example.com`;
  const nickname = `wgt${unique}`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByLabel('Никнейм').fill(nickname);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/verify-email/);

  const token = await verificationTokenFor(request, email);
  await page.goto(`/verify-email?token=${token}`);
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

  // Онбординг: на шаге приватности открываем профиль — виджету нужен public.
  await expect(page.getByTestId('onboarding-step-1')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-2')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-3')).toBeVisible();
  await page.locator('#visibility').selectOption('public');
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-4')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  // Публичная цель.
  await page.goto('/goals');
  await page.getByTestId('goal-title').fill('Ноутбук');
  await page.getByTestId('goal-target').fill('100000');
  await page.getByTestId('goal-visibility').selectOption('public');
  await page.getByTestId('goal-create').click();

  const card = page.getByTestId('goal-card').first();
  await expect(card).toContainText('Ноутбук', { timeout: 15_000 });

  // Пополняем до 25% — виджет должен показать этот процент.
  await card.getByTestId('goal-deposit-amount').fill('25000');
  await card.getByTestId('goal-deposit-submit').click();
  await expect(card.getByTestId('goal-milestone').filter({ hasText: '25' })).toBeVisible({
    timeout: 15_000,
  });

  // Кнопка «Встроить» показывает готовый iframe-сниппет и ссылку.
  await card.getByTestId('goal-embed').click();
  const panel = card.getByTestId('goal-embed-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('goal-embed-snippet')).toHaveValue(/\/widget\/goal\//);
  await expect(panel.getByTestId('goal-embed-snippet')).toHaveValue(/<iframe/);

  const href = await panel.getByTestId('goal-embed-link').getAttribute('href');
  expect(href, 'ссылка на виджет должна вести на /widget/goal/:id').toMatch(/\/widget\/goal\//);

  // Сама страница виджета: без AppShell, с прогрессом цели.
  await page.goto(href as string);
  const widget = page.getByTestId('goal-widget');
  await expect(widget).toBeVisible();
  await expect(widget).toContainText('Ноутбук');
  await expect(widget).toContainText('25');
  await expect(page.getByTestId('goal-widget-bar')).toHaveAttribute('aria-valuenow', '25');
});
