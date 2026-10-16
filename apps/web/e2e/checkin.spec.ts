// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 1.3 (ТЗ §3.3, §5 сценарий 1): чек-ин отвечается за пару кликов
// прямо с главной, история и расширенный ответ работают на /checkin.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

/**
 * Часовой пояс Etc/GMT±X, в котором сейчас утро (04:00–12:00). Вопрос о сне
 * задаётся только утром, поэтому браузер и онбординг ставим в утренний пояс.
 */
const MORNING_TIMEZONE = (() => {
  const utcHour = new Date().getUTCHours();
  for (const offset of [
    0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8, 9, -9, 10, -10, 11, -11, 12,
  ]) {
    const local = (utcHour + offset + 24) % 24;
    if (local < 4 || local >= 12) continue;
    if (offset === 0) return 'Etc/GMT';
    return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
  }
  return 'UTC';
})();

test.use({ timezoneId: MORNING_TIMEZONE });

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

async function signUpAndOnboard(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
): Promise<void> {
  const unique = Date.now().toString().slice(-9);
  const email = `checkin-${unique}@example.com`;
  const nickname = `chk${unique}`;

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
}

test('чек-ин отвечается за пару кликов с главной', async ({ page, request }) => {
  await signUpAndOnboard(page, request);

  // Карточка на главной: один клик по эмодзи — ответ сохранён.
  await expect(page.getByTestId('checkin-card')).toBeVisible();
  await page.getByTestId('mood-4').click();
  await expect(page.getByTestId('checkin-card-saved')).toBeVisible({ timeout: 15_000 });

  // Страница чек-инов: запись появилась в истории.
  await page.goto('/checkin');
  await expect(page.getByRole('heading', { name: 'Чек-ины', exact: true })).toBeVisible();
  await expect(page.getByTestId('checkin-history').getByRole('listitem').first()).toBeVisible();

  // Фаза 0: у шкалы есть словесные анкеры, а вопрос зависит от слота (тут утро).
  await expect(page.getByTestId('mood-anchor-1')).toHaveText('тяжело');
  await expect(page.getByTestId('mood-anchor-5')).toHaveText('отлично');
  await expect(page.getByTestId('checkin-question')).toHaveText(
    'Как ты чувствуешь себя прямо сейчас?',
  );

  // Фаза 0: расширенный блок закрыт по умолчанию, вода и шаги утром не спрашиваются.
  await expect(page.getByTestId('checkin-day-summary')).toBeHidden();
  await page.getByTestId('checkin-extended').click();
  await expect(page.getByTestId('checkin-day-summary')).toBeVisible();
  await expect(page.getByTestId('checkin-water')).toHaveCount(0);
  await expect(page.getByTestId('checkin-steps')).toHaveCount(0);

  // Расширенный чек-ин: настроение, итог дня и сохранение.
  await page.getByTestId('mood-5').click();
  await page.getByTestId('checkin-day-summary').fill('Успел на тренировку');
  await page.getByTestId('checkin-sleep').fill('7.5');
  await page.getByTestId('checkin-save').click();
  await expect(page.getByTestId('checkin-saved')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('checkin-history')).toContainText('Успел на тренировку');
  // История показывает полную запись, а не только настроение (ТЗ v2 §4).
  await expect(page.getByTestId('checkin-history')).toContainText('7.5');

  // Расписание: по умолчанию 3 раза в день, меняется на 5.
  await expect(page.getByTestId('checkin-times-per-day')).toHaveValue('3');
  await page.getByTestId('checkin-times-per-day').selectOption('5');
  await page.getByTestId('checkin-schedule-save').click();
  await expect(page.getByTestId('checkin-schedule-saved')).toBeVisible({ timeout: 15_000 });
});

test('Фаза 0: деньги понижены и помечены, маршруты финансов работают', async ({
  page,
  request,
}) => {
  await signUpAndOnboard(page, request);

  // Навигация: группа «Деньги» последняя и несёт видимую пометку «TODO: переделать».
  const badge = page.getByTestId('nav-todo-finance');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('TODO: переделать');

  const checkinBox = await page.getByTestId('nav-checkin').boundingBox();
  const financeBox = await page.getByTestId('nav-finance').boundingBox();
  expect(checkinBox, 'пункт «Чек-ин» есть в меню').toBeTruthy();
  expect(financeBox, 'пункт «Финансы» есть в меню').toBeTruthy();
  expect(checkinBox!.y).toBeLessThan(financeBox!.y);

  // Денежная карточка на главной помечена.
  await expect(page.getByTestId('goals-card-todo-finance')).toBeVisible();

  // Настройки: отдельная группа-модуль с пометкой.
  await page.goto('/settings');
  await expect(page.getByTestId('settings-todo-finance')).toHaveText('TODO: переделать');

  // Финансы не удаляем: маршрут открывается как раньше.
  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Финансы' })).toBeVisible();

  // Лендинг: деньги — последняя возможность, с пометкой про дополнительный модуль.
  await page.goto('/');
  await expect(page.getByTestId('landing-feature-money-note')).toContainText('TODO: переделать');
  await expect(page.getByRole('heading', { name: 'Пульс — дневник самочувствия' })).toBeVisible();
});
