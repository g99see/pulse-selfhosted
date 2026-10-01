// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты экспорта и удаления аккаунта (ТЗ §3.1, §6, §9) против
// реального PostgreSQL в схеме puls_test. Запуск: pnpm --filter @puls/api test
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  EXCLUDED_USER_TABLES,
  EXPORT_TABLES,
  coveredUserTables,
  listUserTables,
  uncoveredUserTables,
} from '../src/account/data-registry';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

interface ParsedZipEntry {
  name: string;
  text: string;
}

/** Разбор STORE-архива из ответа API: имя файла и его текстовое содержимое. */
function parseZip(buffer: Buffer): ParsedZipEntry[] {
  const entries: ParsedZipEntry[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    entries.push({ name, text: buffer.subarray(start, start + size).toString('utf8') });
    offset = start + size;
  }

  return entries;
}

describe('Экспорт и удаление аккаунта (ТЗ §3.1, §6)', () => {
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
      'DELETE FROM "notification_rules"',
      'DELETE FROM "push_subscriptions"',
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

  async function signUp(email: string, nickname: string): Promise<{ client: TestClient; userId: string }> {
    const client = new TestClient(server);
    await client.csrf();
    const registered = await client.post('/api/auth/register', { email, password: PASSWORD, nickname });
    expect(registered.status).toBe(201);

    const token = mail.lastVerificationTokenFor(email);
    expect(token).toBeTruthy();

    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return { client, userId: verified.body.user.id as string };
  }

  /** Наполняет аккаунт данными всех сущностей, кроме тех, что создаёт только API. */
  async function seed(client: TestClient, userId: string): Promise<void> {
    const account = await client.post('/api/finance/accounts', { name: 'Карта', type: 'card', balance: 10000 });
    expect(account.status).toBe(201);
    const category = await client.post('/api/finance/categories', { name: 'Кафе', kind: 'expense' });
    expect(category.status).toBe(201);

    await client.post('/api/finance/transactions', {
      accountId: account.body.id,
      categoryId: category.body.id,
      type: 'expense',
      amount: 450,
      comment: 'обед',
      date: '2026-10-01',
    });
    await client.put('/api/finance/budgets', { categoryId: category.body.id, month: '2026-10', limit: 5000 });

    await prisma.checkIn.create({ data: { userId, mood: 4, energy: 3, tags: ['работа'], note: 'спокойный день' } });
    await prisma.notificationRule.create({
      data: { userId, type: 'checkins', channel: 'web_push', schedule: { times: ['09:00'] } },
    });
    await prisma.dailyStat.create({ data: { userId, date: new Date('2026-10-01'), spent: 450 } });
  }

  async function countByUser(table: string, userId: string): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "user_id" = $1`,
      userId,
    );
    return rows[0]?.count ?? 0;
  }

  describe('Реестр таблиц (ТЗ §3.1, §6)', () => {
    it('каждая таблица с user_id либо выгружается, либо явно исключена', async () => {
      const tables = await listUserTables(prisma);
      expect(tables.length).toBeGreaterThanOrEqual(8);
      expect(uncoveredUserTables(tables)).toEqual([]);

      const covered = coveredUserTables();
      for (const table of tables) {
        expect(covered.has(table), `таблица ${table} не покрыта реестром`).toBe(true);
      }
    });

    it('все записи реестра существуют в текущей схеме', async () => {
      const tables = new Set(await listUserTables(prisma));
      for (const entry of EXPORT_TABLES.filter((item) => item.keyColumn === 'user_id')) {
        expect(tables.has(entry.table), `нет таблицы ${entry.table}`).toBe(true);
      }
      for (const entry of EXCLUDED_USER_TABLES) {
        expect(tables.has(entry.table), `нет таблицы ${entry.table}`).toBe(true);
      }
    });
  });

  describe('Экспорт JSON (ТЗ §3.1)', () => {
    it('отдаёт единый документ с версией и без секретов', async () => {
      const { client, userId } = await signUp('export@example.com', 'exportuser');
      await seed(client, userId);

      const response = await client.get('/api/account/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="puls-export-exportuser-\d{4}-\d{2}-\d{2}\.json"/);
      expect(response.headers['cache-control']).toBe('no-store');

      const doc = response.body as {
        format: string;
        version: number;
        generatedAt: string;
        user: Record<string, unknown>;
        counts: Record<string, number>;
        data: Record<string, unknown[]>;
      };

      expect(doc.format).toBe('puls.export');
      expect(doc.version).toBe(1);
      expect(Number.isNaN(Date.parse(doc.generatedAt))).toBe(false);
      expect(doc.user).toMatchObject({ email: 'export@example.com', nickname: 'exportuser', currency: 'RUB' });
      expect(doc.user).not.toHaveProperty('password_hash');
      expect(doc.user).not.toHaveProperty('passwordHash');
      expect(doc.user).not.toHaveProperty('password');

      expect(doc.data.accounts).toHaveLength(1);
      expect(doc.data.transactions).toHaveLength(1);
      expect(doc.data.budgets).toHaveLength(1);
      expect(doc.data.checkIns).toHaveLength(1);
      expect(doc.data.notificationRules).toHaveLength(1);
      expect(doc.data.dailyStats).toHaveLength(1);
      expect(doc.data.transactions[0]).toMatchObject({ amount: 450, comment: 'обед' });
      expect(doc.counts.transactions).toBe(1);

      // Ни хеша пароля, ни хешей токенов сессий в выгрузке нет.
      expect(response.text).not.toMatch(/password_hash|passwordHash|token_hash|tokenHash|\$argon2/);
    });

    it('содержит только данные запрашивающего (ТЗ §6)', async () => {
      const alice = await signUp('alice-export@example.com', 'aliceexport');
      await seed(alice.client, alice.userId);

      const bob = await signUp('bob-export@example.com', 'bobexport');
      const response = await bob.client.get('/api/account/export');

      expect(response.status).toBe(200);
      const doc = response.body as { data: Record<string, unknown[]>; user: Record<string, unknown> };
      expect(doc.user.email).toBe('bob-export@example.com');
      expect(doc.data.accounts).toHaveLength(0);
      expect(doc.data.transactions).toHaveLength(0);
      expect(doc.data.checkIns).toHaveLength(0);
      expect(doc.data.dailyStats).toHaveLength(0);
      expect(response.text).not.toContain('alice-export@example.com');
    });

    it('без сессии — 401', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/account/export')).status).toBe(401);
    });
  });

  describe('Экспорт CSV (ТЗ §3.1, §6)', () => {
    it('отдаёт ZIP с CSV по сущностям, экранирует и нейтрализует формулы', async () => {
      const { client, userId } = await signUp('csv@example.com', 'csvuser');
      await seed(client, userId);

      const account = (await client.get('/api/finance/accounts')).body.accounts[0] as { id: string };
      await client.post('/api/finance/transactions', {
        accountId: account.id,
        type: 'expense',
        amount: 100,
        comment: '=cmd|\'/C calc\'!A0',
        date: '2026-10-02',
      });

      const response = await client.getBinary('/api/account/export?format=csv');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/zip');
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="puls-export-csvuser-\d{4}-\d{2}-\d{2}\.zip"/);

      const zip = response.body as Buffer;
      expect(Buffer.isBuffer(zip)).toBe(true);
      expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');

      const files = parseZip(zip);
      const names = files.map((file) => file.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'accounts.csv',
          'categories.csv',
          'transactions.csv',
          'budgets.csv',
          'check_ins.csv',
          'notification_rules.csv',
          'daily_stats.csv',
          'users.csv',
        ]),
      );
      // Сессии, токены и push-подписки в выгрузку не попадают.
      expect(names).not.toEqual(expect.arrayContaining(['sessions.csv', 'email_verification_tokens.csv', 'push_subscriptions.csv']));

      const usersCsv = files.find((file) => file.name === 'users.csv')?.text ?? '';
      expect(usersCsv).toContain('csv@example.com');
      expect(usersCsv).not.toMatch(/password_hash|argon2/);

      const transactionsCsv = files.find((file) => file.name === 'transactions.csv')?.text ?? '';
      // Формула из комментария нейтрализована ведущей одинарной кавычкой.
      expect(transactionsCsv).toContain("'=cmd|'/C calc'!A0");
    });

    it('неверный формат — 400 validation_error', async () => {
      const { client } = await signUp('csv-bad@example.com', 'csvbaduser');
      const response = await client.get('/api/account/export?format=pdf');
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('validation_error');
    });
  });

  describe('Ограничение частоты экспорта (ТЗ §6)', () => {
    it('блокирует частые выгрузки (429 rate_limited)', async () => {
      const { client } = await signUp('flood-export@example.com', 'floodexport');

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await client.get('/api/account/export')).status).toBe(200);
      }

      const blocked = await client.get('/api/account/export');
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('rate_limited');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('Удаление аккаунта (ТЗ §3.1, §6)', () => {
    it('без CSRF-заголовка — 403 csrf_failed', async () => {
      const { userId } = await signUp('csrf-del@example.com', 'csrfdelyuser');

      const response = await request(server)
        .delete('/api/account')
        .send({ password: PASSWORD, confirm: 'csrfdelyuser' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('csrf_failed');
      expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
    });

    it('отклоняет несовпадающее подтверждение и неверный пароль', async () => {
      const { client, userId } = await signUp('confirm@example.com', 'confirmuser');

      const mismatch = await client.del('/api/account', { password: PASSWORD, confirm: 'другой-ник' });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.code).toBe('confirmation_mismatch');

      const wrongPassword = await client.del('/api/account', { password: 'WrongPass123', confirm: 'confirmuser' });
      expect(wrongPassword.status).toBe(403);
      expect(wrongPassword.body.code).toBe('invalid_password');

      expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
    });

    it('удаляет всё каскадно и не трогает чужие данные', async () => {
      const alice = await signUp('alice-del@example.com', 'alicedeluser');
      const bob = await signUp('bob-del@example.com', 'bobdeluser');
      await seed(alice.client, alice.userId);
      await seed(bob.client, bob.userId);

      const response = await alice.client.del('/api/account', { password: PASSWORD, confirm: 'alicedeluser' });
      expect(response.status).toBe(204);

      // Cookie сессии сброшен.
      const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;
      expect(Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie)).toMatch(/puls_session=;/);

      // Сессия больше не действует: после сброса cookie повторный запрос — 401.
      expect((await alice.client.get('/api/auth/me')).status).toBe(401);
      await alice.client.csrf();
      expect((await alice.client.del('/api/account', { password: PASSWORD, confirm: 'alicedeluser' })).status).toBe(401);

      // Ни одной строки по user_id во всех таблицах схемы.
      const tables = await listUserTables(prisma);
      for (const table of tables) {
        expect(await countByUser(table, alice.userId), `${table} должна быть пуста`).toBe(0);
      }
      const usersLeft = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        'SELECT COUNT(*)::int AS count FROM "users" WHERE "id" = $1',
        alice.userId,
      );
      expect(usersLeft[0]?.count ?? 0).toBe(0);

      // Данные Боба целы.
      expect((await bob.client.get('/api/finance/accounts')).body.accounts).toHaveLength(1);
      expect((await bob.client.get('/api/finance/transactions')).body.transactions).toHaveLength(1);
      expect(await countByUser('check_ins', bob.userId)).toBe(1);
      expect(await countByUser('daily_stats', bob.userId)).toBe(1);
      expect((await bob.client.get('/api/auth/me')).status).toBe(200);
    });

    it('без сессии — 401', async () => {
      const anon = new TestClient(server);
      await anon.csrf();
      expect((await anon.del('/api/account', { password: PASSWORD, confirm: 'nobody' })).status).toBe(401);
    });
  });
});
