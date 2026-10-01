// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 3, блок D (ТЗ §3.8): редактор HTML-страницы — выбор шаблона,
// сохранение, история последних 10 версий с откатом, изолированный
// предпросмотр (sandbox без allow-same-origin) и публичная вкладка.
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

async function registerAndOnboard(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const unique = Date.now().toString().slice(-9);
  const email = `html-${unique}@example.com`;
  const nickname = `html${unique}`;

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

  return nickname;
}

test('редактор HTML-страницы: шаблон, сохранение и откат версии', async ({ page, request }) => {
  const nickname = await registerAndOnboard(page, request);

  await page.goto('/page-editor');
  await expect(page.getByRole('heading', { name: 'HTML-страница' })).toBeVisible();

  // Предпросмотр изолирован: allow-scripts, без allow-same-origin (ТЗ §3.8).
  const preview = page.getByTestId('htmlPage-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(preview).toHaveAttribute('referrerpolicy', 'no-referrer');

  // Готовый шаблон «Визитка» подставляется в код.
  await page.getByTestId('htmlPage-template-business-card').click();
  await expect(page.getByTestId('htmlPage-code')).toHaveValue(/<!DOCTYPE html>/i);

  // Первое сохранение создаёт версию.
  await page.getByTestId('htmlPage-save').click();
  await expect(page.getByTestId('htmlPage-notice')).toContainText('Сохранено', { timeout: 15_000 });

  // Меняем код и сохраняем ещё раз — в истории две версии.
  await page
    .getByTestId('htmlPage-code')
    .fill('<!DOCTYPE html><html><body><h1>Версия 2</h1></body></html>');
  await page.getByTestId('htmlPage-save').click();
  await expect(page.getByTestId('htmlPage-notice')).toContainText('Сохранено', { timeout: 15_000 });

  const versions = page.locator('[data-testid^="htmlPage-version-"]');
  await expect(versions).toHaveCount(2, { timeout: 15_000 });

  // Откатываемся к более старой версии — она снова становится текущей.
  await versions
    .last()
    .getByTestId(/htmlPage-restore-/)
    .click();
  await expect(page.getByTestId('htmlPage-notice')).toContainText('Версия восстановлена', {
    timeout: 15_000,
  });

  // Публичная вкладка по короткому адресу /@nickname/page отдаёт iframe песочницы.
  const response = await page.goto(`/@${nickname}/page`);
  expect(response?.status()).toBe(200);
  const publicFrame = page.getByTestId('public-html-frame');
  await expect(publicFrame).toBeVisible();
  await expect(publicFrame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(publicFrame).toHaveAttribute('referrerpolicy', 'no-referrer');
});
