// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 1.6 (ТЗ §6, §7, §8): тема, язык, манифест PWA, офлайн-страница.
import { expect, test } from '@playwright/test';

test.describe('тема', () => {
  test('переключается на тёмную и переживает перезагрузку', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    await page.getByRole('radio', { name: 'Тёмная' }).check({ force: true });
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.getByRole('radio', { name: 'Светлая' }).check({ force: true });
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('тема из cookie приходит уже в HTML — без вспышки', async ({ request }) => {
    const response = await request.get('/', { headers: { cookie: 'puls_theme=dark' } });
    expect(response.ok()).toBeTruthy();

    const html = await response.text();
    expect(html).toMatch(/<html[^>]*class="[^"]*dark/);
  });

  test('уважает prefers-reduced-motion в разметке', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const duration = await page.evaluate(() => {
      const probe = document.createElement('a');
      probe.className = 'transition-opacity duration-150';
      document.body.append(probe);
      const value = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return value;
    });

    // При reduced-motion длительность обнуляется (см. globals.css).
    const seconds = duration.endsWith('ms')
      ? Number.parseFloat(duration) / 1000
      : Number.parseFloat(duration);
    expect(seconds).toBeLessThan(0.05);
  });
});

test.describe('язык', () => {
  test('переключатель переводит лендинг на английский и запоминает выбор', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Пульс');

    await page.getByRole('radio', { name: 'English' }).check({ force: true });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Puls');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('radio', { name: 'English' })).toBeChecked();
  });

  test('локаль из заголовка Accept-Language', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    try {
      const page = await context.newPage();
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('даты и суммы форматируются по локали', async ({ request }) => {
    const ru = await (await request.get('/', { headers: { cookie: 'puls_locale=ru' } })).text();
    const en = await (await request.get('/', { headers: { cookie: 'puls_locale=en' } })).text();

    // Пример на лендинге — в евро: в ru знак после числа через пробел, в en — перед числом.
    expect(ru).toMatch(/415,00\s€/);
    expect(en).toContain('€415.00');
  });
});

test.describe('PWA', () => {
  test('манифест содержит имя, иконки 192/512 и maskable', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBeTruthy();

    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      display: string;
      icons: Array<{ sizes: string; purpose?: string }>;
    };

    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBeTruthy();
  });

  test('в HTML есть манифест, яблочные метатеги и иконка', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/icons/apple-touch-icon.png',
    );
  });

  test('офлайн-страница отвечает 200 и объясняет ситуацию', async ({ page }) => {
    const response = await page.goto('/offline');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'На главную' })).toBeVisible();
  });

  test('сервис-воркер отдаётся и предкеширует офлайн-страницу', async ({ request }) => {
    const response = await request.get('/sw.js');
    expect(response.ok()).toBeTruthy();

    const worker = await response.text();
    expect(worker).toContain('/offline');
  });

  test('сервис-воркер не обрабатывает push (уведомления идут в мессенджеры)', async ({
    request,
  }) => {
    const worker = await (await request.get('/sw.js')).text();
    expect(worker).not.toMatch(/addEventListener\(\s*["']push["']/);
    expect(worker).not.toContain('showNotification');
  });
});
