// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 2 (ТЗ §2, §4): стрики и достижения — серия на карточке чек-ина,
// сетка бейджей и конфетти при получении первого достижения.
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
  const email = `achv-${unique}@example.com`;
  const nickname = `achv${unique}`;

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

test('стрик на карточке и достижения: бейджи, серия и конфетти', async ({ page, request }) => {
  await signUpAndOnboard(page, request);

  // Экран достижений: все группы и бейджи на месте, ещё ничего не получено.
  await page.goto('/achievements');
  await expect(page.getByTestId('achievements-page')).toBeVisible();
  await expect(page.getByTestId('achievements-streak')).toBeVisible();
  await expect(page.getByTestId('achievements-group-checkins')).toBeVisible();
  await expect(page.getByTestId('achievements-group-finance')).toBeVisible();
  await expect(page.getByTestId('achievement-first_checkin')).toHaveAttribute(
    'data-earned',
    'false',
  );

  // Первый чек-ин с главной: появляется серия и конфетти за первое достижение.
  await page.goto('/app');
  await page.getByTestId('mood-4').click();
  await expect(page.getByTestId('checkin-card-saved')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('checkin-streak')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('confetti')).toBeVisible({ timeout: 15_000 });

  // На экране достижений первый бейдж теперь получен.
  await page.goto('/achievements');
  await expect(page.getByTestId('achievement-first_checkin')).toHaveAttribute(
    'data-earned',
    'true',
  );
  await expect(page.getByTestId('achievement-first_checkin')).toContainText('Получено');
});
