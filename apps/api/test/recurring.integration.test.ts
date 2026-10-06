// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты регулярных платежей (ТЗ §3.2, §9) против реального
// PostgreSQL в схеме puls_test: CRUD, пауза, изоляция, автосоздание транзакции
// планировщиком и идемпотентность повторного тика, напоминание за 1 день.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { RecurringScheduler } from '../src/finance/recurring.scheduler';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

interface RecurringDto {
  id: string;
  name: string;
  amount: number;
  type: string;
  accountId: string;
  categoryId: string | null;
  frequency: string;
  day: number;
  month: number | null;
  timeOfDay: string;
  timezone: string;
  nextRunAt: string;
  active: boolean;
}

interface AccountDto {
  id: string;
  name: string;
  balance: number;
  currency: string;
}

interface TransactionDto {
  id: string;
  accountId: string;
  type: string;
  amount: number;
  date: string;
  comment: string | null;
}

interface CategoryDto {
  id: string;
  name: string;
}

describe('Recurring payments API (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let scheduler: RecurringScheduler;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    scheduler = app.get(RecurringScheduler);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    const statements = [
      'DELETE FROM "recurring_payments"',
      'DELETE FROM "notification_deliveries"',
      'DELETE FROM "telegram_links"',
      'DELETE FROM "notification_rules"',
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
    return response.body.categories as CategoryDto[];
  }

  async function createRecurring(
    client: TestClient,
    accountId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<RecurringDto> {
    const response = await client.post('/api/finance/recurring-payments', {
      name: 'Аренда',
      amount: 30000,
      accountId,
      frequency: 'monthly',
      day: 31,
      timezone: 'UTC',
      ...overrides,
    });
    expect(response.status).toBe(201);
    return response.body as RecurringDto;
  }

  describe('CRUD (ТЗ §3.2)', () => {
    it('требует вход', async () => {
      expect((await new TestClient(server).get('/api/finance/recurring-payments')).status).toBe(
        401,
      );
    });

    it('создаёт платёж и показывает его в списке', async () => {
      const client = await signUp('rec-create@example.com', 'reccreate');
      const account = await createAccount(client);
      const category = (await categoriesOf(client)).find((item) => item.name === 'Жильё')!;

      const created = await createRecurring(client, account.id, {
        categoryId: category.id,
        type: 'expense',
        timeOfDay: '10:00',
      });

      expect(created).toMatchObject({
        name: 'Аренда',
        amount: 30000,
        type: 'expense',
        frequency: 'monthly',
        day: 31,
        active: true,
        accountId: account.id,
        categoryId: category.id,
      });
      expect(new Date(created.nextRunAt).getTime()).toBeGreaterThan(Date.now());

      const list = await client.get('/api/finance/recurring-payments');
      expect(list.status).toBe(200);
      expect(list.body.payments).toHaveLength(1);
      expect(list.body.payments[0].id).toBe(created.id);
    });

    it('правит платёж и удаляет его', async () => {
      const client = await signUp('rec-edit@example.com', 'recedit');
      const account = await createAccount(client);
      const created = await createRecurring(client, account.id);

      const updated = await client.put(`/api/finance/recurring-payments/${created.id}`, {
        name: 'Аренда квартиры',
        amount: 35000,
      });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ name: 'Аренда квартиры', amount: 35000 });

      expect((await client.del(`/api/finance/recurring-payments/${created.id}`)).status).toBe(204);
      expect((await client.get('/api/finance/recurring-payments')).body.payments).toHaveLength(0);
    });

    it('ставит на паузу и возобновляет', async () => {
      const client = await signUp('rec-pause@example.com', 'recpause');
      const account = await createAccount(client);
      const created = await createRecurring(client, account.id);

      const paused = await client.put(`/api/finance/recurring-payments/${created.id}/active`, {
        active: false,
      });
      expect(paused.status).toBe(200);
      expect(paused.body.active).toBe(false);

      const resumed = await client.put(`/api/finance/recurring-payments/${created.id}/active`, {
        active: true,
      });
      expect(resumed.body.active).toBe(true);
      expect(new Date(resumed.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('отклоняет некорректное расписание', async () => {
      const client = await signUp('rec-bad@example.com', 'recbad');
      const account = await createAccount(client);

      expect(
        (
          await client.post('/api/finance/recurring-payments', {
            name: 'x',
            amount: 100,
            accountId: account.id,
            frequency: 'weekly',
            day: 8,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await client.post('/api/finance/recurring-payments', {
            name: 'x',
            amount: 100,
            accountId: account.id,
            frequency: 'yearly',
            day: 1,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await client.post('/api/finance/recurring-payments', {
            name: 'x',
            amount: 0,
            accountId: account.id,
            frequency: 'monthly',
            day: 1,
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('Изоляция по пользователю (ТЗ §6)', () => {
    it('не отдаёт и не меняет чужие платежи', async () => {
      const alice = await signUp('rec-alice@example.com', 'recalice');
      const bob = await signUp('rec-bob@example.com', 'recbob');
      const aliceAccount = await createAccount(alice, 'Карта Алисы');
      const alicePayment = await createRecurring(alice, aliceAccount.id);

      expect((await bob.get('/api/finance/recurring-payments')).body.payments).toHaveLength(0);
      expect(
        (await bob.put(`/api/finance/recurring-payments/${alicePayment.id}`, { name: 'Взлом' }))
          .status,
      ).toBe(404);
      expect(
        (
          await bob.put(`/api/finance/recurring-payments/${alicePayment.id}/active`, {
            active: false,
          })
        ).status,
      ).toBe(404);
      expect((await bob.del(`/api/finance/recurring-payments/${alicePayment.id}`)).status).toBe(
        404,
      );

      // Чужой счёт нельзя привязать к своему платежу.
      const bobAccount = await createAccount(bob, 'Карта Боба');
      expect(
        (
          await bob.post('/api/finance/recurring-payments', {
            name: 'Чужой',
            amount: 100,
            accountId: aliceAccount.id,
            frequency: 'monthly',
            day: 1,
          })
        ).status,
      ).toBe(404);
      expect((await bob.get('/api/finance/recurring-payments')).body.payments).toHaveLength(0);
      expect(await bobAccount).toBeTruthy();
    });
  });

  describe('Ближайшие списания (ТЗ §3.2)', () => {
    it('отдаёт список с датами и суммами', async () => {
      const client = await signUp('rec-upcoming@example.com', 'recupcoming');
      const account = await createAccount(client, 'Карта', 50000);
      await createRecurring(client, account.id, { name: 'Аренда', amount: 20000 });

      const response = await client.get('/api/finance/recurring-payments/upcoming');
      expect(response.status).toBe(200);
      expect(response.body.upcoming).toHaveLength(1);
      expect(response.body.upcoming[0]).toMatchObject({
        name: 'Аренда',
        amount: 20000,
        type: 'expense',
        currency: 'RUB',
      });
      expect(response.body.upcoming[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('Автосоздание транзакции планировщиком (ТЗ §3.2, §9)', () => {
    it('в срок создаёт транзакцию и двигает баланс, повторный тик — без дублей', async () => {
      const client = await signUp('rec-run@example.com', 'recrun');
      const account = await createAccount(client, 'Карта', 100000);
      const category = (await categoriesOf(client)).find((item) => item.name === 'Жильё')!;
      const payment = await createRecurring(client, account.id, {
        categoryId: category.id,
        amount: 30000,
        timezone: 'Europe/Moscow',
      });

      // Сдвигаем списание на 31 января — конец месяца должен прижаться к 28 февраля.
      await prisma.recurringPayment.update({
        where: { id: payment.id },
        data: { nextRunAt: new Date('2026-01-31T07:00:00Z') },
      });

      const now = new Date('2026-01-31T09:00:00Z');
      const first = await scheduler.runOnce(now);
      expect(first.created).toBe(1);

      const transactions = (await client.get('/api/finance/transactions')).body
        .transactions as TransactionDto[];
      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({ type: 'expense', amount: 30000, comment: 'Аренда' });
      expect(transactions[0].date.slice(0, 10)).toBe('2026-01-31');

      const accounts = (await client.get('/api/finance/accounts')).body.accounts as AccountDto[];
      expect(accounts[0].balance).toBe(70000);

      const advanced = await prisma.recurringPayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(advanced.nextRunAt.toISOString()).toBe('2026-02-28T07:00:00.000Z');

      // Повторный тик (и перезапуск — состояние в БД) дубль не создаёт.
      const second = await scheduler.runOnce(now);
      expect(second.created).toBe(0);
      const after = (await client.get('/api/finance/transactions')).body
        .transactions as TransactionDto[];
      expect(after).toHaveLength(1);
      expect((await client.get('/api/finance/accounts')).body.accounts[0].balance).toBe(70000);
    });

    it('напоминает за 1 день и не повторяет напоминание', async () => {
      const client = await signUp('rec-remind@example.com', 'recremind');
      const account = await createAccount(client);
      const payment = await createRecurring(client, account.id, { name: 'Подписка' });

      const owner = await prisma.user.findFirstOrThrow({
        where: { email: 'rec-remind@example.com' },
      });
      await prisma.telegramLink.create({ data: { userId: owner.id, chatId: '9001' } });

      const now = new Date('2026-03-15T09:00:00Z');
      await prisma.recurringPayment.update({
        where: { id: payment.id },
        data: { nextRunAt: new Date('2026-03-16T07:00:00Z') },
      });

      const first = await scheduler.runOnce(now);
      expect(first.reminders).toBe(1);
      const delivered = await prisma.notificationDelivery.findMany({ where: { type: 'payments' } });
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({ channel: 'telegram', status: 'queued' });
      expect(JSON.stringify(delivered[0]!.payload)).toContain('Подписка');

      const stamped = await prisma.recurringPayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(stamped.remindedFor?.toISOString()).toBe('2026-03-16T07:00:00.000Z');

      const second = await scheduler.runOnce(now);
      expect(second.reminders).toBe(0);
      expect(await prisma.notificationDelivery.count({ where: { type: 'payments' } })).toBe(1);

      // Транзакция заранее не создаётся: списание ещё не наступило.
      expect((await client.get('/api/finance/transactions')).body.transactions).toHaveLength(0);
    });

    it('не трогает платежи на паузе', async () => {
      const client = await signUp('rec-paused-run@example.com', 'recpausedrun');
      const account = await createAccount(client);
      const payment = await createRecurring(client, account.id);
      await client.put(`/api/finance/recurring-payments/${payment.id}/active`, { active: false });
      await prisma.recurringPayment.update({
        where: { id: payment.id },
        data: { nextRunAt: new Date('2026-01-31T07:00:00Z') },
      });

      const result = await scheduler.runOnce(new Date('2026-02-15T09:00:00Z'));
      expect(result.created).toBe(0);
      expect((await client.get('/api/finance/transactions')).body.transactions).toHaveLength(0);
    });
  });
});
