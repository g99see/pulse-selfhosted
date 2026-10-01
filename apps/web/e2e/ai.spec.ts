// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 4, блок C (ТЗ §3.9): AI-помощник в интерфейсе. Заходим настоящим
// пользователем (кабинет защищён серверным guard'ом), а ответы AI-эндпоинтов
// подменяем через page.route — так тест проверяет UI, а не провайдера.
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
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(letter?.link ?? letter?.text ?? '')?.[1];
  expect(token, 'в письме должна быть ссылка с токеном').toBeTruthy();
  return token as string;
}

/** Регистрирует пользователя и проходит онбординг — попадает в кабинет. */
async function registerAndOnboard(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
): Promise<void> {
  const unique = `${Date.now()}`.slice(-9) + `${Math.floor(Math.random() * 1000)}`;
  const email = `ai-${unique}@example.com`;
  const nickname = `ai${unique}`.slice(0, 30);

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
}

const USAGE = { month: '2026-10', tokensIn: 1200, tokensOut: 800, costUsd: 0.02, limitTokens: null };

async function stubStatus(page: import('@playwright/test').Page, enabled: boolean): Promise<void> {
  await page.route('**/api/ai/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: {
          enabled,
          source: enabled ? 'user' : 'none',
          provider: enabled ? 'anthropic' : null,
          model: enabled ? 'claude-sonnet' : null,
          last4: enabled ? '1234' : null,
          baseUrl: null,
          usage: USAGE,
        },
      }),
    }),
  );
}

test('без ключа пункт навигации скрыт, а экран предлагает подключить ключ', async ({ page, request }) => {
  await registerAndOnboard(page, request);

  await stubStatus(page, false);
  await page.reload();
  await expect(page.getByTestId('nav-ai')).toHaveCount(0);

  await page.goto('/ai');
  await expect(page.getByTestId('ai-disabled')).toBeVisible();
  await expect(page.getByTestId('ai-disabled-settings')).toHaveAttribute('href', '/settings');
});

test('с ключом чат отвечает, а предложение применяется по кнопке', async ({ page, request }) => {
  await registerAndOnboard(page, request);

  await stubStatus(page, true);
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'REPLY-MARKER: на кафе ушло 3200 ₽',
        proposals: [
          { id: 'p1', kind: 'budget', summary: 'Бюджет на кафе', payload: { limit: 3000 }, status: 'pending' },
        ],
        usage: USAGE,
      }),
    }),
  );
  await page.route('**/api/ai/proposals/*/apply', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        proposal: {
          id: 'p1',
          kind: 'budget',
          summary: 'Бюджет на кафе',
          payload: { limit: 3000 },
          status: 'applied',
        },
      }),
    }),
  );

  await page.reload();
  await expect(page.getByTestId('nav-ai').filter({ visible: true })).toHaveCount(1);

  await page.goto('/ai');
  await page.getByTestId('ai-chat-input').fill('Сколько я потратил на кафе?');
  await page.getByTestId('ai-chat-send').click();

  await expect(page.getByTestId('ai-chat-log')).toContainText('REPLY-MARKER', { timeout: 10_000 });
  await expect(page.getByTestId('ai-proposal')).toContainText('Бюджет на кафе');

  await page.getByTestId('ai-proposal-apply').click();
  await expect(page.getByTestId('ai-proposal-applied')).toBeVisible();
});

test('предпросмотр разбора показывает, что уйдёт провайдеру', async ({ page, request }) => {
  await registerAndOnboard(page, request);

  await stubStatus(page, true);
  await page.route('**/api/ai/review/preview', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        preview: {
          period: 'week',
          provider: 'anthropic',
          isLocal: false,
          payloadText: 'PAYLOAD-MARKER: 7 чек-инов, 12 транзакций',
          includesNotes: false,
          includesName: false,
        },
      }),
    }),
  );

  await page.goto('/ai');
  await page.getByTestId('ai-review-preview').click();

  await expect(page.getByTestId('ai-review-payload')).toContainText('PAYLOAD-MARKER', { timeout: 10_000 });
  await expect(page.getByTestId('ai-review-scope')).toBeVisible();
});
