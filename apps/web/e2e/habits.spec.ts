// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 5, блок G (ТЗ §4, P2): трекер привычек — создание «Вода», отметка
// чекбоксом в чек-ине, серия дней и архив.
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

async function signUpAndOnboard(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
): Promise<void> {
  const unique = Date.now().toString().slice(-9);
  const email = `habit-${unique}@example.com`;
  const nickname = `hbt${unique}`;

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
}

test('трекер привычек: отметка в чек-ине, серия и архив', async ({ page, request }) => {
  await signUpAndOnboard(page, request);

  // Создаём привычку «Вода» на экране /habits.
  await page.goto('/habits');
  await expect(page.getByRole('heading', { name: 'Привычки', exact: true })).toBeVisible();

  await page.getByTestId('habit-name').fill('Вода');
  await page.getByTestId('habit-icon').selectOption('💧');
  await page.getByTestId('habit-create').click();

  const card = page.getByTestId('habit-card').first();
  await expect(card).toContainText('Вода', { timeout: 15_000 });
  await expect(card.getByTestId('habit-streak')).toContainText('Серии пока нет');

  // Отмечаем привычку чекбоксом на странице чек-ина.
  await page.goto('/checkin');
  await expect(page.getByTestId('checkin-habits')).toBeVisible();
  const item = page.getByTestId('habit-today-item').filter({ hasText: 'Вода' });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.getByTestId('habit-today-checkbox').click();
  await expect(item.getByTestId('habit-today-checkbox')).toBeChecked({ timeout: 15_000 });
  await expect(item.getByTestId('habit-today-streak')).toContainText('Серия: 1');

  // Блок «Привычки сегодня» виден и в карточке чек-ина на главной.
  await page.goto('/app');
  const cardBlock = page.getByTestId('checkin-card').getByTestId('habits-today');
  await expect(cardBlock).toContainText('Вода', { timeout: 15_000 });

  // Серия выросла на экране привычек.
  await page.goto('/habits');
  await expect(page.getByTestId('habit-card').first().getByTestId('habit-streak')).toContainText(
    'Серия: 1',
  );

  // Архивация убирает привычку из чек-ина, но оставляет в архиве.
  await page.getByTestId('habit-archive').click();
  await expect(page.getByTestId('habits-archive-list')).toContainText('Вода', { timeout: 15_000 });

  await page.goto('/checkin');
  await expect(page.getByTestId('habits-today')).toHaveCount(0);
});
