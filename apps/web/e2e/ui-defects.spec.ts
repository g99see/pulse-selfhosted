// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E по отчёту QA-2: понятные экраны ошибок (D2), ошибка валидации у шкалы
// (D3), заполнение задним числом (D4) и мелкие дефекты (D5–D9).
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';
/** Пояс и браузера, и профиля: онбординг берёт пояс устройства. */
const TZ = 'Europe/Berlin';
/** Второй web-инстанс с недоступным API: воспроизводит «API упал» (QA-2 D2). */
const DOWN_URL = 'http://localhost:3199';
const DEAD_API = 'http://127.0.0.1:3999';

test.use({ timezoneId: TZ });

interface SentMail {
  to: string;
  kind?: string;
  text: string;
  link?: string;
}

async function verificationTokenFor(request: APIRequestContext, email: string): Promise<string> {
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

async function signUpAndOnboard(page: Page, request: APIRequestContext): Promise<void> {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `ui-${unique}@example.com`;
  const nickname = `ui${unique}`;

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

/** Настенные часы пояса в формате `<input type="datetime-local">`. */
function wallClock(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  const hour = read('hour') === '24' ? '00' : read('hour');
  return `${read('year')}-${read('month')}-${read('day')}T${hour}:${read('minute')}`;
}

/** Как страница показывает момент в истории. */
function historyLabel(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

test.describe('QA-2 D3/D4/D5/D6/D8 — страница чек-ина', () => {
  test('D3: ошибка «нет настроения» видна у шкалы, фокус подводится к ней', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await signUpAndOnboard(page, request);
    await page.goto('/checkin');
    await expect(page.getByTestId('checkin-page')).toBeVisible();

    // Прокручиваем к кнопке сохранения — как в отчёте QA-2.
    await page.getByTestId('checkin-save').scrollIntoViewIfNeeded();
    await page.getByTestId('checkin-save').click();

    const error = page.getByTestId('checkin-mood-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('выберите настроение');
    // Сообщение должно быть в поле зрения, а не в начале страницы.
    await expect(error).toBeInViewport();
    const box = await error.boundingBox();
    expect(box, 'сообщение об ошибке должно иметь геометрию').toBeTruthy();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(664);

    // Фокус уходит на шкалу настроения: кнопка «оживает».
    const focusedTestId = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? '',
    );
    expect(focusedTestId).toMatch(/^mood-[1-5]$/);
    await expect(page.getByTestId('mood-scale')).toHaveAttribute('aria-invalid', 'true');

    // Выбор настроения снимает ошибку.
    await page.getByTestId('mood-4').click();
    await expect(error).toBeHidden();
  });

  test('D3: клик по «Сохранить» отвечает индикатором и блокирует кнопку', async ({
    page,
    request,
  }) => {
    await signUpAndOnboard(page, request);
    await page.goto('/checkin');
    await page.getByTestId('mood-4').click();

    await page.route('**/api/checkins', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
      }
      await route.continue();
    });

    const save = page.getByTestId('checkin-save');
    await save.click();
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('checkin-save-spinner')).toBeVisible();
    await expect(save).toContainText('Сохраняем');
    await expect(page.getByTestId('checkin-saved')).toBeVisible({ timeout: 15_000 });
    await expect(save).toBeEnabled();
  });

  test('D6: «Записал!» сбрасывается при следующем взаимодействии', async ({ page, request }) => {
    await signUpAndOnboard(page, request);
    await page.goto('/checkin');
    await page.getByTestId('mood-5').click();
    await page.getByTestId('checkin-save').click();
    await expect(page.getByTestId('checkin-saved')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('mood-2').click();
    await expect(page.getByTestId('checkin-saved')).toBeHidden();
  });

  test('D4: заполнение задним числом в поясе профиля, окно 24 часа', async ({ page, request }) => {
    await signUpAndOnboard(page, request);
    await page.goto('/checkin');
    // Фаза 0: расширенный блок закрыт по умолчанию — раскрываем «Углубить».
    await page.getByTestId('checkin-extended').click();

    const field = page.getByTestId('checkin-occurred-at');
    await expect(field).toBeVisible();
    const { min, max } = await field.evaluate((element) => ({
      min: (element as HTMLInputElement).min,
      max: (element as HTMLInputElement).max,
    }));
    expect(min, 'нижняя граница окна задана').toBeTruthy();
    expect(max, 'верхняя граница окна задана').toBeTruthy();
    const windowHours = (Date.parse(`${max}:00Z`) - Date.parse(`${min}:00Z`)) / 3_600_000;
    expect(Math.abs(windowHours - 24)).toBeLessThanOrEqual(1);

    // Подсказка объясняет окно и пояс.
    await expect(page.getByTestId('checkin-backdate')).toContainText(TZ);
    await expect(page.getByTestId('checkin-backdate')).toContainText('последних 24 часов');

    // Момент — два часа назад (в пределах окна).
    const target = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await field.fill(wallClock(target));
    await page.getByTestId('mood-3').click();

    const [post] = await Promise.all([
      page.waitForRequest(
        (candidate) => candidate.url().includes('/api/checkins') && candidate.method() === 'POST',
      ),
      page.getByTestId('checkin-save').click(),
    ]);
    const body = JSON.parse(post.postData() ?? '{}') as { occurredAt?: string };
    expect(body.occurredAt, 'occurredAt уходит на сервер').toBeTruthy();
    expect(Math.abs(Date.parse(body.occurredAt!) - target.getTime())).toBeLessThan(60_000);

    // История показывает именно выбранный момент, а не «сейчас».
    await expect(page.getByTestId('checkin-history')).toContainText(historyLabel(target), {
      timeout: 15_000,
    });
    // После сохранения поле снова пустое («сейчас»).
    await expect(field).toHaveValue('');
  });

  test('D4: поле не принимает время вне окна 24 часа', async ({ page, request }) => {
    await signUpAndOnboard(page, request);
    await page.goto('/checkin');
    // Фаза 0: расширенный блок закрыт по умолчанию — раскрываем «Углубить».
    await page.getByTestId('checkin-extended').click();

    const field = page.getByTestId('checkin-occurred-at');
    // 30 часов назад — вне окна.
    await field.fill(wallClock(new Date(Date.now() - 30 * 60 * 60 * 1000)));
    await expect(page.getByTestId('checkin-backdate-error')).toBeVisible();
    await expect(page.getByTestId('checkin-backdate-error')).toContainText('24');
  });

  test('D5: у истории есть индикатор загрузки и aria-busy', async ({ page, request }) => {
    await signUpAndOnboard(page, request);
    await page.route('**/api/checkins?*', async (route) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
      await route.continue();
    });

    await page.goto('/checkin');
    await expect(page.getByTestId('checkin-history-loading')).toBeVisible();
    const busy = page.locator('section[aria-busy]').first();
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('checkin-history-loading')).toBeHidden({ timeout: 15_000 });
  });

  test('D8: шкала — radiogroup с roving tabindex и стрелками', async ({ page, request }) => {
    await signUpAndOnboard(page, request);
    await page.goto('/checkin');

    const scale = page.getByTestId('mood-scale');
    await expect(scale).toHaveAttribute('role', 'radiogroup');

    // До выбора в табуляции ровно одна кнопка — первая.
    const tabIndexes = async (): Promise<string[]> =>
      scale
        .locator('button')
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLButtonElement).tabIndex.toString()),
        );
    expect(await tabIndexes()).toEqual(['0', '-1', '-1', '-1', '-1']);

    await page.getByTestId('mood-3').click();
    await page.getByTestId('mood-3').press('ArrowRight');
    await expect(page.getByTestId('mood-4')).toHaveAttribute('aria-checked', 'true');
    // mood-4 — четвёртая кнопка: в табуляции только она.
    expect(await tabIndexes()).toEqual(['-1', '-1', '-1', '0', '-1']);
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? '',
    );
    expect(focused).toBe('mood-4');

    await page.getByTestId('mood-4').press('Home');
    await expect(page.getByTestId('mood-1')).toHaveAttribute('aria-checked', 'true');
  });

  test('D8: на главной шкала — действие, а не radiogroup', async ({ page, request }) => {
    await signUpAndOnboard(page, request);
    await expect(page.getByTestId('checkin-card')).toBeVisible();
    await expect(page.getByTestId('mood-scale')).toHaveAttribute('role', 'group');
    await expect(page.getByTestId('mood-4')).not.toHaveAttribute('role', 'radio');
  });

  test('D7: основной текст не меньше 14px', async ({ page, request }) => {
    await signUpAndOnboard(page, request);

    for (const path of ['/checkin', '/app']) {
      await page.goto(path);
      await expect(
        page.getByTestId(path === '/app' ? 'checkin-card' : 'checkin-page'),
      ).toBeVisible();
      const tooSmall = await page.evaluate(() => {
        const offenders: string[] = [];
        for (const element of Array.from(document.querySelectorAll('body *'))) {
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (element.getAttribute('aria-hidden') === 'true') continue;
          const classes = element.getAttribute('class') ?? '';
          // Подписи-капшены (необязательные пояснения) живут на 12px.
          if (classes.includes('text-caption')) continue;
          if (classes.includes('sr-only')) continue;
          const hasOwnText = Array.from(element.childNodes).some(
            (node) =>
              node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0,
          );
          if (!hasOwnText) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (Number.parseFloat(style.fontSize) < 14) {
            offenders.push(`${element.tagName}.${element.className}: ${style.fontSize}`);
          }
        }
        return offenders;
      });
      expect(tooSmall, `мелкий текст на ${path}`).toEqual([]);
    }
  });
});

test.describe('QA-2 D9 — тап-таргеты', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('D9: логотип в сайдбаре не меньше 44px по высоте', async ({ page, request }) => {
    await signUpAndOnboard(page, request);
    const logo = page.locator('aside a[href="/app"]').first();
    await expect(logo).toBeVisible();
    const box = await logo.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('QA-2 D2 — экраны ошибок вместо «Application error»', () => {
  // Второй web-инстанс один на прогон: параллельные воркеры не могут делить порт.
  test.describe.configure({ mode: 'serial' });
  let downWeb: ChildProcess | null = null;

  async function isUp(url: string): Promise<boolean> {
    try {
      const response = await fetch(url);
      return response.status > 0;
    } catch {
      return false;
    }
  }

  test.beforeAll(async () => {
    // Инстанс мог остаться от прошлого прогона — тогда просто пользуемся им.
    if (await isUp(DOWN_URL)) return;

    const log = openSync('/tmp/puls-down-web.log', 'a');
    downWeb = spawn(
      resolve(__dirname, '..', 'node_modules', '.bin', 'next'),
      ['start', '--port', '3199'],
      {
        cwd: resolve(__dirname, '..'),
        env: { ...process.env, API_INTERNAL_URL: DEAD_API },
        stdio: ['ignore', log, log],
      },
    );

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await isUp(DOWN_URL)) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error('второй web-инстанс не поднялся: /tmp/puls-down-web.log');
  });

  test.afterAll(() => {
    downWeb?.kill('SIGTERM');
    downWeb = null;
  });

  test('D2: API недоступен — понятный экран с повтором, без «Application error»', async ({
    page,
    request,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signUpAndOnboard(page, request);
    await page.goto(`${DOWN_URL}/checkin`);

    await expect(page.getByTestId('api-unavailable')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('api-unavailable-retry')).toBeVisible();
    await expect(page.getByTestId('api-unavailable')).toContainText('Сервис недоступен');
    await expect(page.locator('body')).not.toContainText('Application error');
    expect(pageErrors).toEqual([]);
  });

  test('D2: ошибка рендера страницы ловится границей ошибок', async ({ page, request }) => {
    await signUpAndOnboard(page, request);

    // Ломаем вызов, который страница чек-ина делает при монтировании.
    await page.addInitScript(() => {
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', {
        configurable: true,
        value: () => {
          throw new Error('e2e-boom');
        },
      });
    });

    await page.goto('/checkin');
    await expect(page.getByTestId('app-error')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('app-error')).toContainText('Что-то пошло не так');
    await expect(page.getByTestId('app-error-retry')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
