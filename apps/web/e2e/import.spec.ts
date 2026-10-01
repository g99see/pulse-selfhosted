// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 2 (ТЗ §3.2, §5): импорт выписки CSV — загрузка файла, предпросмотр
// с автоопределением колонок, подтверждение и появление транзакций в финансах.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

const STATEMENT = [
  'Дата операции;Сумма;Описание;Тип',
  '01.10.2026;-450,00;Обед в кафе;Расход',
  '02.10.2026;80000,00;Зарплата за сентябрь;Доход',
].join('\n');

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

test('импорт выписки CSV создаёт транзакции из предпросмотра', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `imp-${unique}@example.com`;
  const nickname = `imp${unique}`;

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

  // Экран импорта: загружаем CSV, ждём предпросмотр с автоопределением колонок.
  await page.goto('/finance/import');
  await expect(page.getByRole('heading', { name: 'Импорт выписки из CSV' })).toBeVisible();

  await page.getByTestId('import-file').setInputFiles({
    name: 'statement.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(STATEMENT, 'utf8'),
  });

  await expect(page.getByTestId('import-preview-table')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('import-mapping-date')).toHaveValue('0');
  await expect(page.getByTestId('import-mapping-amount')).toHaveValue('1');
  const previewRows = page.getByTestId('import-preview-table').getByRole('row');
  await expect(previewRows).toHaveCount(3); // заголовок + 2 строки данных
  await expect(page.getByTestId('import-summary')).toContainText('готово: 2');

  // Подтверждаем импорт (счёт подставляется автоматически).
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-result')).toContainText('Импортировано: 2', {
    timeout: 15_000,
  });

  // Транзакции видны на экране финансов в подходящих категориях.
  await page.goto('/finance');
  const list = page.getByTestId('finance-transactions');
  await expect(list).toContainText('Еда');
  await expect(list).toContainText('Зарплата');
});
