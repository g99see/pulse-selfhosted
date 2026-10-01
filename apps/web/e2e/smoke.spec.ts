// SPDX-License-Identifier: AGPL-3.0-or-later
// Smoke e2e (ТЗ §7: Playwright для ключевых сценариев). Полные сценарии 1 и 2 — в Фазе 1.
import { expect, test } from '@playwright/test';

test('лендинг отвечает 200 и показывает обещание продукта', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Пульс');
  await expect(page.getByRole('link', { name: 'Начать' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Бюджет месяца' })).toBeVisible();
});
