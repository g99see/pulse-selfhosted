// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 2 (ТЗ §3.6, §4): из настроек получаем код привязки Telegram, шлём
// боту /start <код> через его же вебхук (реальный HTTP, без сети Telegram) и
// убеждаемся, что чат привязался, а отвязка возвращает исходное состояние.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const WEBHOOK_SECRET = process.env.E2E_TELEGRAM_WEBHOOK_SECRET ?? 'e2e-telegram-secret';
const PASSWORD = 'Secret12345';

async function verificationTokenFor(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.get(`${API_URL}/api/auth/dev/outbox`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    messages: { to: string; kind?: string; link?: string; text: string }[];
  };
  const letter = [...body.messages]
    .reverse()
    .find((message) => message.to === email && message.kind === 'email-verification');
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(
    letter?.link ?? letter?.text ?? '',
  )?.[1];
  expect(token, 'в письме должна быть ссылка с токеном').toBeTruthy();
  return token as string;
}

test('привязка Telegram-чата из настроек и отвязка', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `tg-${unique}@example.com`;
  const nickname = `tg${unique}`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(PASSWORD);
  await page.getByLabel('Никнейм').fill(nickname);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/verify-email/);

  const token = await verificationTokenFor(request, email);
  await page.goto(`/verify-email?token=${token}`);
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-4')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  await page.goto('/settings');
  await expect(page.getByTestId('telegram-section')).toBeVisible();

  // Без настроенного бота секция честно сообщает об этом — этого достаточно.
  // Сначала ждём, пока статус бота загрузится (одно из двух состояний), иначе
  // мгновенный isVisible() ловит промежуточный кадр и тест выбирает не ту ветку.
  const linkButton = page.getByTestId('telegram-link');
  await expect(linkButton.or(page.getByTestId('telegram-disabled'))).toBeVisible();
  if (!(await linkButton.isVisible())) {
    await expect(page.getByTestId('telegram-disabled')).toBeVisible();
    return;
  }

  // 1. Получаем одноразовый код привязки.
  await page.getByTestId('telegram-link').click();
  const codeElement = page.getByTestId('telegram-code');
  await expect(codeElement).toBeVisible();
  const code = (await codeElement.textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Za-z0-9_-]{8,32}$/);

  // 2. Шлём боту /start <код> через вебхук — как это сделал бы Telegram.
  const chatId = Number(`7${unique}`);
  const start = await request.post(`${API_URL}/api/telegram/webhook`, {
    headers: { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
    data: {
      update_id: chatId,
      message: {
        chat: { id: chatId },
        from: { username: 'e2e_tg_user' },
        text: `/start ${code}`,
      },
    },
  });
  expect(start.ok()).toBeTruthy();

  // 3. Обновляем статус — чат привязан.
  await page.getByTestId('telegram-refresh').click();
  await expect(page.getByTestId('telegram-linked')).toBeVisible();
  await expect(page.getByTestId('telegram-linked')).toContainText('e2e_tg_user');

  // Вебхук без секретного заголовка отклоняется.
  const forbidden = await request.post(`${API_URL}/api/telegram/webhook`, {
    data: { update_id: 1 },
  });
  expect(forbidden.status()).toBe(403);

  // 4. Отвязка возвращает экран к исходному состоянию.
  await page.getByTestId('telegram-unlink').click();
  await expect(page.getByTestId('telegram-unlinked')).toBeVisible();
});
