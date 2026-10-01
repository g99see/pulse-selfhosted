// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 3, блок E (ТЗ §2, §3.7, §3.8): пользователь жалуется на контент,
// модератор видит жалобу в очереди и закрывает её скрытием цели.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** DATABASE_URL: из окружения или из apps/api/.env (как запускается сервер API). */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = resolve(process.cwd(), '..', 'api', '.env');
  if (!existsSync(envFile)) throw new Error('DATABASE_URL не найден');
  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL не найден в apps/api/.env');
  return line.slice('DATABASE_URL='.length).trim();
}

/** Меняет роль пользователя в БД — в UI такого эндпоинта нет (ТЗ §2, §9 п.7). */
function setRole(email: string, role: 'moderator' | 'admin'): void {
  const sql = `UPDATE "users" SET role = '${role}' WHERE email = '${email}';`;
  execFileSync(
    'pnpm',
    ['--filter', '@puls/api', 'exec', 'prisma', 'db', 'execute', '--stdin', '--url', databaseUrl()],
    { cwd: resolve(process.cwd(), '..', '..'), input: sql, stdio: 'pipe' },
  );
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

/** Регистрирует пользователя через UI и проходит онбординг. Возвращает email и ник. */
async function signUpAndOnboard(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
): Promise<{ email: string; nickname: string }> {
  const unique = `${Date.now()}`.slice(-9) + `${Math.floor(Math.random() * 1000)}`;
  const email = `mod-e2e-${unique}@example.com`;
  const nickname = `mode2e${unique}`.slice(0, 30);

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

  return { email, nickname };
}

test('жалоба → модератор видит и закрывает её скрытием', async ({ browser, request }) => {
  const targetId = `e2e-page-${Date.now()}`;

  // 1. Обычный пользователь отправляет жалобу (как это делает ReportButton).
  const reporterContext = await browser.newContext();
  const reporterPage = await reporterContext.newPage();
  await signUpAndOnboard(reporterPage, request);

  const csrfCookie = (await reporterContext.cookies()).find(
    (cookie) => cookie.name === 'puls_csrf',
  );
  const reported = await reporterPage.request.post(`${API_URL}/api/reports`, {
    headers: { 'x-csrf-token': csrfCookie?.value ?? '' },
    data: {
      targetType: 'html_page',
      targetId,
      reason: 'phishing',
      details: 'Форма собирает пароли',
    },
  });
  expect(reported.status()).toBe(201);
  await reporterContext.close();

  // 2. Второй пользователь становится модератором и открывает очередь.
  const moderatorContext = await browser.newContext();
  const moderatorPage = await moderatorContext.newPage();
  const moderator = await signUpAndOnboard(moderatorPage, request);
  setRole(moderator.email, 'moderator');

  // После смены роли перезагружаем кабинет: навигация и /api/auth/me обновятся.
  await moderatorPage.reload();
  await moderatorPage.goto('/moderation');
  await expect(moderatorPage.getByTestId('moderation-page')).toBeVisible();
  await expect(moderatorPage.getByTestId('moderation-forbidden')).toHaveCount(0);

  const row = moderatorPage
    .locator('[data-testid="moderation-report"]')
    .filter({ hasText: targetId });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByTestId('moderation-report-details')).toContainText('пароли');

  // 3. Модератор закрывает жалобу: скрывает цель (ban_html).
  await row.getByTestId('moderation-note').fill('Фишинг подтверждён');
  await row.getByTestId('moderation-action-ban_html').click();
  await expect(moderatorPage.getByTestId('moderation-message')).toBeVisible();

  // 4. В открытых жалобы больше нет, а действие попало в журнал.
  await moderatorPage.getByTestId('moderation-filter-open').click();
  await expect(
    moderatorPage.locator('[data-testid="moderation-report"]').filter({ hasText: targetId }),
  ).toHaveCount(0);
  await expect(moderatorPage.getByTestId('moderation-actions')).toContainText(targetId);

  await moderatorContext.close();
});
