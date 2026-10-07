// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты каталога (ТЗ v2 §8, §9) против реального PostgreSQL:
// дерево категорий, свои подкатегории и объединение, личные магазины, очередь
// «Требует внимания» и приоритет личных магазинов над общей базой.
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
  key: string | null;
  parentId: string | null;
}

interface AccountDto {
  id: string;
  name: string;
  balance: number;
}

describe('Каталог категорий и магазинов (интеграция, ТЗ v2 §8–§9)', () => {
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
      'DELETE FROM "user_merchants"',
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
    await client.post('/api/auth/verify-email', { token });
    return client;
  }

  async function categoriesOf(client: TestClient): Promise<CategoryDto[]> {
    return (await client.get('/api/finance/categories')).body.categories as CategoryDto[];
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

  describe('Дерево категорий (ТЗ v2 §8)', () => {
    it('отдаёт ~30 верхних категорий с ключом и подкатегориями', async () => {
      const client = await signUp('tree@example.com', 'treeuser');
      const categories = await categoriesOf(client);
      const top = categories.filter((category) => category.parentId === null);
      const subs = categories.filter((category) => category.parentId !== null);

      expect(top.length).toBeGreaterThanOrEqual(28);
      expect(subs.length).toBeGreaterThanOrEqual(20);
      expect(categories.some((category) => category.key === 'groceries')).toBe(true);
      const fuel = categories.find((category) => category.key === 'fuel');
      expect(fuel?.parentId).toBeTruthy();
    });

    it('создаёт свою подкатегорию, переименовывает и удаляет', async () => {
      const client = await signUp('ownsub@example.com', 'ownsub');
      const parent = (await categoriesOf(client)).find((category) => category.key === 'transport');
      expect(parent).toBeTruthy();

      const created = await client.post('/api/finance/categories', {
        name: 'Самокат',
        kind: 'expense',
        icon: 'bike',
        color: '#5B5BD6',
        parentId: parent!.id,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ parentId: parent!.id, isSystem: false });

      const renamed = await client.put(`/api/finance/categories/${created.body.id}`, {
        name: 'Самокаты',
        color: '#2BA889',
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ name: 'Самокаты', color: '#2BA889' });

      expect((await client.del(`/api/finance/categories/${created.body.id}`)).status).toBe(204);
    });

    it('объединяет свои категории, перенося историю транзакций', async () => {
      const client = await signUp('merge@example.com', 'mergeuser');
      const account = await createAccount(client);
      const source = (
        await client.post('/api/finance/categories', { name: 'Такси домой', kind: 'expense' })
      ).body as CategoryDto;
      const target = (
        await client.post('/api/finance/categories', { name: 'Такси', kind: 'expense' })
      ).body as CategoryDto;
      await client.post('/api/finance/transactions', {
        accountId: account.id,
        categoryId: source.id,
        amount: 500,
        type: 'expense',
      });

      const merged = await client.post(`/api/finance/categories/${source.id}/merge`, {
        targetId: target.id,
      });
      expect(merged.status).toBe(200);
      expect(merged.body.id).toBe(target.id);

      const transactions = (await client.get('/api/finance/transactions')).body.transactions as {
        categoryId: string | null;
      }[];
      expect(transactions).toHaveLength(1);
      expect(transactions[0].categoryId).toBe(target.id);

      const remaining = await categoriesOf(client);
      expect(remaining.some((category) => category.id === source.id)).toBe(false);
    });
  });

  describe('Личные магазины и очередь «Требует внимания» (ТЗ v2 §9)', () => {
    it('нераспознанная операция попадает в очередь и разрешается своим магазином', async () => {
      const client = await signUp('store@example.com', 'storeuser');
      const account = await createAccount(client);
      const category = (
        await client.post('/api/finance/categories', { name: 'Своя пекарня', kind: 'expense' })
      ).body as CategoryDto;

      const csv = [
        'Дата операции;Сумма;Описание;Тип',
        '05.10.2026;-120,00;МЕСТНАЯ ПЕКАРНЯ ХЛЕБ 4471;Расход',
      ].join('\n');
      const commit = await client.post('/api/finance/import/commit', {
        csv,
        accountId: account.id,
      });
      expect(commit.body.imported).toBe(1);

      const queue = await client.get('/api/finance/unmatched');
      expect(queue.body.count).toBe(1);
      expect(queue.body.transactions[0].description).toContain('ПЕКАРНЯ');

      const store = await client.post('/api/finance/stores', {
        name: 'Местная пекарня',
        categoryId: category.id,
        applyToSimilar: true,
      });
      expect(store.status).toBe(201);
      expect(store.body.applied).toBe(1);

      const afterQueue = await client.get('/api/finance/unmatched');
      expect(afterQueue.body.count).toBe(0);
      const transactions = (await client.get('/api/finance/transactions')).body.transactions as {
        categoryId: string | null;
      }[];
      expect(transactions[0].categoryId).toBe(category.id);
    });

    it('следующая загрузка распознаёт магазин автоматически', async () => {
      const client = await signUp('future@example.com', 'futureuser');
      const account = await createAccount(client);
      const category = (
        await client.post('/api/finance/categories', { name: 'Кофейня у дома', kind: 'expense' })
      ).body as CategoryDto;

      await client.post('/api/finance/stores', {
        name: 'Кофейня у дома',
        categoryId: category.id,
      });

      const csv = [
        'Дата;Сумма;Описание;Тип',
        '06.10.2026;-90,00;КОФЕЙНЯ У ДОМА КОФЕ 8801;Расход',
      ].join('\n');
      await client.post('/api/finance/import/commit', { csv, accountId: account.id });

      const transactions = (await client.get('/api/finance/transactions')).body.transactions as {
        categoryId: string | null;
      }[];
      expect(transactions[0].categoryId).toBe(category.id);
      expect((await client.get('/api/finance/unmatched')).body.count).toBe(0);
    });

    it('личный магазин приоритетнее общей базы', async () => {
      const client = await signUp('priority@example.com', 'priorityuser');
      const account = await createAccount(client);
      const personal = (
        await client.post('/api/finance/categories', { name: 'Мой Netto', kind: 'expense' })
      ).body as CategoryDto;
      await client.post('/api/finance/stores', { name: 'Netto', categoryId: personal.id });

      const csv = ['Дата;Сумма;Описание', '07.10.2026;-200,00;KORT NETTO KØBENHAVN POS 1'].join(
        '\n',
      );
      await client.post('/api/finance/import/commit', { csv, accountId: account.id });

      const transactions = (await client.get('/api/finance/transactions')).body.transactions as {
        categoryId: string | null;
      }[];
      expect(transactions[0].categoryId).toBe(personal.id);
    });

    it('редактирует и удаляет личный магазин', async () => {
      const client = await signUp('editstore@example.com', 'editstore');
      const category = (
        await client.post('/api/finance/categories', { name: 'Своя', kind: 'expense' })
      ).body as CategoryDto;
      const created = await client.post('/api/finance/stores', {
        name: 'Магазин',
        categoryId: category.id,
      });
      const storeId = created.body.store.id as string;
      const updated = await client.put(`/api/finance/stores/${storeId}`, {
        name: 'Магазин 2',
      });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('Магазин 2');
      expect((await client.del(`/api/finance/stores/${storeId}`)).status).toBe(204);
      expect((await client.get('/api/finance/stores')).body.stores).toHaveLength(0);
    });

    it('ищет магазины в общей базе', async () => {
      const client = await signUp('search@example.com', 'searchuser');
      const found = await client.get('/api/finance/merchants?q=netto');
      expect(found.status).toBe(200);
      expect(found.body.merchants.length).toBeGreaterThan(0);
    });
  });
});
