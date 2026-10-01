// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 5, блок K (ТЗ §4, P2): голосовой чек-ин. Распознавание речи целиком
// на клиенте через Web Speech API, поэтому window.SpeechRecognition
// подменяется через addInitScript — тест проверяет наш код, а не браузер.
// Если API недоступен, кнопка микрофона скрыта и видна подсказка.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';
const TRANSCRIPT = 'Сегодня был спорт и я хорошо выспался';

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

async function signUpAndOnboard(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
): Promise<void> {
  const unique = Date.now().toString().slice(-9);
  const email = `voice-${unique}@example.com`;
  const nickname = `voi${unique}`;

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

test('голосовой чек-ин: диктовка заполняет заметку и предлагает теги', async ({
  page,
  request,
}) => {
  await page.addInitScript((transcript: string) => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;

      start(): void {
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript }]] });
          this.onend?.();
        }, 0);
      }

      stop(): void {}
      abort(): void {}
    }

    const speechWindow = window as unknown as Record<string, unknown>;
    speechWindow.SpeechRecognition = FakeRecognition;
    speechWindow.webkitSpeechRecognition = FakeRecognition;
  }, TRANSCRIPT);

  await signUpAndOnboard(page, request);

  await page.goto('/checkin');
  await expect(page.getByRole('heading', { name: 'Чек-ины', exact: true })).toBeVisible();

  // Диктовка в заметку: текст попадает в поле, теги предлагаются чипами.
  await page.getByTestId('checkin-note-voice').click();
  await expect(page.getByTestId('checkin-note')).toHaveValue(TRANSCRIPT, { timeout: 10_000 });

  const voiceTags = page.getByTestId('checkin-voice-tags');
  await expect(voiceTags).toBeVisible();
  await expect(voiceTags).toContainText('спорт');
  await expect(voiceTags).toContainText('сон');

  // Тег подтверждает пользователь: чип становится выбранным.
  const sportChip = page.getByTestId('checkin-voice-tag').filter({ hasText: 'спорт' });
  await expect(sportChip).toHaveAttribute('aria-pressed', 'false');
  await sportChip.click();
  await expect(sportChip).toHaveAttribute('aria-pressed', 'true');

  // Диктовка в итог дня заполняет «Что сегодня получилось?».
  await page.getByTestId('checkin-day-summary-voice').click();
  await expect(page.getByTestId('checkin-day-summary')).toHaveValue(TRANSCRIPT, {
    timeout: 10_000,
  });

  // Чек-ин сохраняется вместе с заметкой и подтверждённым тегом.
  await page.getByTestId('mood-4').click();
  await page.getByTestId('checkin-save').click();
  await expect(page.getByTestId('checkin-saved')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('checkin-history')).toContainText(TRANSCRIPT);
});

test('без Web Speech API кнопка микрофона скрыта с подсказкой', async ({ page, request }) => {
  await page.addInitScript(() => {
    // Форсируем отсутствие API: так проверяем деградацию интерфейса.
    const speechWindow = window as unknown as Record<string, unknown>;
    Object.defineProperty(speechWindow, 'SpeechRecognition', {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(speechWindow, 'webkitSpeechRecognition', {
      value: undefined,
      configurable: true,
    });
  });

  await signUpAndOnboard(page, request);

  await page.goto('/checkin');
  await expect(page.getByTestId('checkin-note-voice-unsupported')).toBeVisible();
  await expect(page.getByTestId('checkin-note-voice')).toHaveCount(0);
});
