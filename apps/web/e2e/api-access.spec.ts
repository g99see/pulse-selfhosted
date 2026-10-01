// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 4, блок E (ТЗ §4, P2): создание личного токена в настройках,
// вызов /api/v1/me с заголовком Bearer, отзыв токена → 401.
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

test('открытый API: токен в настройках, /api/v1/me по Bearer, отзыв → 401', async ({
  page,
  request,
}) => {
  const unique = Date.now().toString().slice(-9);
  const email = `api-${unique}@example.com`;
  const nickname = `api${unique}`;

  // Регистрация, подтверждение email и онбординг.
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

  // Создаём токен доступа в настройках.
  await page.goto('/settings');
  const section = page.getByTestId('api-access-section');
  await expect(section).toBeVisible();

  await page.locator('#api-token-name').fill('Home Assistant');
  await expect(page.getByTestId('api-scope-read')).toBeChecked();
  await page.getByTestId('api-token-create').click();

  const value = page.getByTestId('api-token-value');
  await expect(value).toBeVisible({ timeout: 15_000 });
  const apiToken = (await value.textContent())?.trim() ?? '';
  expect(apiToken.startsWith('puls_')).toBeTruthy();

  // Токен работает: /api/v1/me отвечает данными владельца.
  const me = await request.get(`${API_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  expect(me.status()).toBe(200);
  const meBody = (await me.json()) as { user: { nickname: string }; scopes: string[] };
  expect(meBody.user.nickname).toBe(nickname);
  expect(meBody.scopes).toContain('read');

  // Read-токен не пишет в /api/v1/transactions.
  const write = await request.post(`${API_URL}/api/v1/transactions`, {
    headers: { Authorization: `Bearer ${apiToken}` },
    data: { accountId: 'nope', type: 'expense', amount: 10 },
  });
  expect(write.status()).toBe(403);

  // Отзываем токен — доступ немедленно закрывается.
  await page.getByTestId('api-token-revoke').click();
  await expect(page.getByTestId('api-token-row')).toContainText('Отозван', { timeout: 15_000 });

  const revoked = await request.get(`${API_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  expect(revoked.status()).toBe(401);
});
