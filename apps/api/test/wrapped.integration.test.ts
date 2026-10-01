// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты «Года в цифрах» (ТЗ §3.4, J1) против реального PostgreSQL
// в схеме puls_test. Запуск: pnpm --filter @puls/api exec vitest run test/wrapped.integration.test.ts
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

interface WrappedResponse {
  year: number;
  timezone: string;
  currency: string;
  spent: number;
  earned: number;
  net: number;
  topCategories: Array<{
    categoryId: string | null;
    categoryName: string | null;
    total: number;
    count: number;
  }>;
  mostExpensiveDay: { day: string; spent: number } | null;
  mostFrequentWeekday: { weekday: number; count: number } | null;
  avgMood: number | null;
  bestMonth: { month: string; avgMood: number } | null;
  worstMonth: { month: string; avgMood: number } | null;
  checkins: number;
  bestStreak: number;
  closedGoals: number;
  achievements: number;
}

interface CategoryDto {
  id: string;
  name: string;
}

interface AccountDto {
  id: string;
}

describe('Wrapped API — «Год в цифрах» (интеграция с PostgreSQL)', () => {
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
      'DELETE FROM "goal_deposits"',
      'DELETE FROM "goals"',
      'DELETE FROM "user_achievements"',
      'DELETE FROM "check_ins"',
      'DELETE FROM "transactions"',
      'DELETE FROM "daily_stats"',
      'DELETE FROM "budgets"',
      'DELETE FROM "accounts"',
      'DELETE FROM "categories" WHERE "user_id" IS NOT NULL',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
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
    const registered = await client.post('/api/auth/register', { email, password: PASSWORD, nickname });
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

  async function createAccount(client: TestClient, name = 'Карта', balance = 100000): Promise<AccountDto> {
    const response = await client.post('/api/finance/accounts', { name, type: 'card', balance });
    expect(response.status).toBe(201);
    return response.body as AccountDto;
  }

  async function categoriesOf(client: TestClient): Promise<CategoryDto[]> {
    const response = await client.get('/api/finance/categories');
    expect(response.status).toBe(200);
    return response.body.categories as CategoryDto[];
  }

  async function addExpense(client: TestClient, accountId: string, amount: number, date: string, categoryId?: string) {
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

  /** Полный набор данных за 2026 год плюс одна трата за 2025. */
  async function seedAlice(): Promise<TestClient> {
    const client = await signUp('wrapped@example.com', 'wrappeduser');
    await setTimezone('wrapped@example.com', 'UTC');
    const account = await createAccount(client);
    const categories = await categoriesOf(client);
    const food = categories.find((category) => category.name === 'Еда')!;
    const transport = categories.find((category) => category.name === 'Транспорт')!;

    await addExpense(client, account.id, 1000, '2026-01-05', food.id);
    await addExpense(client, account.id, 500, '2026-01-05', food.id);
    await addExpense(client, account.id, 2000, '2026-02-11', transport.id);
    await addIncome(client, account.id, 50000, '2026-01-01');
    await addIncome(client, account.id, 10000, '2026-02-01');
    // Другой год — не должен попасть в 2026.
    await addExpense(client, account.id, 777, '2025-12-15', food.id);

    const user = await userByEmail('wrapped@example.com');
    await prisma.checkIn.create({ data: { userId: user.id, mood: 5, occurredAt: new Date('2026-01-05T09:00:00.000Z') } });
    await prisma.checkIn.create({ data: { userId: user.id, mood: 3, occurredAt: new Date('2026-01-06T09:00:00.000Z') } });
    await prisma.checkIn.create({ data: { userId: user.id, mood: 2, occurredAt: new Date('2026-02-10T09:00:00.000Z') } });

    // Завершённая и незавершённая цели; updated_at в 2026 — через сырой SQL,
    // чтобы тест не зависел от «сегодня».
    const completed = await prisma.goal.create({
      data: { userId: user.id, title: 'Отпуск', targetAmount: 1000, savedAmount: 1000, currency: 'RUB' },
    });
    await prisma.goal.create({
      data: { userId: user.id, title: 'Ноутбук', targetAmount: 1000, savedAmount: 500, currency: 'RUB' },
    });
    await prisma.$executeRawUnsafe(
      'UPDATE "goals" SET "updated_at" = $1::timestamp WHERE "id" = $2',
      new Date('2026-06-01T00:00:00.000Z'),
      completed.id,
    );

    await prisma.userAchievement.create({
      data: { userId: user.id, code: 'first_checkin', earnedAt: new Date('2026-03-01T00:00:00.000Z') },
    });

    return client;
  }

  describe('Доступ (ТЗ §3.4, J1)', () => {
    it('без сессии — 401 unauthorized', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/wrapped')).status).toBe(401);
      expect((await anon.get('/api/wrapped?year=2026')).status).toBe(401);
    });

    it('некорректный год → 400 validation_error', async () => {
      const client = await signUp('bad-year@example.com', 'badyear');
      const response = await client.get('/api/wrapped?year=1969');
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('validation_error');
    });
  });

  describe('Пустой год (ТЗ §3.4, J1)', () => {
    it('без данных за год — нули и null', async () => {
      const client = await signUp('empty@example.com', 'emptyuser');
      await setTimezone('empty@example.com', 'UTC');

      const response = await client.get('/api/wrapped?year=2024');
      expect(response.status).toBe(200);
      const body = response.body as WrappedResponse;

      expect(body).toMatchObject({
        year: 2024,
        timezone: 'UTC',
        currency: 'RUB',
        spent: 0,
        earned: 0,
        net: 0,
        avgMood: null,
        checkins: 0,
        bestStreak: 0,
        closedGoals: 0,
        achievements: 0,
        mostExpensiveDay: null,
        mostFrequentWeekday: null,
        bestMonth: null,
        worstMonth: null,
      });
      expect(body.topCategories).toEqual([]);
    });
  });

  describe('Данные за год (ТЗ §3.4, J1)', () => {
    it('собирает траты, доходы, категории, чек-ины, достижения и цели', async () => {
      const client = await seedAlice();

      const response = await client.get('/api/wrapped?year=2026');
      expect(response.status).toBe(200);
      const body = response.body as WrappedResponse;

      expect(body).toMatchObject({
        year: 2026,
        timezone: 'UTC',
        currency: 'RUB',
        spent: 3500,
        earned: 60000,
        net: 56500,
        avgMood: 3.3,
        checkins: 3,
        bestStreak: 2,
        closedGoals: 1,
        achievements: 1,
      });
      expect(body.topCategories).toHaveLength(2);
      expect(body.topCategories[0]).toMatchObject({ categoryName: 'Транспорт', total: 2000, count: 1 });
      expect(body.topCategories[1]).toMatchObject({ categoryName: 'Еда', total: 1500, count: 2 });
      expect(body.mostExpensiveDay).toEqual({ day: '2026-02-11', spent: 2000 });
      expect(body.mostFrequentWeekday).toEqual({ weekday: 1, count: 2 });
      expect(body.bestMonth).toEqual({ month: '2026-01', avgMood: 4 });
      expect(body.worstMonth).toEqual({ month: '2026-02', avgMood: 2 });
    });

    it('трата другого года не попадает в выбранный год', async () => {
      const client = await seedAlice();

      const response = await client.get('/api/wrapped?year=2025');
      const body = response.body as WrappedResponse;
      expect(body.year).toBe(2025);
      expect(body.spent).toBe(777);
      expect(body.earned).toBe(0);
      expect(body.checkins).toBe(0);
      expect(body.topCategories).toHaveLength(1);
      expect(body.topCategories[0]).toMatchObject({ categoryName: 'Еда', total: 777, count: 1 });
    });

    it('год без данных при наличии данных в другом году — нули', async () => {
      const client = await seedAlice();

      const response = await client.get('/api/wrapped?year=2024');
      const body = response.body as WrappedResponse;
      expect(body.spent).toBe(0);
      expect(body.earned).toBe(0);
      expect(body.checkins).toBe(0);
      expect(body.achievements).toBe(0);
      expect(body.closedGoals).toBe(0);
      expect(body.mostExpensiveDay).toBeNull();
    });
  });

  describe('Изоляция данных (ТЗ §3.4, §6)', () => {
    it('не отдаёт год чужого пользователя', async () => {
      await seedAlice();

      const bob = await signUp('wrapped-bob@example.com', 'wrappedbob');
      await setTimezone('wrapped-bob@example.com', 'UTC');
      await createAccount(bob);

      const response = await bob.get('/api/wrapped?year=2026');
      expect(response.status).toBe(200);
      const body = response.body as WrappedResponse;

      expect(body.spent).toBe(0);
      expect(body.earned).toBe(0);
      expect(body.checkins).toBe(0);
      expect(body.achievements).toBe(0);
      expect(body.closedGoals).toBe(0);
      expect(body.topCategories).toHaveLength(0);
      expect(body.mostExpensiveDay).toBeNull();
    });
  });
});
