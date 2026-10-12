// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E мобильной вёрстки (ТЗ §8, mobile-first). Гоняет каждую страницу на трёх
// айфонных ширинах и проверяет то, что ломается на телефоне: горизонтальный
// переполнитель, meta viewport с viewport-fit=cover, зону нажатия нижней
// навигации и font-size полей (iOS зумит страницу при < 16px).
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Secret12345';

const VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
] as const;

const PUBLIC_ROUTES = ['/', '/login', '/register', '/setup', '/forgot-password', '/reset-password'];

const APP_ROUTES = [
  '/app',
  '/finance',
  '/finance/import',
  '/finance/rates',
  '/finance/reconcile',
  '/goals',
  '/stats',
  '/checkin',
  '/habits',
  '/achievements',
  '/capsules',
  '/insights',
  '/ai',
  '/settings',
  '/app/profile',
  '/wrapped',
];

/** На телефоне страница не должна скроллиться по горизонтали. */
async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${label}: горизонтальное переполнение (scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

/** meta viewport обязателен: без него и без viewport-fit=cover не работают safe-area. */
async function expectViewportMeta(page: Page, label: string): Promise<void> {
  const content = await page.evaluate(
    () => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
  );
  expect(content, `${label}: нет meta viewport`).toContain('width=device-width');
  expect(
    content,
    `${label}: нет viewport-fit=cover — safe-area-inset-* всегда 0 на iPhone`,
  ).toContain('viewport-fit=cover');
}

/** Ни одно текстовое поле не должно быть < 16px — иначе iOS Safari зумит страницу. */
async function expectNoZoomingInputs(page: Page, label: string): Promise<void> {
  const small = await page.evaluate(() => {
    const selector =
      'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"]):not([type="file"]), select, textarea';
    const out: Array<{ tag: string; fs: number; name: string }> = [];
    document.querySelectorAll(selector).forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16)
        out.push({
          tag: el.tagName.toLowerCase(),
          fs,
          name: (el as HTMLInputElement).name || (el as HTMLInputElement).id,
        });
    });
    return out;
  });
  expect(small, `${label}: поля с font-size < 16px вызывают авто-зум в iOS`).toEqual([]);
}

/** Кнопки нижней навигации — не меньше 44×44 (ТЗ §8, крупные кнопки под палец). */
async function expectMobileNavTapTargets(page: Page, label: string): Promise<void> {
  const tooSmall = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label]');
    if (!nav || getComputedStyle(nav).display === 'none') return [];
    const out: Array<{ label: string; w: number; h: number }> = [];
    nav.querySelectorAll('a, button').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (rect.height < 44 || rect.width < 44)
        out.push({
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
    });
    return out;
  });
  expect(tooSmall, `${label}: зона нажатия в нижней навигации меньше 44px`).toEqual([]);
}

async function registerAndOnboard(page: Page): Promise<void> {
  const unique = Date.now().toString().slice(-9);
  await page.goto('/register');
  await page.getByLabel('Никнейм').fill(`mob${unique}`);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/onboarding/, { timeout: 30_000 });
  await expect(page.getByTestId('onboarding-step-1')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-next').click();
  await page.getByTestId('onboarding-finish').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}×${viewport.height})`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });

    test('публичные страницы: без горизонтального переполнения и с корректным viewport', async ({
      page,
    }) => {
      for (const route of PUBLIC_ROUTES) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await expectNoHorizontalOverflow(page, `${viewport.name} ${route}`);
        await expectViewportMeta(page, `${viewport.name} ${route}`);
      }
    });

    test('кабинет: без горизонтального переполнения, крупная навигация', async ({ page }) => {
      await registerAndOnboard(page);
      for (const route of APP_ROUTES) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await expectNoHorizontalOverflow(page, `${viewport.name} ${route}`);
        await expectViewportMeta(page, `${viewport.name} ${route}`);
        await expectMobileNavTapTargets(page, `${viewport.name} ${route}`);
      }
    });

    test('поля ввода не запускают авто-зум iOS', async ({ page }) => {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await expectNoZoomingInputs(page, `${viewport.name} /login`);
      await page.goto('/register', { waitUntil: 'domcontentloaded' });
      await expectNoZoomingInputs(page, `${viewport.name} /register`);

      await registerAndOnboard(page);
      // В нижней и боковой навигации есть одинаковые кнопки; на телефоне
      // боковая скрыта, поэтому жмём видимую.
      await page.locator('[data-testid="quick-add-open"]:visible').first().click();
      await expect(page.getByTestId('quick-add-sheet')).toBeVisible();
      await expectNoZoomingInputs(page, `${viewport.name} шторка быстрого ввода`);
      await expectNoHorizontalOverflow(page, `${viewport.name} шторка быстрого ввода`);
    });
  });
}
