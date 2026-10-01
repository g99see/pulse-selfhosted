// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты финансов (ТЗ §3.2, §5 сценарий 1) против реального
// PostgreSQL в схеме puls_test. Запуск: pnpm --filter @puls/api test
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
  icon: string;
  color: string;
  isSystem: boolean;
}

interface AccountDto {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
}

describe('Finance API (интеграция с PostgreSQL)', () => {
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
    // Удаляем пользовательские данные, сохраняя системные категории (user_id = NULL).
    const statements = [
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
    const registered = await client.post('/api/auth/register', { email, password: PASSWORD, nickname });
    expect(registered.status).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    expect(token).toBeTruthy();
    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return client;
  }

  async function categoriesOf(client: TestClient): Promise<CategoryDto[]> {
    const response = await client.get('/api/finance/categories');
    expect(response.status).toBe(200);
    return response.body.categories as CategoryDto[];
  }

  async function createAccount(
    client: TestClient,
    name: string,
    type = 'card',
    balance = 0,
  ): Promise<AccountDto> {
    const response = await client.post('/api/finance/accounts', { name, type, balance });
    expect(response.status).toBe(201);
    return response.body as AccountDto;
  }

  describe('Категории (ТЗ §3.2)', () => {
    it('возвращает системные категории с иконкой и цветом', async () => {
      const client = await signUp('cat@example.com', 'catuser');
      const categories = await categoriesOf(client);

      expect(categories.some((category) => category.name === 'Еда')).toBe(true);
      expect(categories.some((category) => category.name === 'Зарплата' && category.kind === 'income')).toBe(true);
      const food = categories.find((category) => category.name === 'Еда');
      expect(food?.icon).toBeTruthy();
      expect(food?.color).toMatch(/^#/);
      expect(food?.isSystem).toBe(true);
    });

    it('создаёт свою категорию с иконкой и цветом', async () => {
      const client = await signUp('own-cat@example.com', 'owncat');
      const response = await client.post('/api/finance/categories', {
        name: 'Дача',
        kind: 'expense',
        icon: 'trees',
        color: '#2BA889',
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ name: 'Дача', icon: 'trees', color: '#2BA889', isSystem: false });

      const categories = await categoriesOf(client);
      expect(categories.some((category) => category.name === 'Дача')).toBe(true);
      expect(categories.filter((category) => category.isSystem).length).toBeGreaterThan(0);
    });

    it('правит и удаляет только свои категории', async () => {
      const client = await signUp('edit-cat@example.com', 'editcat');
      const created = await client.post('/api/finance/categories', { name: 'Хобби', kind: 'expense' });
      const id = created.body.id as string;

      const updated = await client.put(`/api/finance/categories/${id}`, { color: '#E5484D' });
      expect(updated.status).toBe(200);
      expect(updated.body.color).toBe('#E5484D');

      expect((await client.del(`/api/finance/categories/${id}`)).status).toBe(204);
      expect((await categoriesOf(client)).some((category) => category.id === id)).toBe(false);

      const system = (await categoriesOf(client)).find((category) => category.isSystem)!;
      expect((await client.put(`/api/finance/categories/${system.id}`, { name: 'Взлом' })).status).toBe(403);
      expect((await client.del(`/api/finance/categories/${system.id}`)).status).toBe(403);
    });
  });

  describe('Счета (ТЗ §3.2)', () => {
    it('создаёт счета типов card, cash и savings', async () => {
      const client = await signUp('acc@example.com', 'accuser');
      const card = await createAccount(client, 'Карта', 'card', 1000);
      await createAccount(client, 'Наличные', 'cash', 500);
      await createAccount(client, 'Копилка', 'savings', 20000);

      expect(card).toMatchObject({ name: 'Карта', type: 'card', balance: 1000 });

      const list = await client.get('/api/finance/accounts');
      expect(list.status).toBe(200);
      expect(list.body.accounts).toHaveLength(3);
      expect(list.body.totalBalance).toBe(21500);
    });

    it('правит и удаляет счёт', async () => {
      const client = await signUp('acc2@example.com', 'acc2user');
      const account = await createAccount(client, 'Карта', 'card', 100);

      const updated = await client.put(`/api/finance/accounts/${account.id}`, { name: 'Основная карта' });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('Основная карта');

      expect((await client.del(`/api/finance/accounts/${account.id}`)).status).toBe(204);
      expect((await client.get('/api/finance/accounts')).body.accounts).toHaveLength(0);
    });
  });

  describe('Транзакции и баланс (ТЗ §3.2)', () => {
    it('расход уменьшает баланс счёта, доход увеличивает', async () => {
      const client = await signUp('tx@example.com', 'txuser');
      const account = await createAccount(client, 'Карта', 'card', 10000);
      const food = (await categoriesOf(client)).find((category) => category.name === 'Еда')!;

      const expense = await client.post('/api/finance/transactions', {
        accountId: account.id,
        categoryId: food.id,
        type: 'expense',
        amount: 450,
        comment: 'обед',
      });
      expect(expense.status).toBe(201);
      expect(expense.body).toMatchObject({ type: 'expense', amount: 450, categoryName: 'Еда', comment: 'обед' });

      const afterExpense = await client.get('/api/finance/accounts');
      expect(afterExpense.body.accounts[0].balance).toBe(9550);

      const income = await client.post('/api/finance/transactions', {
        accountId: account.id,
        type: 'income',
        amount: 80000,
      });
      expect(income.status).toBe(201);

      const afterIncome = await client.get('/api/finance/accounts');
      expect(afterIncome.body.accounts[0].balance).toBe(89550);
    });

    it('использует сегодняшнюю дату, если дата не передана', async () => {
      const client = await signUp('date@example.com', 'dateuser');
      const account = await createAccount(client, 'Карта');

      const created = await client.post('/api/finance/transactions', {
        accountId: account.id,
        amount: 100,
        type: 'expense',
      });
      const today = new Date();
      const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(String(created.body.date).slice(0, 10)).toBe(expected);
    });

    it('фильтрует транзакции по типу, категории и периоду', async () => {
      const client = await signUp('filter@example.com', 'filteruser');
      const account = await createAccount(client, 'Карта', 'card', 100000);
      const food = (await categoriesOf(client)).find((category) => category.name === 'Еда')!;
      const transport = (await categoriesOf(client)).find((category) => category.name === 'Транспорт')!;

      await client.post('/api/finance/transactions', {
        accountId: account.id,
        categoryId: food.id,
        amount: 300,
        type: 'expense',
        date: '2026-10-01',
      });
      await client.post('/api/finance/transactions', {
        accountId: account.id,
        categoryId: transport.id,
        amount: 200,
        type: 'expense',
        date: '2026-10-02',
      });
      await client.post('/api/finance/transactions', {
        accountId: account.id,
        amount: 50000,
        type: 'income',
        date: '2026-10-03',
      });

      const onlyExpenses = await client.get('/api/finance/transactions?type=expense');
      expect(onlyExpenses.body.transactions).toHaveLength(2);

      const onlyFood = await client.get(`/api/finance/transactions?categoryId=${food.id}`);
      expect(onlyFood.body.transactions).toHaveLength(1);

      const period = await client.get('/api/finance/transactions?from=2026-10-02&to=2026-10-02');
      expect(period.body.transactions).toHaveLength(1);
      expect(period.body.transactions[0].categoryName).toBe('Транспорт');
    });

    it('удаление транзакции возвращает баланс', async () => {
      const client = await signUp('undo@example.com', 'undouser');
      const account = await createAccount(client, 'Карта', 'card', 5000);

      const created = await client.post('/api/finance/transactions', {
        accountId: account.id,
        amount: 1500,
        type: 'expense',
      });
      expect((await client.get('/api/finance/accounts')).body.accounts[0].balance).toBe(3500);

      expect((await client.del(`/api/finance/transactions/${created.body.id}`)).status).toBe(204);
      expect((await client.get('/api/finance/accounts')).body.accounts[0].balance).toBe(5000);
    });
  });

  describe('Быстрый ввод (ТЗ §4, §5 сценарий 1)', () => {
    it('«обед 450» сохраняется в категорию «Еда»', async () => {
      const client = await signUp('quick@example.com', 'quickuser');
      const account = await createAccount(client, 'Карта', 'card', 10000);

      const response = await client.post('/api/finance/transactions/quick', {
        text: 'обед 450',
        accountId: account.id,
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ amount: 450, type: 'expense', categoryName: 'Еда' });
      expect((await client.get('/api/finance/accounts')).body.accounts[0].balance).toBe(9550);
    });

    it('«зарплата +80000» — доход в категории «Зарплата»', async () => {
      const client = await signUp('quick2@example.com', 'quick2user');
      const account = await createAccount(client, 'Карта');

      const response = await client.post('/api/finance/transactions/quick', {
        text: 'зарплата +80000',
        accountId: account.id,
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ amount: 80000, type: 'income', categoryName: 'Зарплата' });
    });

    it('нераспознанный текст → 400 validation_error', async () => {
      const client = await signUp('quick3@example.com', 'quick3user');
      await createAccount(client, 'Карта');
      const response = await client.post('/api/finance/transactions/quick', { text: 'просто текст' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('validation_error');
    });
  });

  describe('Переводы (ТЗ §3.2)', () => {
    it('перевод двигает баланс между счетами и не считается расходом', async () => {
      const client = await signUp('transfer@example.com', 'transferuser');
      const card = await createAccount(client, 'Карта', 'card', 5000);
      const cash = await createAccount(client, 'Наличные', 'cash', 0);

      const response = await client.post('/api/finance/transfers', {
        fromAccountId: card.id,
        toAccountId: cash.id,
        amount: 2000,
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ type: 'transfer', amount: 2000, transferAccountId: cash.id });

      const accounts = (await client.get('/api/finance/accounts')).body.accounts as AccountDto[];
      expect(accounts.find((account) => account.id === card.id)?.balance).toBe(3000);
      expect(accounts.find((account) => account.id === cash.id)?.balance).toBe(2000);

      // Перевод не попадает в расходы.
      const expenses = await client.get('/api/finance/transactions?type=expense');
      expect(expenses.body.transactions).toHaveLength(0);
      const transfers = await client.get('/api/finance/transactions?type=transfer');
      expect(transfers.body.transactions).toHaveLength(1);
    });

    it('перевод на тот же счёт отклоняется', async () => {
      const client = await signUp('transfer2@example.com', 'transfer2user');
      const card = await createAccount(client, 'Карта', 'card', 100);
      const response = await client.post('/api/finance/transfers', {
        fromAccountId: card.id,
        toAccountId: card.id,
        amount: 10,
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('validation_error');
    });
  });

  describe('Бюджеты (ТЗ §3.2)', () => {
    it('считает потраченное и уровни ok/warning/exceeded', async () => {
      const client = await signUp('budget@example.com', 'budgetuser');
      const account = await createAccount(client, 'Карта', 'card', 100000);
      const food = (await categoriesOf(client)).find((category) => category.name === 'Еда')!;

      const budget = await client.put('/api/finance/budgets', {
        categoryId: food.id,
        month: '2026-10',
        limit: 10000,
      });
      expect(budget.status).toBe(200);
      expect(budget.body).toMatchObject({ month: '2026-10', limit: 10000, spent: 0, level: 'ok', percent: 0 });

      await client.post('/api/finance/transactions', {
        accountId: account.id,
        categoryId: food.id,
        type: 'expense',
        amount: 8500,
        date: '2026-10-05',
      });

      const warned = await client.get('/api/finance/budgets?month=2026-10');
      expect(warned.body.budgets[0]).toMatchObject({ spent: 8500, percent: 85, level: 'warning' });

      await client.post('/api/finance/transactions', {
        accountId: account.id,
        categoryId: food.id,
        type: 'expense',
        amount: 2000,
        date: '2026-10-06',
      });

      const exceeded = await client.get('/api/finance/budgets?month=2026-10');
      expect(exceeded.body.budgets[0].level).toBe('exceeded');
      expect(exceeded.body.budgets[0].spent).toBe(10500);
    });

    it('удаляет бюджет', async () => {
      const client = await signUp('budget2@example.com', 'budget2user');
      const food = (await categoriesOf(client)).find((category) => category.name === 'Еда')!;
      const budget = await client.put('/api/finance/budgets', { categoryId: food.id, month: '2026-10', limit: 5000 });

      expect((await client.del(`/api/finance/budgets/${budget.body.id}`)).status).toBe(204);
      expect((await client.get('/api/finance/budgets?month=2026-10')).body.budgets).toHaveLength(0);
    });
  });

  describe('Изоляция данных между пользователями (ТЗ §6)', () => {
    it('не отдаёт и не меняет чужие категории, счета, транзакции и бюджеты', async () => {
      const alice = await signUp('alice@example.com', 'aliceuser');
      const bob = await signUp('bob@example.com', 'bobuser');

      const aliceAccount = await createAccount(alice, 'Карта Алисы', 'card', 10000);
      const aliceCategory = await alice.post('/api/finance/categories', { name: 'Алиса', kind: 'expense' });
      const aliceTx = await alice.post('/api/finance/transactions', {
        accountId: aliceAccount.id,
        amount: 400,
        type: 'expense',
      });
      const aliceBudget = await alice.put('/api/finance/budgets', {
        categoryId: aliceCategory.body.id,
        month: '2026-10',
        limit: 1000,
      });

      // Боб не видит данных Алисы.
      expect((await bob.get('/api/finance/accounts')).body.accounts).toHaveLength(0);
      expect((await categoriesOf(bob)).some((category) => category.name === 'Алиса')).toBe(false);
      expect((await bob.get('/api/finance/transactions')).body.transactions).toHaveLength(0);
      expect((await bob.get('/api/finance/budgets?month=2026-10')).body.budgets).toHaveLength(0);

      // Боб не может использовать чужой счёт или категорию.
      expect(
        (
          await bob.post('/api/finance/transactions', {
            accountId: aliceAccount.id,
            amount: 100,
            type: 'expense',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await bob.post('/api/finance/transactions', {
            accountId: (await createAccount(bob, 'Карта Боба')).id,
            categoryId: aliceCategory.body.id,
            amount: 100,
            type: 'expense',
          })
        ).status,
      ).toBe(404);

      // Боб не может править/удалять чужое.
      expect((await bob.put(`/api/finance/accounts/${aliceAccount.id}`, { name: 'Взлом' })).status).toBe(404);
      expect((await bob.del(`/api/finance/accounts/${aliceAccount.id}`)).status).toBe(404);
      expect((await bob.del(`/api/finance/transactions/${aliceTx.body.id}`)).status).toBe(404);
      expect((await bob.put(`/api/finance/budgets/${aliceBudget.body.id}`, { limit: 1 })).status).toBe(404);

      // Данные Алисы целы.
      expect((await alice.get('/api/finance/accounts')).body.accounts[0].balance).toBe(9600);
    });

    it('без сессии — 401 unauthorized', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/finance/accounts')).status).toBe(401);
    });
  });
});
