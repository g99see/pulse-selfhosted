// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 1.2 (ТЗ §5, сценарий 1): быстрый ввод «обед 450» сохраняется
// транзакцией в категории «Еда», экран «Финансы» показывает её в списке.
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

test('быстрый ввод «обед 450» → транзакция в категории «Еда»', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `fin-${unique}@example.com`;
  const nickname = `fin${unique}`;

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

  // Быстрый ввод за три нажатия: «+» → текст → сохранить.
  // Кнопка есть в боковой и нижней навигации — берём первую.
  await page.getByTestId('quick-add-open').first().click();
  await expect(page.getByTestId('quick-add-sheet')).toBeVisible();
  await page.getByTestId('quick-add-text').fill('обед 450');
  await expect(page.getByTestId('quick-add-preview')).toContainText('450');
  await page.getByTestId('quick-add-submit').click();
  await expect(page.getByTestId('quick-add-sheet')).toBeHidden({ timeout: 15_000 });

  // Экран «Финансы»: транзакция в категории «Еда» и баланс счёта уменьшился.
  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Финансы' })).toBeVisible();

  const row = page.getByTestId('finance-transactions').getByRole('listitem').first();
  await expect(row.getByTestId('transaction-category')).toHaveText('Еда');
  await expect(row.getByTestId('transaction-amount')).toContainText('450');

  // «Удалить все» с подтверждением очищает список операций.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('transactions-delete-all').click();
  await expect(page.getByTestId('transactions-empty')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('finance-transactions').getByRole('listitem')).toHaveCount(0);

  await page.getByTestId('finance-tab-accounts').click();
  await expect(page.getByTestId('finance-accounts')).toContainText('Основной счёт');
});
