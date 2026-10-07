// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 5 (ТЗ §4, P2): капсула времени. Создаём письмо себе на месяц вперёд,
// убеждаемся, что капсула закрыта и тело не отдаётся, затем открываем её
// dev-хуком (не дожидаясь open_at) и читаем расшифрованное письмо со
// статистикой периода.
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

test('капсула времени: письмо скрыто до открытия и читается после', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `capsule-${unique}@example.com`;
  const nickname = `caps${unique}`;
  const secret = `Секрет мыслей ${unique}: копи на отпуск и не сдавайся.`;

  // Регистрация, подтверждение email и онбординг.
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByLabel('Никнейм').fill(nickname);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

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

  // Создаём капсулу на месяц вперёд.
  await page.goto('/capsules');
  await expect(page.getByRole('heading', { name: 'Капсулы времени' })).toBeVisible();

  await page.getByTestId('capsule-title').fill('Письмо себе');
  await page.getByTestId('capsule-body-input').fill(secret);
  await page.getByTestId('capsule-create').click();

  const card = page.getByTestId('capsule-card').first();
  await expect(card).toContainText('Письмо себе', { timeout: 15_000 });
  await expect(card).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('capsule-countdown')).toBeVisible();

  // Тело письма не отдаётся и не показывается, пока капсула закрыта.
  await expect(page.getByTestId('capsule-letter')).toHaveCount(0);
  await expect(page.getByText(secret)).toHaveCount(0);

  const capsuleId = await card.getAttribute('data-capsule-id');
  expect(capsuleId).toBeTruthy();

  // Открываем капсулу dev-хуком (вместо ожидания open_at).
  const status = await page.evaluate(
    async ({ apiUrl, id }) => {
      const csrf = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('puls_csrf='))
        ?.slice('puls_csrf='.length);
      const response = await fetch(`${apiUrl}/api/capsules/${id}/dev-open`, {
        method: 'POST',
        credentials: 'include',
        headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {},
      });
      return response.status;
    },
    { apiUrl: API_URL, id: capsuleId as string },
  );
  expect([200, 201]).toContain(status);

  // После открытия письмо и статистика периода доступны на экране.
  await page.reload();
  await expect(page.getByTestId('capsule-letter')).toContainText(secret, { timeout: 15_000 });
  await expect(page.getByTestId('capsule-snapshot')).toBeVisible();
  await expect(page.getByTestId('capsule-snapshot')).toContainText('Статистика периода');
});
