// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 5, блок H (ТЗ §4, P2): челленджи — ведущий создаёт «30 дней без
// доставки», второй пользователь вступает по коду, оба ставят отметку
// «держусь», а ведущий видит общий рейтинг с двумя участниками.
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

async function signUpAndOnboard(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  prefix: string,
): Promise<string> {
  const unique = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
  const email = `${prefix}-${unique}@example.com`;
  const nickname = `${prefix.slice(0, 6)}${unique}`.slice(0, 20);

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

  return nickname;
}

test('челленджи: создание, вступление по коду, отметка и рейтинг', async ({ browser, request }) => {
  test.slow();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();

  try {
    const ownerNick = await signUpAndOnboard(owner, request, 'chowner');
    const memberNick = await signUpAndOnboard(member, request, 'chmember');

    // Ведущий создаёт челлендж из шаблона «30 дней без доставки».
    await owner.goto('/challenges');
    await expect(owner.getByRole('heading', { name: 'Челленджи' })).toBeVisible();
    await owner.getByTestId('challenge-template-no_delivery_30').click();
    await expect(owner.getByTestId('challenge-title')).toHaveValue('30 дней без доставки');
    await owner.getByTestId('challenge-create').click();

    const ownerCard = owner.getByTestId('challenge-card').first();
    await expect(ownerCard).toContainText('30 дней без доставки', { timeout: 15_000 });

    // Код приглашения с копированием.
    const code = (await ownerCard.getByTestId('challenge-invite-code').innerText()).trim();
    expect(code.startsWith('CH-')).toBeTruthy();

    // Участник вступает по коду и видит себя в челлендже.
    await member.goto('/challenges');
    await member.getByTestId('challenge-join-code').fill(code);
    await member.getByTestId('challenge-join').click();

    const memberCard = member.getByTestId('challenge-card').first();
    await expect(memberCard).toContainText('30 дней без доставки', { timeout: 15_000 });
    await expect(memberCard).toContainText('Участников: 2', { timeout: 15_000 });

    // Оба ставят отметку «держусь».
    await memberCard.getByTestId('challenge-check').click();
    await expect(memberCard).toContainText('Дней выдержки: 1', { timeout: 15_000 });

    await owner.reload();
    const reloadedOwnerCard = owner.getByTestId('challenge-card').first();
    await reloadedOwnerCard.getByTestId('challenge-check').click();
    await expect(reloadedOwnerCard).toContainText('Дней выдержки: 1', { timeout: 15_000 });

    // Рейтинг: ведущий видит оба никнейма со счётом.
    await reloadedOwnerCard.getByTestId('challenge-leaderboard-open').click();
    const board = reloadedOwnerCard.getByTestId('challenge-leaderboard');
    await expect(board).toBeVisible({ timeout: 15_000 });
    await expect(board).toContainText(`@${ownerNick}`);
    await expect(board).toContainText(`@${memberNick}`);
    await expect(board.getByTestId('challenge-leaderboard-entry')).toHaveCount(2);
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});
