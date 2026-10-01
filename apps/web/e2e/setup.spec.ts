// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E мастера первого запуска (ТЗ §9 п.7, §10). Мастер доступен только на
// пустом инстансе, а e2e-БД общая с другими сценариями, поэтому сам мастер
// проверяем с подменой ответов API, а «инстанс уже настроен» — против живого API.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';

test.describe('мастер первого запуска (UI, подмена API)', () => {
  test('уводит с лендинга и логина на /setup, когда инстанс пуст', async ({ page }) => {
    await page.route('**/api/setup/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ needsSetup: true, registrationMode: 'open' }),
      }),
    );

    await page.goto('/login');
    await expect(page).toHaveURL(/\/setup$/, { timeout: 10_000 });
    await expect(page.getByTestId('setup-form')).toBeVisible();
  });

  test('создаёт администратора и показывает подтверждение', async ({ page }) => {
    await page.route('**/api/setup/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ needsSetup: true, registrationMode: 'open' }),
      }),
    );
    await page.route('**/api/auth/csrf', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'set-cookie': 'puls_csrf=test-csrf; Path=/' },
        body: JSON.stringify({ csrfToken: 'test-csrf' }),
      }),
    );
    await page.route('**/api/setup', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'setup-admin',
            email: 'admin@example.com',
            nickname: 'root',
            role: 'admin',
          },
        }),
      }),
    );

    await page.goto('/setup');
    await page.getByLabel('Email администратора').fill('admin@example.com');
    await page.getByLabel('Пароль').fill('Secret12345');
    await page.getByLabel('Никнейм').fill('root');
    await page.getByTestId('setup-submit').click();

    await expect(page.getByTestId('setup-done')).toBeVisible({ timeout: 10_000 });
  });

  test('на настроенном инстансе показывает, что мастер недоступен', async ({ page }) => {
    await page.route('**/api/setup/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ needsSetup: false, registrationMode: 'open' }),
      }),
    );

    await page.goto('/setup');
    await expect(page.getByTestId('setup-already')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: 'Ко входу' })).toBeVisible();
  });
});

test.describe('мастер первого запуска (живой API)', () => {
  test('POST /api/setup на настроенном инстансе закрыт навсегда', async ({ request }) => {
    const statusResponse = await request.get(`${API_URL}/api/setup/status`);
    expect(statusResponse.ok()).toBeTruthy();
    const status = (await statusResponse.json()) as { needsSetup: boolean; registrationMode: string };
    expect(['open', 'invite', 'closed']).toContain(status.registrationMode);

    const csrfResponse = await request.get(`${API_URL}/api/auth/csrf`);
    const setCookie = csrfResponse.headers()['set-cookie'] ?? '';
    const token = /puls_csrf=([^;]+)/.exec(setCookie)?.[1] ?? '';

    const response = await request.post(`${API_URL}/api/setup`, {
      headers: { 'X-CSRF-Token': token },
      data: { email: 'late-admin@example.com', password: 'Secret12345', nickname: 'lateadmin' },
    });

    if (status.needsSetup) {
      // Свежий инстанс — мастер должен создать администратора.
      expect(response.status()).toBe(201);
    } else {
      expect(response.status()).toBe(409);
      expect(((await response.json()) as { code: string }).code).toBe('setup_completed');
    }
  });
});
