// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E аккаунтов (v3 §7): регистрация с логином и паролем → онбординг → кабинет
// → выход → повторный вход по логину. Почта необязательна, 2FA и вход через
// Telegram удалены, после регистрации сессия выдаётся сразу.
import { expect, test } from '@playwright/test';

const PASSWORD = 'Secret12345';

test('регистрация → онбординг → кабинет, выход и повторный вход по логину', async ({ page }) => {
  const unique = Date.now().toString().slice(-9);
  const nickname = `e2e${unique}`;

  // Шаг 1. Регистрация: логин, пароль, повтор пароля (почта необязательна).
  await page.goto('/register');
  await page.getByLabel('Никнейм').fill(nickname);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();

  // Регистрация выдаёт сессию сразу — email-подтверждение не требуется.
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });

  // Шаг 2. Онбординг: 4 шага с прогресс-баром.
  await expect(page.getByTestId('onboarding-step-1')).toBeVisible();
  await page.getByLabel('Валюта').selectOption('EUR');
  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-step-2')).toBeVisible();
  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-step-3')).toBeVisible();
  await page.getByTestId('onboarding-next').click();

  await expect(page.getByTestId('onboarding-step-4')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();

  // Шаг 3. Кабинет.
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();
  await expect(page.getByText(`@${nickname}`)).toBeVisible();

  // Шаг 4. Выход и повторный вход по логину.
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/login/, { timeout: 20_000 });

  await page.getByLabel('Логин или почта').fill(nickname);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByText(`@${nickname}`)).toBeVisible();
});
