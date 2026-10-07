// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 2 (ТЗ §3.2, §5 сценарий 2): цель «Ноутбук» 120 000 ₽ к 1 марта,
// пополнение на 60 000 ₽ поднимает прогресс до 50% и выдаёт веху, а карточка
// цели появляется на главной.
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
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(
    letter?.link ?? letter?.text ?? '',
  )?.[1];
  expect(token, 'в письме должна быть ссылка с токеном').toBeTruthy();
  return token as string;
}

test('цель накоплений: 120 000 ₽ к 1 марта, взнос и веха на 50%', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `goal-${unique}@example.com`;
  const nickname = `goal${unique}`;

  // Регистрация, подтверждение email и онбординг.
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

  // Создаём цель на экране «Цели накоплений».
  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Цели накоплений' })).toBeVisible();

  await page.getByTestId('goal-title').fill('Ноутбук');
  await page.getByTestId('goal-target').fill('120000');
  await page.getByTestId('goal-deadline').fill('2027-03-01');
  await page.getByTestId('goal-create').click();

  const card = page.getByTestId('goal-card').first();
  await expect(card).toContainText('Ноутбук', { timeout: 15_000 });
  await expect(card).toContainText('Взнос в месяц');

  // Пополняем на 60 000 ₽ → прогресс 50%, приходит веха.
  await card.getByTestId('goal-deposit-amount').fill('60000');
  await card.getByTestId('goal-deposit-submit').click();

  await expect(card.getByTestId('goal-milestone').filter({ hasText: '50' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(card).toContainText('120 000');

  // Карточка целей на главной показывает цель.
  await page.goto('/app');
  await expect(page.getByTestId('goals-card-list')).toContainText('Ноутбук');
});
