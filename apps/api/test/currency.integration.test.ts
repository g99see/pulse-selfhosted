// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты мультивалютности (ТЗ §3.2) против реального PostgreSQL
// в схеме puls_test. Сетевой источник курсов отключён (RATES_PROVIDER не задан),
// поэтому все курсы вводятся вручную через /api/finance/rates.
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

interface AccountDto {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
}

interface TransactionDto {
  id: string;
  amount: number;
  currency: string;
  rate: number;
  amountBase: number;
  baseCurrency: string;
  toAmount: number | null;
  type: string;
}

interface RateDto {
  id: string;
  date: string;
  base: string;
  quote: string;
  rate: number;
  source: string;
}

describe('Мультивалютность (интеграция с PostgreSQL)', () => {
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
      'DELETE FROM "exchange_rates"',
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
    name: string,
    currency: string,
    balance = 0,
  ): Promise<AccountDto> {
    const response = await client.post('/api/finance/accounts', {
      name,
      type: 'card',
      balance,
      currency,
    });
    expect(response.status).toBe(201);
    return response.body as AccountDto;
  }

  async function createRate(
    client: TestClient,
    date: string,
    base: string,
    quote: string,
    rate: number,
  ): Promise<RateDto> {
    const response = await client.put('/api/finance/rates', { date, base, quote, rate });
    expect(response.status).toBe(200);
    return response.body as RateDto;
  }

  async function categoryId(client: TestClient, name: string): Promise<string> {
    const response = await client.get('/api/finance/categories');
    expect(response.status).toBe(200);
    return (response.body.categories as Array<{ id: string; name: string }>).find(
      (category) => category.name === name,
    )!.id;
  }

  describe('Справочник курсов (ТЗ §3.2)', () => {
    it('создаёт, читает и удаляет ручной курс', async () => {
      const client = await signUp('rates@example.com', 'ratesuser');
      const created = await createRate(client, '2026-10-01', 'USD', 'RUB', 95);

      expect(created).toMatchObject({
        date: '2026-10-01',
        base: 'USD',
        quote: 'RUB',
        rate: 95,
        source: 'manual',
      });

      const list = await client.get('/api/finance/rates');
      expect(list.status).toBe(200);
      expect(list.body.rates).toHaveLength(1);

      const filtered = await client.get('/api/finance/rates?base=USD&quote=RUB');
      expect(filtered.body.rates).toHaveLength(1);
      expect((await client.get('/api/finance/rates?base=EUR')).body.rates).toHaveLength(0);

      expect((await client.del(`/api/finance/rates/${created.id}`)).status).toBe(204);
      expect((await client.get('/api/finance/rates')).body.rates).toHaveLength(0);
    });

    it('обновляет курс на ту же дату и пару вместо дублирования', async () => {
      const client = await signUp('rates2@example.com', 'rates2user');
      await createRate(client, '2026-10-01', 'USD', 'RUB', 95);
      await createRate(client, '2026-10-01', 'USD', 'RUB', 96);

      const list = await client.get('/api/finance/rates');
      expect(list.body.rates).toHaveLength(1);
      expect(list.body.rates[0].rate).toBe(96);
    });

    it('отклоняет одинаковые валюты и неизвестную валюту', async () => {
      const client = await signUp('rates3@example.com', 'rates3user');
      expect(
        (
          await client.put('/api/finance/rates', {
            date: '2026-10-01',
            base: 'USD',
            quote: 'USD',
            rate: 1,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await client.put('/api/finance/rates', {
            date: '2026-10-01',
            base: 'USD',
            quote: 'GBP',
            rate: 1,
          })
        ).status,
      ).toBe(400);
    });

    it('курсы изолированы по пользователю', async () => {
      const alice = await signUp('alice-rates@example.com', 'alicerates');
      const bob = await signUp('bob-rates@example.com', 'bobrates');
      const rate = await createRate(alice, '2026-10-01', 'USD', 'RUB', 95);

      expect((await bob.get('/api/finance/rates')).body.rates).toHaveLength(0);
      expect((await bob.del(`/api/finance/rates/${rate.id}`)).status).toBe(404);
      // Курс Алисы цел.
      expect((await alice.get('/api/finance/rates')).body.rates).toHaveLength(1);
    });

    it('без сессии — 401', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/finance/rates')).status).toBe(401);
      // PUT без CSRF-токена отбивает CSRF-guard раньше SessionGuard.
      const blocked = await anon.put('/api/finance/rates', {
        date: '2026-10-01',
        base: 'USD',
        quote: 'RUB',
        rate: 1,
      });
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('csrf_failed');
    });
  });

  describe('Валюта счёта и курс транзакции (ТЗ §3.2)', () => {
    it('счёт можно создать в USD, у него своя валюта', async () => {
      const client = await signUp('acc-usd@example.com', 'accusd');
      const account = await createAccount(client, 'Долларовый счёт', 'USD', 100);
      expect(account.currency).toBe('USD');

      const list = await client.get('/api/finance/accounts');
      expect(list.body.accounts[0].currency).toBe('USD');
      // Основная валюта пользователя по умолчанию RUB.
      expect(list.body.currency).toBe('RUB');
    });

    it('фиксирует курс на дату операции и amount_base в основной валюте', async () => {
      const client = await signUp('tx-usd@example.com', 'txusd');
      const account = await createAccount(client, 'Долларовый счёт', 'USD', 1000);
      await createRate(client, '2026-09-30', 'USD', 'RUB', 92);

      const created = await client.post('/api/finance/transactions', {
        accountId: account.id,
        type: 'expense',
        amount: 100,
        date: '2026-10-01',
      });
      expect(created.status).toBe(201);
      const tx = created.body as TransactionDto;
      // Курса на 2026-10-01 нет — берётся последний предыдущий (92).
      expect(tx).toMatchObject({
        currency: 'USD',
        rate: 92,
        amountBase: 9200,
        baseCurrency: 'RUB',
      });
      // Баланс счёта — в валюте счёта.
      expect((await client.get('/api/finance/accounts')).body.accounts[0].balance).toBe(900);
    });

    it('без курса и без источника — 400 rate_not_found', async () => {
      const client = await signUp('tx-norate@example.com', 'txnorate');
      const account = await createAccount(client, 'Долларовый счёт', 'USD', 1000);
      const response = await client.post('/api/finance/transactions', {
        accountId: account.id,
        type: 'expense',
        amount: 10,
        date: '2026-10-01',
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('rate_not_found');
    });

    it('валюта операции, отличная от валюты счёта, отклоняется', async () => {
      const client = await signUp('tx-mismatch@example.com', 'txmismatch');
      const account = await createAccount(client, 'Рублёвый счёт', 'RUB', 1000);
      const response = await client.post('/api/finance/transactions', {
        accountId: account.id,
        type: 'expense',
        amount: 10,
        currency: 'USD',
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('currency_mismatch');
    });
  });

  describe('Статистика и бюджеты в основной валюте (ТЗ §3.2, §3.4)', () => {
    it('трата в USD попадает в итоги в RUB по курсу даты', async () => {
      const client = await signUp('stats-usd@example.com', 'statsusd');
      const account = await createAccount(client, 'Долларовый счёт', 'USD', 10000);
      await createRate(client, '2026-10-01', 'USD', 'RUB', 95);

      const tx = await client.post('/api/finance/transactions', {
        accountId: account.id,
        type: 'expense',
        amount: 100,
        date: '2026-10-05',
      });
      expect(tx.status).toBe(201);

      const report = await client.get('/api/stats/report?period=month&date=2026-10-15');
      expect(report.status).toBe(200);
      expect(report.body.currency).toBe('RUB');
      expect(report.body.spent).toBe(9500);
    });

    it('бюджет считает потраченное в основной валюте', async () => {
      const client = await signUp('budget-usd@example.com', 'budgetusd');
      const account = await createAccount(client, 'Долларовый счёт', 'USD', 10000);
      const food = await categoryId(client, 'Еда');
      await createRate(client, '2026-10-01', 'USD', 'RUB', 95);

      await client.put('/api/finance/budgets', {
        categoryId: food,
        month: '2026-10',
        limit: 10000,
      });
      await client.post('/api/finance/transactions', {
        accountId: account.id,
        categoryId: food,
        type: 'expense',
        amount: 50,
        date: '2026-10-05',
      });

      const budgets = await client.get('/api/finance/budgets?month=2026-10');
      expect(budgets.body.budgets[0]).toMatchObject({ spent: 4750, level: 'ok' });
    });
  });

  describe('Перевод между счетами разных валют (ТЗ §3.2)', () => {
    it('списывает одну сумму, зачисляет другую по курсу', async () => {
      const client = await signUp('transfer-fx@example.com', 'transferfx');
      const usd = await createAccount(client, 'Долларовый', 'USD', 1000);
      const rub = await createAccount(client, 'Рублёвый', 'RUB', 0);
      await createRate(client, '2026-10-01', 'USD', 'RUB', 95);

      const response = await client.post('/api/finance/transfers', {
        fromAccountId: usd.id,
        toAccountId: rub.id,
        amount: 100,
        date: '2026-10-01',
      });
      expect(response.status).toBe(201);
      const tx = response.body as TransactionDto;
      expect(tx).toMatchObject({ type: 'transfer', amount: 100, currency: 'USD', toAmount: 9500 });

      const accounts = (await client.get('/api/finance/accounts')).body.accounts as AccountDto[];
      expect(accounts.find((account) => account.id === usd.id)?.balance).toBe(900);
      expect(accounts.find((account) => account.id === rub.id)?.balance).toBe(9500);
    });

    it('принимает вторую сумму перевода явно', async () => {
      const client = await signUp('transfer-fx2@example.com', 'transferfx2');
      const usd = await createAccount(client, 'Долларовый', 'USD', 1000);
      const rub = await createAccount(client, 'Рублёвый', 'RUB', 0);
      // Курс нужен для эквивалента в основной валюте (amount_base).
      await createRate(client, '2026-10-01', 'USD', 'RUB', 95);

      const response = await client.post('/api/finance/transfers', {
        fromAccountId: usd.id,
        toAccountId: rub.id,
        amount: 100,
        toAmount: 9000,
        date: '2026-10-01',
      });
      expect(response.status).toBe(201);
      expect((response.body as TransactionDto).toAmount).toBe(9000);

      const accounts = (await client.get('/api/finance/accounts')).body.accounts as AccountDto[];
      expect(accounts.find((account) => account.id === rub.id)?.balance).toBe(9000);
    });
  });
});
