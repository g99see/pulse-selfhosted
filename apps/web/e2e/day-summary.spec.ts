// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E v2 §7: приватная ссылка «Итог дня» — создаётся в настройках, открывается
// без входа, после отзыва показывает заглушку.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

test('итог дня по ссылке: создать, открыть без входа, отозвать', async ({
  page,
  request,
  browser,
}) => {
  const unique = Date.now().toString().slice(-9);
  const email = `dsum-${unique}@example.com`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByLabel('Никнейм').fill(`dsum${unique}`);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/verify-email/);

  const outbox = await request.get(`${API_URL}/api/auth/dev/outbox`);
  const body = (await outbox.json()) as {
    messages: { to: string; text: string; link?: string; kind?: string }[];
  };
  const letter = [...body.messages]
    .reverse()
    .find((message) => message.to === email && message.kind === 'email-verification');
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(
    letter?.link ?? letter?.text ?? '',
  )?.[1];
  await page.goto(`/verify-email?token=${token}`);
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });
  // Без завершённого онбординга кабинет (и настройки) перенаправляют обратно на него.
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  await page.goto('/settings');
  await page.getByTestId('day-summary-create').click();
  const url = await page.getByTestId('day-summary-url').inputValue();
  expect(url).toMatch(/\/d\/[A-Za-z0-9_-]{43}$/);

  // Чистый контекст без cookie: страница открывается.
  const anonymous = await browser.newContext();
  const anonPage = await anonymous.newPage();
  await anonPage.goto(url);
  await expect(anonPage.getByTestId('day-summary-public')).toContainText('Потрачено');

  await page.getByTestId('day-summary-revoke').click();
  await anonPage.goto(url);
  await expect(anonPage.getByTestId('day-summary-public')).toContainText('недействительна');
  await anonymous.close();
});
