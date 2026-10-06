// SPDX-License-Identifier: AGPL-3.0-or-later
// Сверка счёта с банком (ТЗ v2 §3): импорт с ID банка и остатками, отчёт о расхождениях.
// Фикстура синтетическая: сумма операций 674,15, остатки сходятся цепочкой.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const CSV = readFileSync(join(__dirname, 'fixtures', 'statement-synthetic.csv'), 'utf8');
const CLOSING = 674.15;

interface Item {
  kind: string;
  amount: number;
  externalId: string | null;
  transactionId: string | null;
  manual: boolean;
  description: string;
}

describe('Сверка (интеграция с PostgreSQL)', () => {
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
    for (const statement of [
      'DELETE FROM "account_bank_balances"',
      'DELETE FROM "transactions"',
      'DELETE FROM "budgets"',
      'DELETE FROM "categories" WHERE "user_id" IS NOT NULL',
      'DELETE FROM "accounts"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "check_ins"',
      'DELETE FROM "daily_stats"',
      'DELETE FROM "users"',
    ]) {
      await prisma.$executeRawUnsafe(statement);
    }
    mail.clearOutbox();
  });

  async function setup(email: string, nickname: string) {
    const client = new TestClient(server);
    await client.csrf();
    expect(
      (await client.post('/api/auth/register', { email, password: PASSWORD, nickname })).status,
    ).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    expect((await client.post('/api/auth/verify-email', { token })).status).toBe(200);
    const account = await client.post('/api/finance/accounts', {
      name: 'Карта',
      type: 'card',
      balance: 0,
      currency: 'RUB',
    });
    return { client, accountId: account.body.id as string };
  }

  it('чистый импорт: сумма и баланс точные, разница 0, замечаний нет', async () => {
    const { client, accountId } = await setup('rec-clean@example.com', 'recclean');
    const commit = await client.post('/api/finance/import/commit', { csv: CSV, accountId });
    expect(commit.body).toMatchObject({ imported: 10, duplicates: 0, invalid: 0 });
    // Точное значение: 0.1 + 0.2 + … в float дало бы хвост.
    expect(commit.body.balance).toBe(CLOSING);

    const report = (await client.get(`/api/finance/accounts/${accountId}/reconciliation`)).body;
    expect(report).toMatchObject({
      pulseBalance: CLOSING,
      bankBalance: CLOSING,
      bankSource: 'statement',
      difference: 0,
      explained: 0,
      unexplained: 0,
      statementRows: 10,
      period: { from: '2026-09-01', to: '2026-09-06' },
    });
    expect(report.items).toEqual([]);

    const stored = await prisma.transaction.findFirst({
      where: { accountId, comment: 'Apotek Test' },
    });
    expect(stored?.bankTime).toBe('11:11');
    expect(Number(stored?.bankBalance)).toBe(CLOSING);
    expect(stored?.externalId).toBeTruthy();
  });

  it('идемпотентность по ID банка: повторный файл с изменённым описанием не дублирует', async () => {
    const { client, accountId } = await setup('rec-idem@example.com', 'recidem');
    await client.post('/api/finance/import/commit', { csv: CSV, accountId });
    const renamed = CSV.replace(/Test/g, 'Renamed');
    const again = await client.post('/api/finance/import/commit', { csv: renamed, accountId });
    expect(again.body).toMatchObject({ imported: 0, duplicates: 10 });
    expect(again.body.balance).toBe(CLOSING);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(10);
  });

  it('операции, импортированные без ID, донаполняются ID банка при повторе', async () => {
    const { client, accountId } = await setup('rec-legacy@example.com', 'reclegacy');
    const noId = CSV.split('\n')
      .map((line) =>
        line
          .replace(/,[0-9a-f-]{36}$/, '')
          .replace(/^Date,Time,Title,Amount,Balance$/, 'Date,Time,Title,Amount,Balance'),
      )
      .join('\n')
      .replace('Balance,Transaction ID', 'Balance');
    await client.post('/api/finance/import/commit', { csv: noId, accountId });
    expect(await prisma.transaction.count({ where: { accountId, externalId: null } })).toBe(10);

    const again = await client.post('/api/finance/import/commit', { csv: CSV, accountId });
    expect(again.body).toMatchObject({ imported: 0, duplicates: 10 });
    expect(await prisma.transaction.count({ where: { accountId, externalId: null } })).toBe(0);
    expect(again.body.balance).toBe(CLOSING);
  });

  it('удалена операция в Пульсе: разница объяснена «нет в Пульсе»', async () => {
    const { client, accountId } = await setup('rec-missing@example.com', 'recmissing');
    await client.post('/api/finance/import/commit', { csv: CSV, accountId });
    const victim = await prisma.transaction.findFirstOrThrow({
      where: { accountId, comment: 'Restaurant Test' },
    });
    expect((await client.del(`/api/finance/transactions/${victim.id}`)).status).toBe(204);

    const report = (await client.get(`/api/finance/accounts/${accountId}/reconciliation`)).body;
    expect(report.pulseBalance).toBe(984.9);
    expect(report.difference).toBe(310.75);
    expect(report.explained).toBe(310.75);
    expect(report.unexplained).toBe(0);
    const missing = (report.items as Item[]).filter((i) => i.kind === 'missing_in_pulse');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ amount: -310.75, description: 'Restaurant Test' });
  });

  it('лишняя ручная операция в периоде: видна как «нет в выписке», разница объяснена', async () => {
    const { client, accountId } = await setup('rec-extra@example.com', 'recextra');
    await client.post('/api/finance/import/commit', { csv: CSV, accountId });
    const manual = await client.post('/api/finance/transactions', {
      accountId,
      type: 'expense',
      amount: 15.5,
      comment: 'Кофе вручную',
      date: '2026-09-03',
    });
    expect(manual.status).toBe(201);

    const report = (await client.get(`/api/finance/accounts/${accountId}/reconciliation`)).body;
    expect(report.difference).toBe(-15.5);
    expect(report.unexplained).toBe(0);
    const extra = (report.items as Item[]).filter((i) => i.kind === 'extra_in_pulse');
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatchObject({ amount: -15.5, manual: true, transactionId: manual.body.id });
  });

  it('дубль операции в Пульсе (ручной ввод копии) находится как лишняя', async () => {
    const { client, accountId } = await setup('rec-dup@example.com', 'recdup');
    await client.post('/api/finance/import/commit', { csv: CSV, accountId });
    await client.post('/api/finance/transactions', {
      accountId,
      type: 'expense',
      amount: 87.05,
      comment: 'Apotek Test',
      date: '2026-09-06',
    });
    const report = (await client.get(`/api/finance/accounts/${accountId}/reconciliation`)).body;
    expect(report.difference).toBe(-87.05);
    expect(report.unexplained).toBe(0);
    expect((report.items as Item[]).map((i) => i.kind)).toEqual(['extra_in_pulse']);
  });

  it('выписка с пропуском: разрыв цепочки остатков виден в отчёте', async () => {
    const { client, accountId } = await setup('rec-break@example.com', 'recbreak');
    const lines = CSV.split('\n').filter((line) => !line.includes('Restaurant Test'));
    const response = await client.post('/api/finance/import/commit', {
      csv: lines.join('\n'),
      accountId,
    });
    expect(response.body.imported).toBe(9);
    const report = (await client.get(`/api/finance/accounts/${accountId}/reconciliation`)).body;
    // Банк считает остаток с пропущенной операцией, Пульс — нет.
    expect(report.bankBalance).toBe(CLOSING);
    expect(report.pulseBalance).toBe(984.9);
    expect(report.difference).toBe(310.75);
    const breaks = (report.items as Item[]).filter((i) => i.kind === 'chain_break');
    expect(breaks).toHaveLength(1);
  });

  it('ручной баланс карты с датой: операции позже даты не входят в разницу', async () => {
    const { client, accountId } = await setup('rec-manual@example.com', 'recmanual');
    await client.post('/api/finance/transactions', {
      accountId,
      type: 'income',
      amount: 500,
      comment: 'Старт',
      date: '2026-10-01',
    });
    await client.post('/api/finance/transactions', {
      accountId,
      type: 'expense',
      amount: 120.1,
      comment: 'Позже',
      date: '2026-10-03',
    });
    const response = await client.put(`/api/finance/accounts/${accountId}/bank-balance`, {
      balance: 500,
      date: '2026-10-02',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      bankSource: 'manual',
      bankBalance: 500,
      bankAsOf: '2026-10-02',
      pulseBalance: 379.9,
      pulseBalanceAsOf: 500,
      difference: 0,
      afterBank: { count: 1, net: -120.1 },
    });
  });

  it('без данных банка отчёт пустой; чужой счёт — 404', async () => {
    const { client, accountId } = await setup('rec-empty@example.com', 'recempty');
    const report = (await client.get(`/api/finance/accounts/${accountId}/reconciliation`)).body;
    expect(report).toMatchObject({ bankBalance: null, difference: null, items: [] });
    const other = await setup('rec-other@example.com', 'recother');
    expect(
      (await other.client.get(`/api/finance/accounts/${accountId}/reconciliation`)).status,
    ).toBe(404);
  });
});
