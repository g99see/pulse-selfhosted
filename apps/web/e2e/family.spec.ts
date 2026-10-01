// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E Фазы 4, блок D (ТЗ §4): семья на домашнем сервере — общий счёт и общая
// цель на двоих, при этом личный дневник участника другому не виден.
// Второй пользователь вступает по одноразовому коду, вносит взнос в общую цель,
// а владелец в своей истории чек-инов не видит его личную запись.
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
  const token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(
    letter?.link ?? letter?.text ?? '',
  )?.[1];
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

/** Личный чек-ин с уникальной заметкой — чтобы отличать данные участников. */
async function writeCheckIn(page: import('@playwright/test').Page, note: string): Promise<void> {
  await page.goto('/checkin');
  await page.getByTestId('mood-4').click();
  await page.getByTestId('checkin-day-summary').fill(note);
  await page.getByTestId('checkin-save').click();
  await expect(page.getByTestId('checkin-saved')).toBeVisible({ timeout: 15_000 });
}

test('семья: общий счёт и цель на двоих, личный дневник скрыт', async ({ browser, request }) => {
  test.slow();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();

  try {
    await signUpAndOnboard(owner, request, 'famowner');
    await signUpAndOnboard(member, request, 'fammember');

    // У обоих — по личной записи дневника; они не должны смешиваться.
    const memberNote = `Личная запись участника ${Date.now()}`;
    await writeCheckIn(owner, 'Личная запись владельца');
    await writeCheckIn(member, memberNote);

    // Владелец создаёт семью и получает одноразовый код.
    await owner.goto('/family');
    await expect(owner.getByRole('heading', { name: 'Семья', exact: true })).toBeVisible();
    await owner.getByTestId('family-name').fill('Наш дом');
    await owner.getByTestId('family-create').click();
    await expect(owner.getByTestId('family-name-label')).toContainText('Наш дом', {
      timeout: 15_000,
    });
    await expect(owner.getByTestId('family-member')).toHaveCount(1);

    await owner.getByTestId('family-invite-create').click();
    const code = (await owner.getByTestId('family-invite-code').innerText()).trim();
    expect(code.startsWith('FAM-')).toBeTruthy();

    // Участник вступает по коду и видит двоих в семье.
    await member.goto('/family');
    await member.getByTestId('family-join-code').fill(code);
    await member.getByTestId('family-join').click();
    await expect(member.getByTestId('family-member')).toHaveCount(2, { timeout: 15_000 });

    // Общий счёт: владелец создаёт, вносит доход — баланс пересчитан.
    await owner.getByTestId('family-account-name').fill('Общий счёт');
    await owner.getByTestId('family-account-create').click();
    const ownerAccount = owner.getByTestId('family-account').first();
    await expect(ownerAccount).toContainText('Общий счёт', { timeout: 15_000 });
    await ownerAccount.getByTestId('family-tx-amount').fill('1000');
    await ownerAccount.getByTestId('family-tx-submit').click();
    await expect(ownerAccount).toContainText(/1[\s\u00a0]?000/, { timeout: 15_000 });

    // Общая цель: владелец создаёт, участник видит её и вносит взнос.
    await owner.getByTestId('family-goal-title').fill('Ремонт');
    await owner.getByTestId('family-goal-target').fill('200000');
    await owner.getByTestId('family-goal-create').click();
    await expect(owner.getByTestId('family-goal').first()).toContainText('Ремонт', {
      timeout: 15_000,
    });

    await member.reload();
    const memberGoal = member.getByTestId('family-goal').first();
    await expect(memberGoal).toContainText('Ремонт', { timeout: 15_000 });
    await memberGoal.getByTestId('family-goal-deposit-amount').fill('100000');
    await memberGoal.getByTestId('family-goal-deposit-submit').click();
    await expect(memberGoal).toContainText('50%', { timeout: 15_000 });

    // Владелец видит прогресс общей цели, который внёс участник.
    await owner.reload();
    await expect(owner.getByTestId('family-goal').first()).toContainText(/100[\s\u00a0]?000/, {
      timeout: 15_000,
    });

    // Приватность: в личной истории чек-инов владельца нет записи участника.
    await owner.goto('/checkin');
    const history = owner.getByTestId('checkin-history');
    await expect(history).toContainText('Личная запись владельца');
    await expect(history).not.toContainText(memberNote);
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});
