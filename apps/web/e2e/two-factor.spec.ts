// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E 2FA (ТЗ §6): включаем TOTP через API, затем входим в браузере с вторым
// фактором (резервный код — он не зависит от окна времени TOTP).
import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

/** base32 → Buffer (RFC 4648, без padding). */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.replace(/[\s=]/g, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function csrfToken(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${API_URL}/api/auth/csrf`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { csrfToken: string }).csrfToken;
}

async function verificationTokenFor(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.get(`${API_URL}/api/auth/dev/outbox`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    messages: Array<{ to: string; kind?: string; link?: string; text?: string }>;
  };
  const letter = [...body.messages]
    .reverse()
    .find((message) => message.to === email && message.kind === 'email-verification');
  expect(letter, `письмо для ${email}`).toBeTruthy();
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(letter?.link ?? letter?.text ?? '')?.[1];
  expect(token).toBeTruthy();
  return token as string;
}

async function completeOnboarding(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<void> {
  const response = await request.put(`${API_URL}/api/auth/onboarding`, {
    headers,
    data: {
      timezone: 'UTC',
      currency: 'RUB',
      locale: 'ru',
      goals: ['money'],
      notificationsEnabled: true,
      quietHoursStart: 22,
      quietHoursEnd: 8,
      profileVisibility: 'private',
      firstAccount: { name: 'Основной', type: 'card', balance: 0 },
    },
  });
  expect(response.ok()).toBeTruthy();
}

test('вход с включённой 2FA: пароль → код → кабинет', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `e2e-2fa-${unique}@example.com`;
  const nickname = `e2fa${unique}`;

  // 1. Регистрация и подтверждение email через API.
  const csrf = await csrfToken(request);
  const headers = { 'x-csrf-token': csrf };
  const registered = await request.post(`${API_URL}/api/auth/register`, {
    headers,
    data: { email, password: PASSWORD, nickname },
  });
  expect(registered.status()).toBe(201);

  const verify = await request.post(`${API_URL}/api/auth/verify-email`, {
    headers,
    data: { token: await verificationTokenFor(request, email) },
  });
  expect(verify.ok()).toBeTruthy();
  await completeOnboarding(request, headers);

  // 2. Включаем 2FA: setup → код → enable → резервные коды.
  const setupResponse = await request.post(`${API_URL}/api/auth/2fa/setup`, { headers });
  expect(setupResponse.ok()).toBeTruthy();
  const setup = (await setupResponse.json()) as {
    secret: string;
    otpauthUri: string;
    qrDataUrl: string | null;
  };
  expect(setup.otpauthUri).toContain('otpauth://totp/');
  expect(setup.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);

  const enable = await request.post(`${API_URL}/api/auth/2fa/enable`, {
    headers,
    data: { code: totp(setup.secret) },
  });
  expect(enable.ok()).toBeTruthy();
  const { backupCodes } = (await enable.json()) as { backupCodes: string[] };
  expect(backupCodes).toHaveLength(10);

  // 3. Вход в браузере: сначала пароль, затем второй фактор (резервный код).
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();

  // Появился шаг второго фактора.
  const codeField = page.getByLabel('Код');
  await expect(codeField).toBeVisible({ timeout: 15_000 });
  await codeField.fill(backupCodes[0]);
  await page.getByRole('button', { name: 'Подтвердить' }).click();

  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByText(`@${nickname}`)).toBeVisible();
});

test('без 2FA вход прежний (только пароль)', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `e2e-no2fa-${unique}@example.com`;
  const nickname = `eno2fa${unique}`;

  const csrf = await csrfToken(request);
  const headers = { 'x-csrf-token': csrf };
  await request.post(`${API_URL}/api/auth/register`, {
    headers,
    data: { email, password: PASSWORD, nickname },
  });
  await request.post(`${API_URL}/api/auth/verify-email`, {
    headers,
    data: { token: await verificationTokenFor(request, email) },
  });
  await completeOnboarding(request, headers);

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByText(`@${nickname}`)).toBeVisible();
});
