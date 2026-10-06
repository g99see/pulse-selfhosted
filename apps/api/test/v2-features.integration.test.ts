// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты v2 §7–§8: корреляции, цель чек-инов, итог дня по ссылке,
// /spent и бюджетные уведомления (API, быстрый ввод, импорт, бот), уведомление о
// сверке, метрики и request id. Реальный PostgreSQL, Telegram подменён фейком.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { addDays, todayKeyInTimezone } from '@puls/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { BudgetAlerts } from '../src/notifications/budget-alerts';
import { ReconciliationAlerts } from '../src/notifications/reconciliation-alerts';
import { PrismaService } from '../src/prisma/prisma.service';
import { runtimeStats } from '../src/observability/runtime-stats';
import { BOT_COMMANDS } from '../src/telegram/commands';
import { TELEGRAM_API, type OutgoingMessage, type TelegramApi } from '../src/telegram/telegram-api';
import { TestClient } from './client';

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
process.env.TELEGRAM_MODE = 'webhook';

const PASSWORD = 'Secret12345';
const CSV = readFileSync(join(__dirname, 'fixtures', 'statement-synthetic.csv'), 'utf8');
const sent: OutgoingMessage[] = [];
const registered: { command: string; description: string }[][] = [];

const fakeApi: TelegramApi = {
  async sendMessage(message) {
    sent.push(message);
  },
  async answerCallbackQuery() {},
  async setCommands(commands) {
    registered.push(commands);
  },
  async getUpdates() {
    return [];
  },
};

/** Ждёт, пока условие станет истинным (события шины обрабатываются асинхронно). */
async function until<T>(fn: () => Promise<T | null | false>, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('until: условие не выполнилось');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Пульс v2 §7–§8 (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let ipCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TELEGRAM_API)
      .useValue(fakeApi)
      .compile();
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
      'DELETE FROM "notification_deliveries"',
      'DELETE FROM "day_summary_links"',
      'DELETE FROM "insights"',
      'DELETE FROM "account_bank_balances"',
      'DELETE FROM "telegram_links"',
      'DELETE FROM "telegram_link_codes"',
      'DELETE FROM "notification_rules"',
      'DELETE FROM "check_in_drafts"',
      'DELETE FROM "check_ins"',
      'DELETE FROM "daily_stats"',
      'DELETE FROM "transactions"',
      'DELETE FROM "budgets"',
      'DELETE FROM "categories" WHERE "user_id" IS NOT NULL',
      'DELETE FROM "accounts"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "users"',
    ]) {
      await prisma.$executeRawUnsafe(statement);
    }
    mail.clearOutbox();
    sent.length = 0;
  });

  async function signUp(email: string, nickname: string) {
    ipCounter += 1;
    const client = new TestClient(server, `10.7.${ipCounter}.1`);
    await client.csrf();
    expect(
      (await client.post('/api/auth/register', { email, password: PASSWORD, nickname })).status,
    ).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return { client, userId: verified.body.user.id as string };
  }

  /** Пользователь со счётом и привязанным Telegram-чатом. */
  async function setupLinked(email: string, nickname: string, chatId: string, balance = 0) {
    const base = await signUp(email, nickname);
    const account = await base.client.post('/api/finance/accounts', {
      name: 'Карта',
      type: 'card',
      balance,
      currency: 'RUB',
    });
    expect(account.status).toBe(201);
    await prisma.telegramLink.create({ data: { userId: base.userId, chatId } });
    return { ...base, accountId: account.body.id as string };
  }

  async function foodBudget(client: TestClient, limit: number) {
    const categories = (await client.get('/api/finance/categories')).body.categories as {
      id: string;
      name: string;
    }[];
    const food = categories.find((category) => category.name === 'Еда')!;
    const month = new Date().toISOString().slice(0, 7);
    expect(
      (await client.put('/api/finance/budgets', { categoryId: food.id, month, limit })).status,
    ).toBe(200);
    return food.id;
  }

  function webhook(chatId: string, text: string) {
    return request(server)
      .post('/api/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'test-secret')
      .send({ update_id: Date.now(), message: { chat: { id: Number(chatId) }, from: {}, text } });
  }

  const budgetRows = (userId: string) =>
    prisma.notificationDelivery.findMany({ where: { userId, type: 'budget' } });

  /* ----- (a) корреляции ----- */

  describe('корреляции самочувствия и трат', () => {
    async function seedDays(userId: string, spentBad: number, spentGood: number, n: number) {
      const today = todayKeyInTimezone('UTC');
      const rows = [];
      for (let i = 0; i < n; i += 1) {
        // Старше двух недель: недельные отчёты их не пересчитывают.
        rows.push({
          userId,
          date: new Date(`${addDays(today, -20 - i)}T00:00:00.000Z`),
          spent: i % 2 === 0 ? spentBad : spentGood,
          avgSleep: i % 2 === 0 ? 5 : 8,
        });
      }
      await prisma.dailyStat.createMany({ data: rows });
    }

    it('эндпоинт отдаёт значимую корреляцию по сну, остальные без данных', async () => {
      const { client, userId } = await signUp('cor@example.com', 'coruser');
      await seedDays(userId, 1500, 1000, 12);
      const response = await client.get('/api/insights/correlations');
      expect(response.status).toBe(200);
      expect(response.body.windowDays).toBe(60);
      const sleep = response.body.correlations.find(
        (item: { metric: string }) => item.metric === 'sleep',
      );
      expect(sleep).toMatchObject({ badDays: 6, goodDays: 6, diffPercent: 50, significant: true });
      const energy = response.body.correlations.find(
        (item: { metric: string }) => item.metric === 'energy',
      );
      expect(energy).toMatchObject({ enough: false, significant: false });
    });

    it('правило попадает в ленту инсайтов только при достаточной выборке', async () => {
      const rich = await signUp('cor2@example.com', 'coruser2');
      await seedDays(rich.userId, 1500, 1000, 12);
      const feed = await rich.client.get('/api/insights');
      const types = feed.body.insights.map((item: { type: string }) => item.type);
      expect(types).toContain('sleep_spend');
      const insight = feed.body.insights.find(
        (item: { type: string }) => item.type === 'sleep_spend',
      );
      expect(insight.textKey).toBe('insights.text.sleepSpend');
      expect(insight.params.percent).toBe(50);

      const poor = await signUp('cor3@example.com', 'coruser3');
      await seedDays(poor.userId, 1500, 1000, 4);
      const poorFeed = await poor.client.get('/api/insights');
      expect(poorFeed.body.insights.map((item: { type: string }) => item.type)).not.toContain(
        'sleep_spend',
      );
    });

    it('чужие данные не видны, без сессии — 401', async () => {
      const a = await signUp('cor4@example.com', 'coruser4');
      await seedDays(a.userId, 1500, 1000, 12);
      const b = await signUp('cor5@example.com', 'coruser5');
      const response = await b.client.get('/api/insights/correlations');
      expect(
        response.body.correlations.every((item: { badDays: number }) => item.badDays === 0),
      ).toBe(true);
      expect((await new TestClient(server).get('/api/insights/correlations')).status).toBe(401);
    });
  });

  /* ----- (b) цель чек-инов ----- */

  describe('цель чек-инов', () => {
    it('по умолчанию цели нет; задаётся, считает чек-ины недели, снимается', async () => {
      const { client } = await signUp('goal@example.com', 'goaluser');
      expect((await client.get('/api/checkins/goal')).body).toMatchObject({
        perWeek: null,
        percent: null,
        count: 0,
      });

      expect((await client.post('/api/checkins', { mood: 4, tags: [] })).status).toBe(201);
      expect((await client.post('/api/checkins', { mood: 3, tags: [] })).status).toBe(201);

      const set = await client.put('/api/checkins/goal', { perWeek: 4 });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ perWeek: 4, count: 2, percent: 50, reached: false });

      const reached = await client.put('/api/checkins/goal', { perWeek: 2 });
      expect(reached.body).toMatchObject({ percent: 100, reached: true });

      expect((await client.put('/api/checkins/goal', { perWeek: 0 })).status).toBe(400);
      expect((await client.put('/api/checkins/goal', { perWeek: null })).body.perWeek).toBeNull();
    });

    it('чек-ины прошлой недели не считаются', async () => {
      const { client, userId } = await signUp('goal2@example.com', 'goaluser2');
      await prisma.checkIn.create({
        data: { userId, mood: 4, occurredAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) },
      });
      await client.put('/api/checkins/goal', { perWeek: 3 });
      expect((await client.get('/api/checkins/goal')).body.count).toBe(0);
    });

    it('серия чек-инов и достижения доступны через /api/achievements', async () => {
      const { client } = await signUp('goal3@example.com', 'goaluser3');
      await client.post('/api/checkins', { mood: 4, tags: [] });
      const response = await client.get('/api/achievements');
      expect(response.status).toBe(200);
      expect(response.body.streak.current).toBe(1);
      expect(
        response.body.achievements.find((item: { code: string }) => item.code === 'first_checkin')
          .earnedAt,
      ).not.toBeNull();
    });
  });

  /* ----- (e) итог дня по ссылке ----- */

  describe('приватная ссылка «Итог дня»', () => {
    it('создать → открыть без входа → перевыпустить → отозвать', async () => {
      const { client, accountId, userId } = await setupLinked('ds@example.com', 'dsuser', '9001');
      expect((await client.get('/api/day-summary-link')).body).toMatchObject({ active: false });
      await client.post('/api/finance/transactions', {
        accountId,
        type: 'expense',
        amount: 250,
        date: todayKeyInTimezone('UTC'),
        comment: 'секретная покупка',
      });
      await client.post('/api/checkins', { mood: 4, tags: [] });

      const created = await client.post('/api/day-summary-link');
      expect(created.status).toBe(201);
      const token = created.body.token as string;
      expect(created.body.path).toBe(`/d/${token}`);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // В БД только хеш токена.
      const stored = await prisma.daySummaryLink.findUniqueOrThrow({ where: { userId } });
      expect(stored.tokenHash).not.toContain(token);
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      // Без cookie: только итоги, без операций и заметок.
      const open = await request(server).get(`/api/public/day-summary/${token}`);
      expect(open.status).toBe(200);
      expect(open.headers['cache-control']).toBe('no-store');
      expect(open.body.summary).toMatchObject({
        spent: 250,
        earned: 0,
        checkins: 1,
        avgMood: 4,
        nickname: 'dsuser',
      });
      expect(JSON.stringify(open.body)).not.toContain('секретная покупка');
      expect((await client.get('/api/day-summary-link')).body).toMatchObject({ active: true });

      // Перевыпуск делает прежнюю ссылку недействительной.
      const second = await client.post('/api/day-summary-link');
      expect(second.body.token).not.toBe(token);
      expect((await request(server).get(`/api/public/day-summary/${token}`)).status).toBe(404);
      expect(
        (await request(server).get(`/api/public/day-summary/${second.body.token}`)).status,
      ).toBe(200);

      // Отзыв.
      expect((await client.del('/api/day-summary-link')).status).toBe(204);
      expect(
        (await request(server).get(`/api/public/day-summary/${second.body.token}`)).status,
      ).toBe(404);
      expect((await client.get('/api/day-summary-link')).body).toMatchObject({ active: false });
    });

    it('мусорный токен — 404; управление без сессии — 401', async () => {
      expect((await request(server).get('/api/public/day-summary/abc')).status).toBe(404);
      expect((await request(server).get(`/api/public/day-summary/${'x'.repeat(43)}`)).status).toBe(
        404,
      );
      const anon = new TestClient(server);
      await anon.csrf();
      expect((await anon.post('/api/day-summary-link')).status).toBe(401);
    });
  });

  /* ----- (c)(d) бюджет в мессенджер, /spent, /mood, /today, setMyCommands ----- */

  describe('бот и бюджетные уведомления', () => {
    it('меню команд регистрируется через setMyCommands и содержит /spent, /mood, /today', async () => {
      expect(registered.length).toBeGreaterThan(0);
      const names = registered[0]!.map((item) => item.command);
      expect(names).toEqual(expect.arrayContaining(['spent', 'mood', 'today', 'checkin']));
      expect(registered[0]).toEqual(BOT_COMMANDS);
    });

    it('/spent 12 кофе: категория, остаток бюджета, кнопка «Отменить»', async () => {
      const { client, userId } = await setupLinked('sp@example.com', 'spuser', '9101');
      await foodBudget(client, 1000);

      expect((await webhook('9101', '/spent 12 кофе')).status).toBe(200);
      const reply = sent.filter((m) => m.chatId === '9101').at(-1)!;
      expect(reply.text).toContain('Еда');
      expect(reply.text).toContain('осталось');
      expect(reply.text).toMatch(/988/);
      expect(reply.buttons?.[0]?.[0]?.callbackData).toMatch(/^undo:/);

      const tx = await prisma.transaction.findFirstOrThrow({ where: { userId } });
      expect(tx).toMatchObject({ type: 'expense', comment: 'кофе' });
      expect(Number(tx.amount)).toBe(12);
      expect(tx.categoryId).not.toBeNull();
    });

    it('/spent без бюджета и без суммы, +/− в аргументе игнорируется', async () => {
      const { userId } = await setupLinked('sp2@example.com', 'spuser2', '9102');
      await webhook('9102', '/spent такси 300');
      expect(sent.filter((m) => m.chatId === '9102').at(-1)!.text).not.toContain('Бюджет');
      await webhook('9102', '/spent');
      expect(sent.filter((m) => m.chatId === '9102').at(-1)!.text).toContain('/spent 12 кофе');
      await webhook('9102', '/spent +50 обед');
      const txs = await prisma.transaction.findMany({ where: { userId } });
      expect(txs).toHaveLength(2);
      expect(txs.every((tx) => tx.type === 'expense')).toBe(true);
    });

    it('/mood 4 пишет чек-ин, /today показывает итог', async () => {
      const { userId } = await setupLinked('md@example.com', 'mduser', '9103');
      await webhook('9103', '/mood 4');
      expect(await prisma.checkIn.count({ where: { userId, mood: 4 } })).toBe(1);
      await webhook('9103', '/spent 100 обед');
      await webhook('9103', '/today');
      const text = sent.filter((m) => m.chatId === '9103').at(-1)!.text;
      expect(text).toMatch(/100/);
    });

    it('сквозной путь: расход через API → уведомление о бюджете в очереди Telegram', async () => {
      const { client, userId, accountId } = await setupLinked('ba@example.com', 'bauser', '9201');
      const foodId = await foodBudget(client, 1000);
      const create = (amount: number) =>
        client.post('/api/finance/transactions', {
          accountId,
          categoryId: foodId,
          type: 'expense',
          amount,
          date: todayKeyInTimezone('UTC'),
        });
      expect((await create(850)).status).toBe(201);
      const rows = await until(async () => {
        const found = await budgetRows(userId);
        return found.length > 0 ? found : null;
      });
      expect(rows[0]).toMatchObject({ channel: 'telegram', type: 'budget' });
      expect((rows[0]!.payload as { title: string }).title).toContain('85%');
    });

    it('быстрый ввод через API и /spent в боте тоже ведут к уведомлению', async () => {
      const { client, userId } = await setupLinked('bq@example.com', 'bquser', '9202');
      await foodBudget(client, 1000);
      expect(
        (await client.post('/api/finance/transactions/quick', { text: 'обед 850' })).status,
      ).toBe(201);
      await until(async () => ((await budgetRows(userId)).length === 1 ? true : null));

      // Дальше бот: превышение лимита.
      await webhook('9202', '/spent 200 ужин');
      const rows = await until(async () => {
        const found = await budgetRows(userId);
        return found.length === 2 ? found : null;
      });
      expect(
        rows.some((row) => (row.payload as { title: string }).title.includes('превышен')),
      ).toBe(true);
    });

    it('импорт выписки: бюджет пересечён → уведомление; повтор файла молчит', async () => {
      const { client, userId, accountId } = await setupLinked('bi@example.com', 'biuser', '9203');
      const categories = (await client.get('/api/finance/categories')).body.categories as {
        id: string;
        name: string;
      }[];
      // Автокатегория по ключевым словам работает по-русски: «обед» → «Еда».
      const csv = [
        'Date,Time,Title,Amount,Balance',
        '01.09.2026,10.00,Обед в кафе,"-200,00","800,00"',
        '02.09.2026,10.00,Ужин дома,"-150,00","650,00"',
      ].join('\n');
      const food = categories.find((category) => category.name === 'Еда')!;
      expect(
        (
          await client.put('/api/finance/budgets', {
            categoryId: food.id,
            month: '2026-09',
            limit: 300,
          })
        ).status,
      ).toBe(200);

      const commit = await client.post('/api/finance/import/commit', { csv, accountId });
      expect(commit.body.imported).toBe(2);
      const rows = await until(async () => {
        const found = await budgetRows(userId);
        return found.length > 0 ? found : null;
      });
      expect(rows).toHaveLength(1);
      expect((rows[0]!.payload as { title: string }).title).toContain('превышен');

      await client.post('/api/finance/import/commit', { csv, accountId });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await budgetRows(userId)).toHaveLength(1);
    });

    it('onImport напрямую: порог 80% по сумме добавленных расходов', async () => {
      const { client, userId } = await setupLinked('bo@example.com', 'bouser', '9204');
      const foodId = await foodBudget(client, 1000);
      const month = new Date().toISOString().slice(0, 7);
      const account = await prisma.account.findFirstOrThrow({ where: { userId } });
      await prisma.transaction.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: foodId,
          type: 'expense',
          amount: 900,
          amountBase: 900,
          date: new Date(),
        },
      });
      const sentCount = await app
        .get(BudgetAlerts)
        .onImport({ userId, additions: [{ categoryId: foodId, month, amountBase: 900 }] });
      expect(sentCount).toBe(1);
    });
  });

  /* ----- (f) сверка → уведомление ----- */

  describe('уведомление о расхождении сверки', () => {
    it('ненулевая необъяснённая разница после импорта — одно уведомление на выписку', async () => {
      // Стартовый баланс 500 не объясняется выпиской: расхождение 500.
      const { client, userId, accountId } = await setupLinked(
        'rc@example.com',
        'rcuser',
        '9301',
        500,
      );

      await client.post('/api/finance/import/commit', { csv: CSV, accountId });
      const rows = await until(async () => {
        const found = await prisma.notificationDelivery.findMany({
          where: { userId, type: 'reconciliation_mismatch' },
        });
        return found.length > 0 ? found : null;
      });
      expect(rows).toHaveLength(1);
      expect((rows[0]!.payload as { body: string }).body).toContain('Карта');
      expect((rows[0]!.payload as { body: string }).body).toMatch(/500/);

      // Повторная загрузка того же файла — новой выписки по сути нет: молчим.
      await client.post('/api/finance/import/commit', { csv: CSV, accountId });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(
        await prisma.notificationDelivery.count({
          where: { userId, type: 'reconciliation_mismatch' },
        }),
      ).toBe(1);

      // Прямой вызов по уже отмеченной выписке ничего не ставит.
      const statement = await prisma.accountBankBalance.findFirstOrThrow({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
      });
      expect(
        await app
          .get(ReconciliationAlerts)
          .onStatementImported({ userId, accountId, statementId: statement.id }),
      ).toBe(false);
    });

    it('чистый импорт (разница 0) уведомления не даёт', async () => {
      const { client, userId, accountId } = await setupLinked('rc2@example.com', 'rcuser2', '9302');
      await client.post('/api/finance/import/commit', { csv: CSV, accountId });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(
        await prisma.notificationDelivery.count({
          where: { userId, type: 'reconciliation_mismatch' },
        }),
      ).toBe(0);
    });
  });

  /* ----- (h) метрики и request id ----- */

  describe('метрики и логи', () => {
    it('/api/admin/metrics: только admin, содержит доставки, очередь, ошибки, планировщик', async () => {
      const regular = await signUp('mt1@example.com', 'mtuser1');
      expect((await regular.client.get('/api/admin/metrics')).status).toBe(403);
      expect((await new TestClient(server).get('/api/admin/metrics')).status).toBe(401);

      const admin = await signUp('mt2@example.com', 'mtuser2');
      await prisma.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
      await prisma.notificationDelivery.create({
        data: {
          userId: admin.userId,
          channel: 'telegram',
          type: 'budget',
          status: 'queued',
          payload: { type: 'budget', title: 't', body: 'b' },
          nextAttemptAt: new Date(Date.now() + 3600_000),
        },
      });
      runtimeStats.markSchedulerRun(new Date('2026-10-06T10:00:00Z'));

      const response = await admin.client.get('/api/admin/metrics');
      expect(response.status).toBe(200);
      expect(response.body.queueLength).toBe(1);
      expect(response.body.deliveries.counts.queued).toBe(1);
      expect(response.body.deliveries.byChannel.telegram.queued).toBe(1);
      expect(response.body.errorsSinceStart).toEqual(expect.any(Number));
      expect(response.body.lastSchedulerRunAt).toBe('2026-10-06T10:00:00.000Z');
      expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('каждый ответ несёт X-Request-Id; безопасный входящий id сохраняется', async () => {
      const generated = await request(server).get('/health');
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      const echoed = await request(server).get('/health').set('X-Request-Id', 'req-12345678');
      expect(echoed.headers['x-request-id']).toBe('req-12345678');
      const unsafe = await request(server)
        .get('/health')
        .set('X-Request-Id', 'bad id with spaces!');
      expect(unsafe.headers['x-request-id']).not.toBe('bad id with spaces!');
    });
  });
});
