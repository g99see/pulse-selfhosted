// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E режима «Тишина» (ТЗ §4, P1): переключатель в шапке и настройках прячет
// суммы одним жестом, Alt+Q переключает режим, состояние переживает перезагрузку,
// а при выключенном режиме суммы видны как раньше.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';
const MASK = '••••';

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

test('режим Тишина прячет суммы и переключается кнопкой, Alt+Q и в настройках', async ({
  page,
  request,
}) => {
  const unique = Date.now().toString().slice(-9);
  const email = `quiet-${unique}@example.com`;
  const nickname = `quiet${unique}`;

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

  // Создаём трату, чтобы на экране была настоящая сумма.
  await page.getByTestId('quick-add-open').first().click();
  await expect(page.getByTestId('quick-add-sheet')).toBeVisible();
  await page.getByTestId('quick-add-text').fill('обед 450');
  await page.getByTestId('quick-add-submit').click();
  await expect(page.getByTestId('quick-add-sheet')).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('today-spent')).toContainText('450');

  // Режим выключен: суммы видны, кнопка не нажата.
  const headerToggle = page.getByTestId('quiet-toggle');
  await expect(headerToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).not.toHaveAttribute('data-quiet', 'true');

  // Включаем режим кнопкой в шапке — суммы заменяются маской.
  await headerToggle.click();
  await expect(headerToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-quiet', 'true');
  await expect(page.getByTestId('today-spent')).toContainText(MASK);
  await expect(page.getByTestId('today-spent')).not.toContainText('450');

  // Состояние переживает перезагрузку (localStorage + data-quiet).
  await page.reload();
  await expect(page.getByTestId('quiet-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('today-spent')).toContainText(MASK);

  // На экране финансов суммы тоже скрыты.
  await page.goto('/finance?tab=accounts');
  await expect(page.getByTestId('finance-accounts')).toContainText(MASK);

  // Горячая клавиша Alt+Q выключает режим — суммы возвращаются.
  await page.keyboard.press('Alt+q');
  await expect(page.getByTestId('quiet-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.goto('/app');
  await expect(page.getByTestId('today-spent')).toContainText('450');

  // Переключатель в настройках работает так же.
  await page.goto('/settings');
  await expect(page.getByTestId('quiet-settings')).toBeVisible();
  await page.getByTestId('quiet-settings-toggle').click();
  await expect(page.getByTestId('quiet-settings-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/stats');
  await expect(page.getByTestId('stats-spent')).toContainText(MASK);
});
