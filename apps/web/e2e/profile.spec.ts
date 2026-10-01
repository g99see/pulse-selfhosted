// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 3 (ТЗ §3.7): публичный профиль по адресу /@nickname. Пользователь
// делает карточку накоплений публичной, а карточку настроения оставляет
// закрытой; анонимный гость видит только публичную карточку.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

async function verificationTokenFor(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<string> {
  const response = await request.get(`${API_URL}/api/auth/dev/outbox`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { messages: Array<{ to: string; link?: string; text: string; kind?: string }> };
  const letter = [...body.messages]
    .reverse()
    .find((message) => message.to === email && message.kind === 'email-verification');
  expect(letter, `письмо для ${email} должно быть в outbox`).toBeTruthy();
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(letter?.link ?? letter?.text ?? '')?.[1];
  expect(token).toBeTruthy();
  return token as string;
}

test('публичный профиль: приватность карточек решает показ', async ({ page, request, browser }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `profile-${unique}@example.com`;
  const nickname = `prof${unique}`;

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
  // Шаг 3: выбираем цель и делаем профиль публичным.
  await page.getByRole('checkbox').first().check();
  await page.locator('#visibility').selectOption('public');
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  // Редактор профиля: публикуем накопления, настроение оставляем закрытым.
  await page.goto('/app/profile');
  await expect(page.getByTestId('profile-card-savings')).toBeVisible({ timeout: 20_000 });
  await page.locator('#profile-visibility-savings').selectOption('public');
  await page.locator('#profile-visibility-avg_mood').selectOption('private');
  await page.getByTestId('profile-save').click();
  await expect(page.getByText('Профиль сохранён.')).toBeVisible({ timeout: 15_000 });

  // Анонимный гость на коротком адресе /@nickname.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`/@${nickname}`);
  await expect(guestPage.getByTestId('public-profile')).toBeVisible({ timeout: 20_000 });
  await expect(guestPage.getByTestId('public-card-savings')).toBeVisible();
  // Скрытая карточка настроения гостю не показывается.
  await expect(guestPage.getByTestId('public-card-avg_mood')).toHaveCount(0);
  await guest.close();
});
