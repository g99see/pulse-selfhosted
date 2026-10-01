// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E «Года в цифрах» (ТЗ §4, P2): экран открывается со статистики, слайды
// листаются кнопками и стрелками клавиатуры, суммы берутся из данных года.
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Secret12345';

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
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(letter?.link ?? letter?.text ?? '')?.[1];
  expect(token, 'в письме должна быть ссылка с токеном').toBeTruthy();
  return token as string;
}

test('год в цифрах: слайды листаются кнопками и клавиатурой', async ({ page, request }) => {
  const unique = Date.now().toString().slice(-9);
  const email = `wrapped-${unique}@example.com`;
  const nickname = `wrapped${unique}`;

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

  // Трата, чтобы год был непустым.
  await page.getByTestId('quick-add-open').first().click();
  await expect(page.getByTestId('quick-add-sheet')).toBeVisible();
  await page.getByTestId('quick-add-text').fill('обед 450');
  await page.getByTestId('quick-add-submit').click();
  await expect(page.getByTestId('quick-add-sheet')).toBeHidden({ timeout: 15_000 });

  // Переход со статистики на «Год в цифрах».
  await page.goto('/stats');
  await page.getByTestId('stats-wrapped-link').click();
  await expect(page).toHaveURL(/\/wrapped$/);
  await expect(page.getByRole('heading', { name: 'Год в цифрах', level: 1 })).toBeVisible();

  // Первый слайд — обложка.
  await expect(page.getByTestId('wrapped-slide')).toHaveAttribute('data-slide', 'cover');

  // Кнопка «Дальше» — слайд денег с суммой траты.
  await page.getByTestId('wrapped-next').click();
  await expect(page.getByTestId('wrapped-slide')).toHaveAttribute('data-slide', 'money');
  await expect(page.getByTestId('wrapped-spent')).toContainText('450');

  // Стрелка вправо и влево переключают слайды.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('wrapped-slide')).toHaveAttribute('data-slide', 'categories');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('wrapped-slide')).toHaveAttribute('data-slide', 'money');

  // На обложке «Назад» недоступна.
  await page.getByTestId('wrapped-prev').click();
  await expect(page.getByTestId('wrapped-prev')).toBeDisabled();
});
