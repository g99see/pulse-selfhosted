// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 2 (ТЗ §6): привязка бота одной кнопкой. Из настроек берём deep-link
// подключения (кнопка «Подключить» — это ссылка <a href>), извлекаем из неё
// токен, шлём боту /start <токен> через его же вебхук (реальный HTTP, без сети
// Telegram) и убеждаемся, что экран сам переключился на «привязан» (опрос статуса)
// без ручного обновления. Отвязка возвращает исходное состояние.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const WEBHOOK_SECRET = process.env.E2E_TELEGRAM_WEBHOOK_SECRET ?? 'e2e-telegram-secret';
const BOT_USERNAME = process.env.E2E_TELEGRAM_BOT_USERNAME;
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

test('привязка Telegram-чата одной кнопкой из настроек и отвязка', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `tg-${unique}@example.com`;
  const nickname = `tg${unique}`;

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

  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-4')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  await page.goto('/settings');
  await expect(page.getByTestId('channel-telegram')).toBeVisible();

  // Без настроенного бота секция честно сообщает об этом — этого достаточно.
  // Сначала ждём, пока статус бота загрузится (одно из двух состояний), иначе
  // мгновенный isVisible() ловит промежуточный кадр и тест выбирает не ту ветку.
  const connect = page.getByTestId('telegram-connect');
  await expect(connect.or(page.getByTestId('telegram-disabled'))).toBeVisible();
  if (!(await connect.isVisible())) {
    await expect(page.getByTestId('telegram-disabled')).toBeVisible();
    return;
  }

  // 1. Кнопка подключения — это якорь с deep-link. Читаем URL из href или из
  // скрытого span (ссылка появляется, как только статус загрузился).
  const urlSpan = page.getByTestId('telegram-connect-url');
  await expect(urlSpan).toHaveText(/start=/, { timeout: 20_000 });
  const url = (await urlSpan.textContent())?.trim() ?? '';
  expect(url).toMatch(/^https:\/\/t\.me\//);
  if (BOT_USERNAME) {
    expect(url).toContain(`https://t.me/${BOT_USERNAME}?start=`);
  }
  const href = await connect.getAttribute('href');
  expect(href).toBe(url);

  const startToken = /[?&]?start=([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? '';
  expect(startToken).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

  // 2. Шлём боту /start <токен> через вебхук — как это сделал бы Telegram.
  const chatId = Number(`7${unique}`);
  const start = await request.post(`${API_URL}/api/telegram/webhook`, {
    headers: { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
    data: {
      update_id: chatId,
      message: {
        chat: { id: chatId },
        from: { username: 'e2e_tg_user' },
        text: `/start ${startToken}`,
      },
    },
  });
  expect(start.ok()).toBeTruthy();

  // 3. Экран обновляется сам (опрос статуса), без кнопки «Обновить статус».
  await expect(page.getByTestId('telegram-linked')).toBeVisible({ timeout: 20_000 });
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
