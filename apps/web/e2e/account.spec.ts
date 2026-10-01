// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 1.7 (ТЗ §3.1, §6, §9): из настроек /settings выгружаем данные в
// JSON и CSV(ZIP), затем полностью удаляем аккаунт с подтверждением паролем и
// никнеймом — после этого вход невозможен.
import { readFile } from 'node:fs/promises';
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

test('экспорт данных и удаление аккаунта из настроек', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `data-${unique}@example.com`;
  const nickname = `data${unique}`;

  // Регистрация → подтверждение email → онбординг.
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

  // Настройки: переходим из экрана настроек в секцию «Данные и приватность».
  await page.goto('/app/profile');
  await page.getByTestId('open-data-privacy').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Данные и приватность' })).toBeVisible();

  // Экспорт JSON: файл скачивается и содержит данные пользователя без секретов.
  const jsonDownload = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toMatch(/^puls-export-.*\.json$/);

  const jsonPath = await json.path();
  expect(jsonPath, 'файл выгрузки должен быть сохранён').toBeTruthy();
  const document = JSON.parse(await readFile(jsonPath as string, 'utf8')) as {
    format: string;
    version: number;
    user: { email: string };
    data: Record<string, unknown[]>;
  };
  expect(document.format).toBe('puls.export');
  expect(document.version).toBe(1);
  expect(document.user.email).toBe(email);
  expect(JSON.stringify(document)).not.toMatch(/passwordHash|password_hash|argon2/);
  await expect(page.getByText('Файл выгрузки сохранён.')).toBeVisible();

  // Экспорт CSV: приходит ZIP-архив.
  const zipDownload = page.waitForEvent('download');
  await page.getByTestId('export-csv').click();
  const zip = await zipDownload;
  expect(zip.suggestedFilename()).toMatch(/^puls-export-.*\.zip$/);

  const zipPath = await zip.path();
  const archive = await readFile(zipPath as string);
  expect(archive.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');

  // Удаление аккаунта: модальное окно, пароль и никнейм.
  await page.getByTestId('delete-account-open').click();
  await expect(page.getByTestId('delete-account-modal')).toBeVisible();

  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByLabel('Никнейм для подтверждения').fill(nickname);
  await page.getByTestId('delete-account-confirm').click();

  // После удаления — вход не действует.
  await expect(page).toHaveURL(/login/, { timeout: 20_000 });

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
