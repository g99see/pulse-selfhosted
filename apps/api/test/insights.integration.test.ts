// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты инсайтов (ТЗ §3.5) против реального PostgreSQL в схеме
// puls_test: правила, оценка «полезно/нет», применение предложения, недельный
// разбор, защитное правило и изоляция. Запуск: pnpm --filter @puls/api test
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { addDays, todayKeyInTimezone, type InsightDto } from '@puls/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { SessionService } from '../src/auth/session.service';
import { InsightsScheduler } from '../src/insights/weekly.scheduler';
import { InsightsService } from '../src/insights/insights.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const MONTH = new Date().toISOString().slice(0, 7);

interface CategoryDto {
  id: string;
  name: string;
}

interface AccountDto {
  id: string;
}

interface FeedBody {
  insights: InsightDto[];
  support: Array<{ country: string; phone: string | null; nameKey: string }>;
  country: string;
}

describe('Insights API (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let insights: InsightsService;
  let scheduler: InsightsScheduler;
  let sessions: SessionService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    insights = app.get(InsightsService);
    scheduler = app.get(InsightsScheduler);
    sessions = app.get(SessionService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    const statements = [
      'DELETE FROM "insights"',
      'DELETE FROM "push_subscriptions"',
      'DELETE FROM "notification_rules"',
      'DELETE FROM "daily_stats"',
      'DELETE FROM "transactions"',
      'DELETE FROM "budgets"',
      'DELETE FROM "categories" WHERE "user_id" IS NOT NULL',
      'DELETE FROM "accounts"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "check_ins"',
      'DELETE FROM "users"',
    ];
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
    mail.clearOutbox();
  });

  /**
   * Создаёт подтверждённого пользователя и сессию напрямую, минуя HTTP-поток
   * регистрации: тесты инсайтов не должны зависеть от чужого модуля auth.
   */
  async function signUp(email: string, nickname: string): Promise<TestClient> {
    const user = await prisma.user.create({
      data: { email, nickname, emailVerifiedAt: new Date(), onboardingCompletedAt: new Date() },
    });
    const { token } = await sessions.create(user.id, { userAgent: 'vitest' });

    const client = new TestClient(server);
    client.cookies['puls_session'] = token;
    await client.csrf();
    return client;
  }

  async function userByEmail(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeTruthy();
    return user!;
  }

  async function createAccount(client: TestClient): Promise<AccountDto> {
    const response = await client.post('/api/finance/accounts', {
      name: 'Карта',
      type: 'card',
      balance: 100000,
    });
    expect(response.status).toBe(201);
    return response.body as AccountDto;
  }

  async function categoriesOf(client: TestClient): Promise<CategoryDto[]> {
    const response = await client.get('/api/finance/categories');
    expect(response.status).toBe(200);
    return response.body.categories as CategoryDto[];
  }

  async function addExpense(
    client: TestClient,
    accountId: string,
    amount: number,
    date: string,
    categoryId?: string,
  ) {
    const response = await client.post('/api/finance/transactions', {
      accountId,
      categoryId,
      type: 'expense',
      amount,
      date,
    });
    expect(response.status).toBe(201);
  }

  async function addCheckIn(
    email: string,
    day: string,
    fields: { mood?: number; energy?: number; tags?: string[]; fixedNoon?: boolean } = {},
  ): Promise<void> {
    const user = await userByEmail(email);
    // Полдень UTC «сегодняшнего» дня может быть ещё в будущем (прогон до 12:00 UTC,
    // или 01:00 по Москве = 22:00 UTC прошлых суток) — такие отметки лента не учитывает,
    // и тесты падали в зависимости от времени запуска. Поэтому по умолчанию не позже «сейчас».
    // fixedNoon — для тестов со своим «сейчас» (планировщик в будущем): ровно полдень дня.
    const noon = Date.parse(`${day}T12:00:00.000Z`);
    const at = new Date(fields.fixedNoon ? noon : Math.min(noon, Date.now() - 60_000));
    await prisma.checkIn.create({
      data: {
        userId: user.id,
        mood: fields.mood ?? 3,
        energy: fields.energy ?? null,
        tags: fields.tags ?? [],
        occurredAt: at,
        createdAt: at,
      },
    });
  }

  function daysEnding(today: string, count: number): string[] {
    return [...Array(count).keys()].reverse().map((offset) => addDays(today, -offset));
  }

  describe('Лента инсайтов и бюджет (ТЗ §3.5)', () => {
    it('показывает превышение бюджета и предлагает бюджет на крупную категорию', async () => {
      const client = await signUp('feed@example.com', 'feeduser');
      const account = await createAccount(client);
      const categories = await categoriesOf(client);
      const food = categories.find((category) => category.name === 'Еда')!;
      const transport = categories.find((category) => category.name === 'Транспорт')!;
      const today = new Date().toISOString().slice(0, 10);

      await addExpense(client, account.id, 150, today, food.id);
      await addExpense(client, account.id, 1400, today, transport.id);
      const budget = await client.put('/api/finance/budgets', {
        categoryId: food.id,
        month: MONTH,
        limit: 100,
      });
      expect(budget.status).toBe(200);

      const feed = await client.get('/api/insights');
      expect(feed.status).toBe(200);
      const body = feed.body as FeedBody;

      const exceeded = body.insights.find((insight) => insight.type === 'budget_exceeded');
      expect(exceeded).toMatchObject({
        textKey: 'insights.text.budgetExceeded',
        params: { category: 'Еда', percent: 150 },
      });

      const suggestion = body.insights.find((insight) => insight.type === 'budget_suggestion');
      expect(suggestion).toBeTruthy();
      expect(suggestion!.params).toMatchObject({ category: 'Транспорт', amount: 1400 });
      expect(suggestion!.action).toMatchObject({
        kind: 'budget',
        categoryId: transport.id,
        month: MONTH,
        weeklyLimit: 1400,
        monthlyLimit: 6000,
      });
      expect(body.country).toBe('INT');
      expect(body.support).toHaveLength(0);
    });

    it('применяет предложение кнопкой — создаёт бюджет через финансы', async () => {
      const client = await signUp('apply@example.com', 'applyuser');
      const account = await createAccount(client);
      const transport = (await categoriesOf(client)).find(
        (category) => category.name === 'Транспорт',
      )!;
      const today = new Date().toISOString().slice(0, 10);
      await addExpense(client, account.id, 1400, today, transport.id);

      const feed = (await client.get('/api/insights')).body as FeedBody;
      const suggestion = feed.insights.find((insight) => insight.type === 'budget_suggestion')!;

      const applied = await client.post(`/api/insights/${suggestion.id}/apply`);
      expect(applied.status).toBe(201);
      expect(applied.body.insight.appliedAt).toBeTruthy();

      const budgets = (await client.get(`/api/finance/budgets?month=${MONTH}`)).body
        .budgets as Array<{
        categoryId: string;
        limit: number;
      }>;
      const created = budgets.find((budget) => budget.categoryId === transport.id);
      expect(created?.limit).toBe(6000);
    });
  });

  describe('Правила на данных пользователя (ТЗ §3.5)', () => {
    it('замечает три дня подряд с энергией ниже 2', async () => {
      const client = await signUp('energy@example.com', 'energyuser');
      await createAccount(client);
      const today = new Date().toISOString().slice(0, 10);
      for (const day of daysEnding(today, 3))
        await addCheckIn('energy@example.com', day, { energy: 1, mood: 3 });

      const feed = (await client.get('/api/insights')).body as FeedBody;
      const insight = feed.insights.find((item) => item.type === 'low_energy_streak');
      expect(insight).toBeTruthy();
      expect(insight!.params.days).toBeGreaterThanOrEqual(3);
    });

    it('находит связь настроения со спортом', async () => {
      const client = await signUp('sport@example.com', 'sportuser');
      await createAccount(client);
      const today = new Date().toISOString().slice(0, 10);
      const sportDays = daysEnding(addDays(today, -2), 3);
      for (const [index, day] of sportDays.entries()) {
        await addCheckIn('sport@example.com', day, { mood: [5, 4, 4][index], tags: ['спорт'] });
      }
      await addCheckIn('sport@example.com', addDays(today, -1), { mood: 2 });
      await addCheckIn('sport@example.com', today, { mood: 3 });

      const feed = (await client.get('/api/insights')).body as FeedBody;
      const insight = feed.insights.find((item) => item.type === 'mood_with_sport');
      expect(insight).toMatchObject({ params: { withSport: 4.3, withoutSport: 2.5, delta: 1.8 } });
    });

    it('растёт трата по категории против прошлой недели', async () => {
      const client = await signUp('rise@example.com', 'riseuser');
      const account = await createAccount(client);
      const food = (await categoriesOf(client)).find((category) => category.name === 'Еда')!;
      const today = new Date().toISOString().slice(0, 10);
      await addExpense(client, account.id, 1000, addDays(today, -7), food.id);
      await addExpense(client, account.id, 1400, today, food.id);

      const feed = (await client.get('/api/insights')).body as FeedBody;
      const insight = feed.insights.find((item) => item.type === 'category_spend_up');
      expect(insight).toMatchObject({ params: { category: 'Еда', percent: 40 } });
    });
  });

  describe('Защитное правило и поддержка (ТЗ §3.5)', () => {
    it('мягко предлагает помощь и показывает контакты страны', async () => {
      const client = await signUp('care@example.com', 'careuser');
      await createAccount(client);
      const user = await userByEmail('care@example.com');
      await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Europe/Moscow' } });

      const today = todayKeyInTimezone('Europe/Moscow');
      for (const day of daysEnding(today, 6))
        await addCheckIn('care@example.com', day, { mood: 1 });

      const feed = (await client.get('/api/insights')).body as FeedBody;
      const concern = feed.insights.find((item) => item.type === 'wellbeing_concern');
      expect(concern).toBeTruthy();
      expect(concern!.params.days).toBeGreaterThanOrEqual(6);

      expect(feed.country).toBe('RU');
      expect(feed.support.map((resource) => resource.country)).toEqual(['RU', 'INT']);
      expect(feed.support.find((resource) => resource.country === 'RU')?.phone).toBe(
        '8-800-100-49-94',
      );
    });

    it('не срабатывает на пяти днях подряд', async () => {
      const client = await signUp('care5@example.com', 'care5user');
      await createAccount(client);
      const today = new Date().toISOString().slice(0, 10);
      for (const day of daysEnding(today, 5))
        await addCheckIn('care5@example.com', day, { mood: 1 });

      const feed = (await client.get('/api/insights')).body as FeedBody;
      expect(feed.insights.some((item) => item.type === 'wellbeing_concern')).toBe(false);
    });
  });

  describe('Оценка «полезно / не полезно» (ТЗ §3.5)', () => {
    it('сохраняет оценку и прячет тип после двух «не полезно»', async () => {
      const client = await signUp('feedback@example.com', 'feedbackuser');
      await createAccount(client);
      const user = await userByEmail('feedback@example.com');
      const today = new Date().toISOString().slice(0, 10);

      for (const key of ['seed-1', 'seed-2']) {
        await prisma.insight.create({
          data: {
            userId: user.id,
            type: 'low_energy_streak',
            textKey: 'insights.text.lowEnergyStreak',
            params: {},
            source: 'rule',
            periodKey: key,
          },
        });
      }

      const feed = (await client.get('/api/insights')).body as FeedBody;
      const first = feed.insights.find((item) => item.type === 'low_energy_streak')!;
      const rated = await client.post(`/api/insights/${first.id}/feedback`, {
        feedback: 'not_useful',
      });
      expect(rated.status).toBe(200);
      expect(rated.body.insight.feedback).toBe('not_useful');

      const second = (await client.get('/api/insights')).body as FeedBody;
      const other = second.insights.find(
        (item) => item.id !== first.id && item.type === 'low_energy_streak',
      )!;
      const rated2 = await client.post(`/api/insights/${other.id}/feedback`, {
        feedback: 'not_useful',
      });
      expect(rated2.status).toBe(200);

      expect(await insights.hiddenTypes(user.id)).toContain('low_energy_streak');

      // Свежие данные не создают скрытый тип за сегодня.
      for (const day of daysEnding(today, 3))
        await addCheckIn('feedback@example.com', day, { energy: 1, mood: 3 });
      const generated = await insights.generate(user.id);
      expect(generated.map((insight) => insight.type)).not.toContain('low_energy_streak');

      const bad = await client.post(`/api/insights/${first.id}/feedback`, { feedback: 'maybe' });
      expect(bad.status).toBe(400);
    });
  });

  describe('Недельный разбор (ТЗ §3.5)', () => {
    it('собирает 3 инсайта и 1 предложение в воскресенье и уведомляет один раз', async () => {
      const client = await signUp('weekly@example.com', 'weeklyuser');
      const account = await createAccount(client);
      const categories = await categoriesOf(client);
      const food = categories.find((category) => category.name === 'Еда')!;
      const transport = categories.find((category) => category.name === 'Транспорт')!;
      const user = await userByEmail('weekly@example.com');
      await prisma.user.update({
        where: { id: user.id },
        data: { onboardingCompletedAt: new Date() },
      });

      // Неделя 28.09–04.10.2026: рост трат, превышение бюджета, низкая энергия.
      await addExpense(client, account.id, 200, '2026-09-25', food.id);
      await addExpense(client, account.id, 400, '2026-10-01', food.id);
      await addExpense(client, account.id, 1400, '2026-10-02', transport.id);
      const budget = await client.put('/api/finance/budgets', {
        categoryId: food.id,
        month: '2026-10',
        limit: 100,
      });
      expect(budget.status).toBe(200);
      for (const day of ['2026-10-02', '2026-10-03', '2026-10-04']) {
        await addCheckIn('weekly@example.com', day, { energy: 1, mood: 3, fixedNoon: true });
      }

      const first = await scheduler.runOnce(
        new Date('2026-10-04T19:00:30.000Z'),
        new Date('2026-10-04T18:59:00.000Z'),
      );
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ insights: 3, suggestion: true });

      const stored = await prisma.insight.findMany({
        where: { userId: user.id, source: 'weekly' },
      });
      expect(stored).toHaveLength(4);
      expect(stored.filter((row) => row.type !== 'budget_suggestion')).toHaveLength(3);
      expect(stored.some((row) => row.type === 'budget_suggestion')).toBe(true);
      expect(stored.every((row) => row.periodKey === '2026-W40')).toBe(true);

      const notifications = mail
        .outbox()
        .filter((message) => message.kind === 'notification:weekly_report');
      expect(notifications).toHaveLength(1);
      expect(notifications[0].to).toBe('weekly@example.com');

      // Повторный тик в следующем окне — идемпотентно: без дублей и писем.
      const second = await scheduler.runOnce(
        new Date('2026-10-04T19:01:00.000Z'),
        new Date('2026-10-04T19:00:30.000Z'),
      );
      expect(second).toHaveLength(0);
      expect(await prisma.insight.count({ where: { userId: user.id, source: 'weekly' } })).toBe(4);
      expect(
        mail.outbox().filter((message) => message.kind === 'notification:weekly_report'),
      ).toHaveLength(1);
    });
  });

  describe('Изоляция и доступ (ТЗ §6)', () => {
    it('не отдаёт инсайты чужого пользователя и защищает действия', async () => {
      const alice = await signUp('ins-alice@example.com', 'insalice');
      const aliceAccount = await createAccount(alice);
      const transport = (await categoriesOf(alice)).find(
        (category) => category.name === 'Транспорт',
      )!;
      const today = new Date().toISOString().slice(0, 10);
      await addExpense(alice, aliceAccount.id, 1400, today, transport.id);

      const aliceFeed = (await alice.get('/api/insights')).body as FeedBody;
      const aliceInsight = aliceFeed.insights[0];
      expect(aliceInsight).toBeTruthy();

      const bob = await signUp('ins-bob@example.com', 'insbob');
      await createAccount(bob);

      const bobFeed = (await bob.get('/api/insights')).body as FeedBody;
      expect(bobFeed.insights).toHaveLength(0);

      expect(
        (await bob.post(`/api/insights/${aliceInsight.id}/feedback`, { feedback: 'useful' }))
          .status,
      ).toBe(404);
      expect((await bob.post(`/api/insights/${aliceInsight.id}/apply`)).status).toBe(404);

      const anon = new TestClient(server);
      expect((await anon.get('/api/insights')).status).toBe(401);
      // Без CSRF-токена мутирующий запрос отсекает глобальный CSRF-guard (403);
      // с токеном, но без сессии — SessionGuard (401).
      await anon.csrf();
      expect(
        (await anon.post('/api/insights/whatever/feedback', { feedback: 'useful' })).status,
      ).toBe(401);
    });
  });
});
