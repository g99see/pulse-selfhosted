// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты статистики (ТЗ §3.4, §6) против реального PostgreSQL
// в схеме puls_test. Запуск: pnpm --filter @puls/api test
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

interface CategoryDto {
  id: string;
  name: string;
  kind: string;
}

interface AccountDto {
  id: string;
  name: string;
}

interface StatsDayResponse {
  day: string;
  timezone: string;
  currency: string;
  spent: number;
  earned: number;
  net: number;
  budgetLimit: number;
  budgetRemaining: number;
  avgMood: number | null;
  checkins: number;
}

interface StatsReportResponse {
  period: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  spent: number;
  earned: number;
  net: number;
  avgMood: number | null;
  checkins: number;
  byCategory: Array<{
    categoryId: string | null;
    categoryName: string | null;
    total: number;
    count: number;
  }>;
  series: Array<{ day: string; spent: number; earned: number; mood: number | null }>;
  comparison: {
    spent: { current: number; previous: number; change: number | null };
    earned: { current: number; previous: number; change: number | null };
    avgMood: { current: number | null; previous: number | null; change: number | null };
    checkins: { current: number; previous: number; change: number | null };
  };
}

interface MoodCalendarResponse {
  month: string;
  timezone: string;
  average: number | null;
  best: { day: string; mood: number } | null;
  days: Array<{ day: string; dayOfMonth: number; mood: number | null }>;
}

describe('Stats API (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    const statements = [
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

  async function signUp(email: string, nickname: string): Promise<TestClient> {
    const client = new TestClient(server);
    await client.csrf();
    const registered = await client.post('/api/auth/register', {
      email,
      password: PASSWORD,
      nickname,
    });
    expect(registered.status).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    expect(token).toBeTruthy();
    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return client;
  }

  async function userByEmail(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeTruthy();
    return user!;
  }

  async function setTimezone(email: string, timezone: string): Promise<void> {
    const user = await userByEmail(email);
    await prisma.user.update({ where: { id: user.id }, data: { timezone } });
  }

  async function createAccount(
    client: TestClient,
    name = 'Карта',
    balance = 100000,
  ): Promise<AccountDto> {
    const response = await client.post('/api/finance/accounts', { name, type: 'card', balance });
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

  async function addIncome(client: TestClient, accountId: string, amount: number, date: string) {
    const response = await client.post('/api/finance/transactions', {
      accountId,
      type: 'income',
      amount,
      date,
    });
    expect(response.status).toBe(201);
  }

  async function addCheckIn(email: string, mood: number, createdAt: string): Promise<void> {
    const user = await userByEmail(email);
    await prisma.checkIn.create({
      data: { userId: user.id, mood, createdAt: new Date(createdAt) },
    });
  }

  describe('Дашборд дня (ТЗ §3.4, §9)', () => {
    it('показывает траты, остаток бюджета, среднее настроение и число чек-инов', async () => {
      const client = await signUp('dash@example.com', 'dashuser');
      const account = await createAccount(client);
      const food = (await categoriesOf(client)).find((category) => category.name === 'Еда')!;

      await addExpense(client, account.id, 450, '2026-10-05', food.id);
      await addIncome(client, account.id, 1000, '2026-10-05');
      await addCheckIn('dash@example.com', 4, '2026-10-05T09:00:00.000Z');
      await addCheckIn('dash@example.com', 2, '2026-10-05T18:00:00.000Z');

      const budget = await client.put('/api/finance/budgets', {
        categoryId: food.id,
        month: '2026-10',
        limit: 10000,
      });
      expect(budget.status).toBe(200);

      const response = await client.get('/api/stats/day?date=2026-10-05');
      expect(response.status).toBe(200);
      const day = response.body as StatsDayResponse;

      expect(day).toMatchObject({
        day: '2026-10-05',
        spent: 450,
        earned: 1000,
        net: 550,
        avgMood: 3,
        checkins: 2,
      });
      expect(day.budgetLimit).toBe(10000);
      expect(day.budgetRemaining).toBe(9550);
    });

    it('по умолчанию берёт сегодняшний день в часовом поясе пользователя', async () => {
      const client = await signUp('today@example.com', 'todayuser');
      await createAccount(client);

      const response = await client.get('/api/stats/day');
      expect(response.status).toBe(200);
      expect(response.body.day).toBe(new Date().toISOString().slice(0, 10));
      expect(response.body.spent).toBe(0);
      expect(response.body.avgMood).toBeNull();
    });

    it('перевод между счетами не считается расходом (ТЗ §3.2)', async () => {
      const client = await signUp('tr@example.com', 'truser');
      const card = await createAccount(client, 'Карта');
      const cash = await createAccount(client, 'Наличные', 0);

      await addExpense(client, card.id, 300, '2026-10-06');
      const transfer = await client.post('/api/finance/transfers', {
        fromAccountId: card.id,
        toAccountId: cash.id,
        amount: 5000,
        date: '2026-10-06',
      });
      expect(transfer.status).toBe(201);

      const day = (await client.get('/api/stats/day?date=2026-10-06')).body as StatsDayResponse;
      expect(day.spent).toBe(300);
      expect(day.earned).toBe(0);

      const report = (await client.get('/api/stats/report?period=month&date=2026-10-06'))
        .body as StatsReportResponse;
      expect(report.spent).toBe(300);
      expect(report.byCategory.every((entry) => entry.total !== 5000)).toBe(true);
    });
  });

  describe('Отчёты за период (ТЗ §3.4)', () => {
    it('считает траты по категориям и доходы против расходов за неделю', async () => {
      const client = await signUp('week@example.com', 'weekuser');
      const account = await createAccount(client);
      const categories = await categoriesOf(client);
      const food = categories.find((category) => category.name === 'Еда')!;
      const transport = categories.find((category) => category.name === 'Транспорт')!;

      // Неделя 2026-09-28 … 2026-10-04 (понедельник–воскресенье).
      await addExpense(client, account.id, 300, '2026-09-28', food.id);
      await addExpense(client, account.id, 200, '2026-10-01', food.id);
      await addExpense(client, account.id, 150, '2026-10-02', transport.id);
      await addIncome(client, account.id, 50000, '2026-10-01');
      // Соседняя неделя — не должна попасть.
      await addExpense(client, account.id, 9999, '2026-09-27');

      const report = (await client.get('/api/stats/report?period=week&date=2026-10-01'))
        .body as StatsReportResponse;

      expect(report).toMatchObject({ period: 'week', from: '2026-09-28', to: '2026-10-04' });
      expect(report.spent).toBe(650);
      expect(report.earned).toBe(50000);
      expect(report.net).toBe(49350);
      expect(report.byCategory).toHaveLength(2);
      expect(report.byCategory[0]).toMatchObject({ categoryName: 'Еда', total: 500, count: 2 });
      expect(report.byCategory[1]).toMatchObject({
        categoryName: 'Транспорт',
        total: 150,
        count: 1,
      });
      expect(report.series).toHaveLength(7);
      expect(report.series[0].day).toBe('2026-09-28');
      expect(report.series[0].spent).toBe(300);
      expect(report.series[3].day).toBe('2026-10-01');
      expect(report.series[3].earned).toBe(50000);
    });

    it('сравнивает месяц с предыдущим и считает процентную разницу', async () => {
      const client = await signUp('cmp@example.com', 'cmpuser');
      const account = await createAccount(client);
      const food = (await categoriesOf(client)).find((category) => category.name === 'Еда')!;

      // Прошлый месяц: 1000 трат. Текущий: 1500 (+50%).
      await addExpense(client, account.id, 1000, '2026-09-15', food.id);
      await addExpense(client, account.id, 1500, '2026-10-15', food.id);

      const report = (await client.get('/api/stats/report?period=month&date=2026-10-15'))
        .body as StatsReportResponse;

      expect(report.spent).toBe(1500);
      expect(report.comparison.spent).toEqual({ current: 1500, previous: 1000, change: 50 });
      expect(report.comparison.earned.change).toBe(0);
      expect(report.previousFrom).toBe('2026-09-01');
      expect(report.previousTo).toBe('2026-09-30');
    });

    it('отчёт за год охватывает весь календарный год', async () => {
      const client = await signUp('year@example.com', 'yearuser');
      const account = await createAccount(client);
      await addExpense(client, account.id, 100, '2026-01-01');
      await addExpense(client, account.id, 200, '2026-12-31');
      await addExpense(client, account.id, 400, '2027-01-01');

      const report = (await client.get('/api/stats/report?period=year&date=2026-06-01'))
        .body as StatsReportResponse;
      expect(report.from).toBe('2026-01-01');
      expect(report.to).toBe('2026-12-31');
      expect(report.spent).toBe(300);
      expect(report.series).toHaveLength(365);
    });
  });

  describe('Границы дней по часовому поясу (ТЗ §3.4, §6)', () => {
    it('относит чек-ины к дню пользователя при пересечении полуночи', async () => {
      const client = await signUp('tz@example.com', 'tzuser');
      await createAccount(client);
      await setTimezone('tz@example.com', 'Europe/Moscow');

      // 2026-10-01 20:30 UTC = 1 октября 23:30 в Москве.
      await addCheckIn('tz@example.com', 3, '2026-10-01T20:30:00.000Z');
      // 2026-10-01 22:30 UTC = уже 2 октября 01:30 в Москве.
      await addCheckIn('tz@example.com', 5, '2026-10-01T22:30:00.000Z');

      const calendar = (await client.get('/api/stats/mood-calendar?month=2026-10'))
        .body as MoodCalendarResponse;

      expect(calendar.timezone).toBe('Europe/Moscow');
      expect(calendar.days).toHaveLength(31);
      expect(calendar.days[0]).toEqual({ day: '2026-10-01', dayOfMonth: 1, mood: 3 });
      expect(calendar.days[1]).toEqual({ day: '2026-10-02', dayOfMonth: 2, mood: 5 });
      expect(calendar.days[2].mood).toBeNull();

      const firstDay = (await client.get('/api/stats/day?date=2026-10-01'))
        .body as StatsDayResponse;
      const secondDay = (await client.get('/api/stats/day?date=2026-10-02'))
        .body as StatsDayResponse;
      expect(firstDay.checkins).toBe(1);
      expect(firstDay.avgMood).toBe(3);
      expect(secondDay.checkins).toBe(1);
      expect(secondDay.avgMood).toBe(5);
    });

    it('в UTC тот же момент остаётся первым октября', async () => {
      const client = await signUp('utc@example.com', 'utcuser');
      await createAccount(client);
      await setTimezone('utc@example.com', 'UTC');
      await addCheckIn('utc@example.com', 5, '2026-10-01T22:30:00.000Z');

      const calendar = (await client.get('/api/stats/mood-calendar?month=2026-10'))
        .body as MoodCalendarResponse;
      expect(calendar.days[0].mood).toBe(5);
      expect(calendar.days[1].mood).toBeNull();
    });

    it('для отрицательного смещения чек-ин уходит в предыдущий день', async () => {
      const client = await signUp('ny@example.com', 'nyuser');
      await createAccount(client);
      await setTimezone('ny@example.com', 'America/New_York');
      // 2026-10-02 02:00 UTC = 1 октября 22:00 в Нью-Йорке.
      await addCheckIn('ny@example.com', 2, '2026-10-02T02:00:00.000Z');

      const calendar = (await client.get('/api/stats/mood-calendar?month=2026-10'))
        .body as MoodCalendarResponse;
      expect(calendar.days[0].mood).toBe(2);
      expect(calendar.days[1].mood).toBeNull();
    });
  });

  describe('Тепловая карта настроения (ТЗ §3.4)', () => {
    it('красит каждый день по среднему значению и находит лучший день', async () => {
      const client = await signUp('heat@example.com', 'heatuser');
      await createAccount(client);
      await setTimezone('heat@example.com', 'UTC');

      await addCheckIn('heat@example.com', 2, '2026-10-03T08:00:00.000Z');
      await addCheckIn('heat@example.com', 4, '2026-10-03T20:00:00.000Z');
      await addCheckIn('heat@example.com', 5, '2026-10-07T12:00:00.000Z');

      const calendar = (await client.get('/api/stats/mood-calendar?month=2026-10'))
        .body as MoodCalendarResponse;

      expect(calendar.days[2].mood).toBe(3);
      expect(calendar.days[6].mood).toBe(5);
      expect(calendar.average).toBe(3.7);
      expect(calendar.best).toEqual({ day: '2026-10-07', mood: 5 });
    });
  });

  describe('Кеш дневных агрегатов (ТЗ §6)', () => {
    it('пересчитывает DailyStat при чтении дашборда', async () => {
      const client = await signUp('cache@example.com', 'cacheuser');
      const account = await createAccount(client);
      await addExpense(client, account.id, 700, '2026-10-09');

      expect(await prisma.dailyStat.count()).toBe(0);

      const day = (await client.get('/api/stats/day?date=2026-10-09')).body as StatsDayResponse;
      expect(day.spent).toBe(700);

      const cached = await prisma.dailyStat.findFirst({
        where: { date: new Date('2026-10-09T00:00:00.000Z') },
      });
      expect(cached).toBeTruthy();
      expect(Number(cached!.spent)).toBe(700);
    });

    it('обновляет кеш после новой траты — дашборд меняется сразу', async () => {
      const client = await signUp('refresh@example.com', 'refreshuser');
      const account = await createAccount(client);
      await addExpense(client, account.id, 100, '2026-10-10');
      expect(
        ((await client.get('/api/stats/day?date=2026-10-10')).body as StatsDayResponse).spent,
      ).toBe(100);

      await addExpense(client, account.id, 250, '2026-10-10');
      expect(
        ((await client.get('/api/stats/day?date=2026-10-10')).body as StatsDayResponse).spent,
      ).toBe(350);
    });
  });

  describe('Изоляция данных и доступ (ТЗ §6)', () => {
    it('не отдаёт статистику чужого пользователя', async () => {
      const alice = await signUp('stats-alice@example.com', 'statsalice');
      const aliceAccount = await createAccount(alice);
      await addExpense(alice, aliceAccount.id, 900, '2026-10-11');
      await addCheckIn('stats-alice@example.com', 5, '2026-10-11T10:00:00.000Z');

      const bob = await signUp('stats-bob@example.com', 'statsbob');
      await createAccount(bob);

      const bobDay = (await bob.get('/api/stats/day?date=2026-10-11')).body as StatsDayResponse;
      expect(bobDay.spent).toBe(0);
      expect(bobDay.checkins).toBe(0);
      expect(bobDay.avgMood).toBeNull();

      const bobReport = (await bob.get('/api/stats/report?period=month&date=2026-10-11'))
        .body as StatsReportResponse;
      expect(bobReport.spent).toBe(0);
      expect(bobReport.byCategory).toHaveLength(0);

      const bobCalendar = (await bob.get('/api/stats/mood-calendar?month=2026-10'))
        .body as MoodCalendarResponse;
      expect(bobCalendar.days.every((day) => day.mood === null)).toBe(true);
    });

    it('без сессии — 401 unauthorized', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/stats/day')).status).toBe(401);
      expect((await anon.get('/api/stats/report?period=month')).status).toBe(401);
      expect((await anon.get('/api/stats/mood-calendar?month=2026-10')).status).toBe(401);
    });

    it('некорректные параметры → 400 validation_error', async () => {
      const client = await signUp('bad@example.com', 'baduser');
      await createAccount(client);

      expect((await client.get('/api/stats/day?date=вчера')).status).toBe(400);
      expect((await client.get('/api/stats/report?period=decade')).status).toBe(400);
      expect((await client.get('/api/stats/mood-calendar?month=2026-13')).status).toBe(400);
    });
  });
});
