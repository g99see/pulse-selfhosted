// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E статистики (ТЗ §3.4, §9): после быстрого ввода траты дашборд дня и экран
// «Статистика» обновляются сразу — без перезагрузки страницы.
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

test('после быстрого ввода траты дашборд дня обновляется', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `stats-${unique}@example.com`;
  const nickname = `stats${unique}`;

  // Регистрация, подтверждение email и онбординг с первым счётом.
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

  // Дашборд дня на главной: сначала трат нет.
  await expect(page.getByTestId('today-stats')).toBeVisible();
  await expect(page.getByTestId('today-spent')).toContainText('0');

  // Быстрый ввод траты: «+» → текст → сохранить.
  await page.getByTestId('quick-add-open').first().click();
  await expect(page.getByTestId('quick-add-sheet')).toBeVisible();
  await page.getByTestId('quick-add-text').fill('обед 450');
  await expect(page.getByTestId('quick-add-preview')).toContainText('450');
  await page.getByTestId('quick-add-submit').click();
  await expect(page.getByTestId('quick-add-sheet')).toBeHidden({ timeout: 15_000 });

  // Дашборд обновился сразу — без перехода на другую страницу.
  await expect(page.getByTestId('today-spent')).toContainText('450');

  // Экран «Статистика»: итоги за период и тепловая карта с описанием для скринридера.
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: 'Статистика', level: 1 })).toBeVisible();
  await expect(page.getByTestId('stats-spent')).toContainText('450');
  await expect(page.getByTestId('stats-categories')).toContainText('Еда');
  await expect(page.getByTestId('stats-heatmap')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Настроение за месяц' })).toBeVisible();

  // Переключатель периода работает.
  await page.getByTestId('stats-period-month').click();
  await expect(page.getByTestId('stats-period-month')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('stats-spent')).toContainText('450');
});
