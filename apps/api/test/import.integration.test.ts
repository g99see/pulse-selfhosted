// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты импорта банковской выписки (ТЗ §3.2) против реального
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

const CSV = [
  'Дата операции;Сумма;Описание;Тип',
  '01.10.2026;-450,00;Обед в кафе;Расход',
  '02.10.2026;80000,00;Зарплата за сентябрь;Доход',
  '03.10.2026;мусор;Такси;Расход',
].join('\n');

interface AccountDto {
  id: string;
  name: string;
  balance: number;
  currency: string;
}

interface PreviewRow {
  rowNumber: number;
  date: string | null;
  amount: number | null;
  type: string | null;
  description: string;
  categoryName: string | null;
  duplicate: boolean;
  occurrence: number;
  error: string | null;
}

describe('Импорт CSV (интеграция с PostgreSQL, ТЗ §3.2)', () => {
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
    expect((await client.post('/api/auth/verify-email', { token })).status).toBe(200);
    return client;
  }

  async function createAccount(client: TestClient, balance = 10000): Promise<AccountDto> {
    const response = await client.post('/api/finance/accounts', {
      name: 'Карта',
      type: 'card',
      balance,
    });
    expect(response.status).toBe(201);
    return response.body as AccountDto;
  }

  describe('Предпросмотр (POST /finance/import/preview)', () => {
    it('разбирает файл, сопоставляет колонки и подбирает категории', async () => {
      const client = await signUp('preview@example.com', 'previewuser');
      const response = await client.post('/api/finance/import/preview', { csv: CSV });

      expect(response.status).toBe(200);
      expect(response.body.delimiter).toBe(';');
      expect(response.body.hasHeader).toBe(true);
      expect(response.body.mapping).toMatchObject({ date: 0, amount: 1, description: 2, type: 3 });
      expect(response.body.summary).toMatchObject({ total: 3, valid: 2, duplicates: 0, errors: 1 });

      const rows = response.body.rows as PreviewRow[];
      expect(rows[0]).toMatchObject({
        rowNumber: 2,
        date: '2026-10-01',
        amount: 450,
        type: 'expense',
        description: 'Обед в кафе',
        categoryName: 'Еда',
        duplicate: false,
        error: null,
      });
      expect(rows[1]).toMatchObject({ type: 'income', categoryName: 'Зарплата' });
      expect(rows[2].error).toBe('invalid_amount');
    });

    it('помечает дубли существующих транзакций', async () => {
      const client = await signUp('dup-preview@example.com', 'duppreview');
      const account = await createAccount(client);
      await client.post('/api/finance/transactions', {
        accountId: account.id,
        type: 'income',
        amount: 80000,
        comment: 'Зарплата за сентябрь',
        date: '2026-10-02',
      });

      const response = await client.post('/api/finance/import/preview', { csv: CSV });
      const rows = response.body.rows as PreviewRow[];
      expect(rows[1].duplicate).toBe(true);
      expect(response.body.summary.duplicates).toBe(1);
    });
  });

  describe('Импорт (POST /finance/import/commit)', () => {
    it('создаёт транзакции и обновляет баланс одной транзакцией', async () => {
      const client = await signUp('commit@example.com', 'committer');
      const account = await createAccount(client, 10000);

      const response = await client.post('/api/finance/import/commit', {
        csv: CSV,
        accountId: account.id,
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ imported: 2, duplicates: 0, invalid: 1, total: 3 });
      expect(response.body.balance).toBe(89550);

      const transactions = await client.get('/api/finance/transactions');
      expect(transactions.body.transactions).toHaveLength(2);
      const categories = transactions.body.transactions.map(
        (tx: { categoryName: string | null }) => tx.categoryName,
      );
      expect(categories).toContain('Еда');
      expect(categories).toContain('Зарплата');
    });

    it('идемпотентен: повторный импорт того же файла не создаёт дублей', async () => {
      const client = await signUp('idem@example.com', 'idemuser');
      const account = await createAccount(client, 10000);

      const first = await client.post('/api/finance/import/commit', {
        csv: CSV,
        accountId: account.id,
      });
      expect(first.body).toMatchObject({ imported: 2, duplicates: 0 });

      const second = await client.post('/api/finance/import/commit', {
        csv: CSV,
        accountId: account.id,
      });
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ imported: 0, duplicates: 2, invalid: 1 });
      expect(second.body.balance).toBe(89550);

      const transactions = await client.get('/api/finance/transactions');
      expect(transactions.body.transactions).toHaveLength(2);
      expect((await client.get('/api/finance/accounts')).body.accounts[0].balance).toBe(89550);
    });

    it('одинаковые строки выписки — разные операции; повторный импорт их не дублирует', async () => {
      const client = await signUp('same-rows@example.com', 'samerows');
      const account = await createAccount(client, 0);
      // Две поездки по 24 за день — реальный случай из выписки, не дубль.
      const csv = [
        'Date,Time,Title,Amount,Balance',
        '16.09.2026,08.10,Rejsekort,"-24,00","76,00"',
        '16.09.2026,17.45,Rejsekort,"-24,00","52,00"',
        '17.09.2026,09.00,Salary,"100,00","152,00"',
      ].join('\n');

      const preview = await client.post('/api/finance/import/preview', { csv });
      expect(preview.body.summary).toMatchObject({ total: 3, valid: 3, duplicates: 0 });

      const first = await client.post('/api/finance/import/commit', { csv, accountId: account.id });
      expect(first.body).toMatchObject({ imported: 3, duplicates: 0 });
      expect(first.body.balance).toBe(52);

      const again = await client.post('/api/finance/import/preview', { csv });
      expect(again.body.summary.duplicates).toBe(3);
      const second = await client.post('/api/finance/import/commit', {
        csv,
        accountId: account.id,
      });
      expect(second.body).toMatchObject({ imported: 0, duplicates: 3 });
      expect(second.body.balance).toBe(52);
    });

    it('заполняет сумму в базовой валюте — статистика видит импортированные траты', async () => {
      const client = await signUp('base@example.com', 'baseuser');
      const account = await createAccount(client, 10000);
      await client.post('/api/finance/import/commit', { csv: CSV, accountId: account.id });

      const rows = await prisma.transaction.findMany({
        where: { accountId: account.id },
        select: { amount: true, amountBase: true, rate: true },
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(Number(row.amountBase)).toBe(Number(row.amount));
        expect(Number(row.rate)).toBe(1);
      }
    });

    it('поддерживает отдельные колонки дебет/кредит', async () => {
      const client = await signUp('debit@example.com', 'debituser');
      const account = await createAccount(client, 0);
      const csv = [
        'Дата;Расход;Поступление;Назначение',
        '01.10.2026;450,00;;Обед',
        '02.10.2026;;80000,00;Зарплата',
      ].join('\n');

      const response = await client.post('/api/finance/import/commit', {
        csv,
        accountId: account.id,
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ imported: 2, invalid: 0 });
      expect(response.body.balance).toBe(79550);
    });

    it('отклоняет импорт в чужой счёт (404) и без сессии (401)', async () => {
      const alice = await signUp('imp-alice@example.com', 'impalice');
      const bob = await signUp('imp-bob@example.com', 'impbob');
      const aliceAccount = await createAccount(alice);

      expect(
        (await bob.post('/api/finance/import/commit', { csv: CSV, accountId: aliceAccount.id }))
          .status,
      ).toBe(404);

      const anon = new TestClient(server);
      await anon.csrf();
      expect((await anon.post('/api/finance/import/preview', { csv: CSV })).status).toBe(401);
    });

    it('соблюдает лимиты: 10 000 строк и 2 МБ', async () => {
      const client = await signUp('limits@example.com', 'limitsuser');
      const account = await createAccount(client);
      await client.csrf();

      const header = 'Дата;Сумма;Описание';
      const row = '01.10.2026;-100,00;Покупка';
      const tooManyRows = [header, ...Array.from({ length: 10_001 }, () => row)].join('\n');
      const rowsResponse = await client.post('/api/finance/import/preview', { csv: tooManyRows });
      expect(rowsResponse.status).toBe(400);
      expect(rowsResponse.body.code).toBe('import_too_many_rows');

      const tooBig = 'x'.repeat(2 * 1024 * 1024 + 16);
      const bigResponse = await client.post('/api/finance/import/commit', {
        csv: tooBig,
        accountId: account.id,
      });
      expect(bigResponse.status).toBe(413);
      expect(bigResponse.body.code).toBe('import_too_large');
    });
  });
});
