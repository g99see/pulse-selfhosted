// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты целей накоплений (ТЗ §3.2, §5 сценарий 2) против
// реального PostgreSQL в схеме puls_test. Запуск: pnpm --filter @puls/api test
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requiredMonthlyContribution } from '@puls/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

interface GoalDto {
  id: string;
  title: string;
  targetAmount: number;
  savedAmount: number;
  remaining: number;
  percent: number;
  deadline: string | null;
  image: string | null;
  accountId: string | null;
  currency: string;
  requiredMonthly: number | null;
  forecastDate: string | null;
  milestones: number[];
}

interface AccountDto {
  id: string;
  balance: number;
  type: string;
}

describe('Goals API (интеграция с PostgreSQL)', () => {
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
    // Удаляем только свои данные; чужие таблицы параллельных агентов не трогаем.
    const statements = [
      'DELETE FROM "goal_deposits"',
      'DELETE FROM "goals"',
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
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch {
        // Соседние фикстуры параллельных агентов могут держать FK — пропускаем.
      }
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

  async function createAccount(
    client: TestClient,
    name: string,
    type = 'savings',
    balance = 0,
  ): Promise<AccountDto> {
    const response = await client.post('/api/finance/accounts', { name, type, balance });
    expect(response.status).toBe(201);
    return response.body as AccountDto;
  }

  async function createGoal(client: TestClient, body: Record<string, unknown>): Promise<GoalDto> {
    const response = await client.post('/api/goals', body);
    expect(response.status).toBe(201);
    return response.body as GoalDto;
  }

  describe('CRUD целей (ТЗ §3.2)', () => {
    it('создаёт цель с суммой, сроком, картинкой', async () => {
      const client = await signUp('goal@example.com', 'goaluser');
      const goal = await createGoal(client, {
        title: 'Ноутбук',
        targetAmount: 120000,
        deadline: '2027-03-01',
        image: '💻',
      });

      expect(goal).toMatchObject({
        title: 'Ноутбук',
        targetAmount: 120000,
        savedAmount: 0,
        remaining: 120000,
        percent: 0,
        image: '💻',
        milestones: [],
      });
      expect(goal.currency).toBe('RUB');
      expect(goal.deadline?.slice(0, 10)).toBe('2027-03-01');
    });

    it('считает нужный взнос в месяц к сроку (сценарий 2)', async () => {
      const client = await signUp('goal-month@example.com', 'goalmonth');
      const goal = await createGoal(client, {
        title: 'Ноутбук',
        targetAmount: 120000,
        deadline: '2027-03-01',
      });

      const expected = requiredMonthlyContribution(120000, 0, '2027-03-01', new Date());
      expect(goal.requiredMonthly).toBe(expected);
      expect(goal.requiredMonthly).toBeGreaterThan(0);
    });

    it('правит, читает и удаляет цель', async () => {
      const client = await signUp('goal-edit@example.com', 'goaledit');
      const goal = await createGoal(client, {
        title: 'Отпуск',
        targetAmount: 80000,
      });

      const updated = await client.put(`/api/goals/${goal.id}`, {
        title: 'Отпуск на море',
        targetAmount: 100000,
      });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        title: 'Отпуск на море',
        targetAmount: 100000,
      });

      const fetched = await client.get(`/api/goals/${goal.id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.title).toBe('Отпуск на море');

      const list = await client.get('/api/goals');
      expect(list.status).toBe(200);
      expect((list.body.goals as GoalDto[]).map((item) => item.id)).toContain(goal.id);

      expect((await client.del(`/api/goals/${goal.id}`)).status).toBe(204);
      expect((await client.get('/api/goals')).body.goals).toHaveLength(0);
    });

    it('принимает картинку-ссылку и отклоняет неверные данные', async () => {
      const client = await signUp('goal-image@example.com', 'goalimage');
      const goal = await createGoal(client, {
        title: 'Ремонт',
        targetAmount: 50000,
        image: 'https://cdn.example.com/room.png',
      });
      expect(goal.image).toBe('https://cdn.example.com/room.png');

      expect((await client.post('/api/goals', { title: '', targetAmount: 100 })).status).toBe(400);
      expect((await client.post('/api/goals', { title: 'x', targetAmount: -5 })).status).toBe(400);
    });
  });

  describe('Пополнение цели и вехи (ТЗ §3.2, сценарий 2)', () => {
    it('пополнение растёт и на 50% приходит событие milestone', async () => {
      const client = await signUp('goal-deposit@example.com', 'goaldeposit');
      const goal = await createGoal(client, { title: 'Ноутбук', targetAmount: 120000 });

      const deposit = await client.post(`/api/goals/${goal.id}/deposit`, { amount: 60000 });
      expect(deposit.status).toBe(201);
      expect(deposit.body.goal).toMatchObject({
        savedAmount: 60000,
        remaining: 60000,
        percent: 50,
      });
      expect(deposit.body.goal.milestones).toEqual([25, 50]);
      expect(deposit.body.milestone).toEqual({ percent: 50, reached: [25, 50] });
      expect(deposit.body.deposit.amount).toBe(60000);

      // Второе пополнение до 75% отдаёт только новую веху.
      const second = await client.post(`/api/goals/${goal.id}/deposit`, { amount: 30000 });
      expect(second.body.goal.percent).toBe(75);
      expect(second.body.milestone).toEqual({ percent: 75, reached: [75] });

      // 100% — последняя веха.
      const third = await client.post(`/api/goals/${goal.id}/deposit`, { amount: 30000 });
      expect(third.body.goal).toMatchObject({ savedAmount: 120000, remaining: 0, percent: 100 });
      expect(third.body.milestone).toEqual({ percent: 100, reached: [100] });
    });

    it('прогнозирует дату достижения по фактическому темпу', async () => {
      const client = await signUp('goal-forecast@example.com', 'goalforecast');
      const goal = await createGoal(client, { title: 'Ноутбук', targetAmount: 120000 });

      const deposit = await client.post(`/api/goals/${goal.id}/deposit`, { amount: 24000 });
      expect(deposit.status).toBe(201);
      expect(deposit.body.goal.forecastDate).toBeTruthy();
      const forecast = new Date(deposit.body.goal.forecastDate as string);
      expect(forecast.getTime()).toBeGreaterThan(Date.now());
    });

    it('пополнение со счёта-сбережений списывает сумму со счёта', async () => {
      const client = await signUp('goal-account@example.com', 'goalaccount');
      const account = await createAccount(client, 'Копилка', 'savings', 50000);
      const goal = await createGoal(client, {
        title: 'Ноутбук',
        targetAmount: 120000,
        accountId: account.id,
      });

      const deposit = await client.post(`/api/goals/${goal.id}/deposit`, {
        amount: 20000,
        accountId: account.id,
      });
      expect(deposit.status).toBe(201);
      expect(deposit.body.goal.savedAmount).toBe(20000);

      const accounts = (await client.get('/api/finance/accounts')).body.accounts as AccountDto[];
      expect(accounts.find((item) => item.id === account.id)?.balance).toBe(30000);
    });

    it('отклоняет неположительное пополнение', async () => {
      const client = await signUp('goal-bad-deposit@example.com', 'goalbaddep');
      const goal = await createGoal(client, { title: 'Цель', targetAmount: 1000 });
      expect((await client.post(`/api/goals/${goal.id}/deposit`, { amount: 0 })).status).toBe(400);
      expect((await client.post(`/api/goals/${goal.id}/deposit`, { amount: -10 })).status).toBe(
        400,
      );
    });
  });

  describe('Изоляция данных между пользователями (ТЗ §6)', () => {
    it('не отдаёт и не меняет чужие цели', async () => {
      const alice = await signUp('goal-alice@example.com', 'goalalice');
      const bob = await signUp('goal-bob@example.com', 'goalbob');

      const aliceGoal = await createGoal(alice, { title: 'Цель Алисы', targetAmount: 50000 });

      expect((await bob.get('/api/goals')).body.goals).toHaveLength(0);
      expect((await bob.get(`/api/goals/${aliceGoal.id}`)).status).toBe(404);
      expect((await bob.put(`/api/goals/${aliceGoal.id}`, { title: 'Взлом' })).status).toBe(404);
      expect((await bob.del(`/api/goals/${aliceGoal.id}`)).status).toBe(404);
      expect((await bob.post(`/api/goals/${aliceGoal.id}/deposit`, { amount: 100 })).status).toBe(
        404,
      );

      // Данные Алисы целы.
      expect((await alice.get(`/api/goals/${aliceGoal.id}`)).body.savedAmount).toBe(0);
    });

    it('нельзя пополнить цель с чужого счёта', async () => {
      const alice = await signUp('goal-alice2@example.com', 'goalalice2');
      const bob = await signUp('goal-bob2@example.com', 'goalbob2');
      const aliceAccount = await createAccount(alice, 'Копилка Алисы', 'savings', 1000);
      const bobGoal = await createGoal(bob, { title: 'Цель Боба', targetAmount: 5000 });

      const response = await bob.post(`/api/goals/${bobGoal.id}/deposit`, {
        amount: 100,
        accountId: aliceAccount.id,
      });
      expect(response.status).toBe(404);
    });

    it('без сессии — 401 unauthorized', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/goals')).status).toBe(401);
    });
  });
});
