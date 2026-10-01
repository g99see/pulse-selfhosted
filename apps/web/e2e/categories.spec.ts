// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E управления своими категориями (ТЗ §3.2, §5): создаём категорию с
// иконкой и цветом → она появляется в фильтре и быстром вводе →
// переименовываем → удаляем с подтверждением.
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

test('своя категория: создание, фильтр, быстрый ввод, переименование, удаление', async ({
  page,
  request,
}) => {
  const unique = Date.now().toString().slice(-9);
  const email = `cat-${unique}@example.com`;
  const nickname = `cat${unique}`;
  const categoryName = `Кофе${unique}`;
  const renamed = `Кофе и чай${unique}`;

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

  // Экран финансов: секция «Мои категории».
  await page.goto('/finance?tab=categories');
  await expect(page.getByRole('heading', { name: 'Мои категории' })).toBeVisible();

  // Создание: название, тип «Расход», иконка и цвет из наборов (форма свёрнута).
  await page.getByTestId('category-form-toggle').click();
  await page.getByTestId('category-name').fill(categoryName);
  await page.getByRole('radio', { name: 'Спорт', exact: true }).check({ force: true });
  await page.getByRole('radio', { name: 'Зелёный', exact: true }).check({ force: true });
  await page.getByTestId('category-create-submit').click();

  await expect(page.getByTestId('finance-categories')).toContainText(categoryName);

  // Категория доступна в фильтре транзакций (вкладка «Операции»).
  await page.getByTestId('finance-tab-ops').click();
  await expect(page.getByTestId('filter-category')).toContainText(categoryName);
  await page.getByTestId('finance-tab-categories').click();

  // И в быстром вводе.
  await page.getByTestId('quick-add-open').first().click();
  await expect(page.getByTestId('quick-add-sheet')).toBeVisible();
  await expect(
    page.getByTestId('quick-add-sheet').getByRole('button', { name: categoryName }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-add-sheet')).toBeHidden();

  // Переименование.
  const row = page
    .getByTestId('finance-categories')
    .getByTestId('category-item')
    .filter({ hasText: categoryName });
  await row.getByTestId('category-edit').click();
  await page.getByTestId('category-edit-name').fill(renamed);
  await page.getByTestId('category-edit-save').click();
  await expect(page.getByTestId('finance-categories')).toContainText(renamed);

  // Удаление с подтверждением.
  const renamedRow = page
    .getByTestId('finance-categories')
    .getByTestId('category-item')
    .filter({ hasText: renamed });
  await renamedRow.getByTestId('category-delete').click();
  await expect(page.getByTestId('category-delete-confirm-panel')).toBeVisible();
  await page.getByTestId('category-delete-confirm').click();

  await expect(page.getByTestId('finance-categories')).not.toContainText(renamed);
  await page.getByTestId('finance-tab-ops').click();
  await expect(page.getByTestId('filter-category')).not.toContainText(renamed);
});
