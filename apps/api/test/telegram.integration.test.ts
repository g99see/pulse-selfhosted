// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты Telegram-бота (ТЗ §3.6, §4) против реального PostgreSQL
// в схеме puls_test. Реальный Telegram API подменён фейком (overrideProvider
// TELEGRAM_API): ни один тест не ходит в сеть.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountModule } from '../src/account/account.module';
import { AuthModule } from '../src/auth/auth.module';
import { MailService } from '../src/auth/mail.service';
import { CheckinsModule } from '../src/checkins/checkins.module';
import { configureApp } from '../src/app.setup';
import { FinanceModule } from '../src/finance/finance.module';
import { NotificationDispatcher } from '../src/notifications/dispatcher';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { OutboxService } from '../src/notifications/outbox.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StatsModule } from '../src/stats/stats.module';
import { TELEGRAM_API, type TelegramApi, type OutgoingMessage } from '../src/telegram/telegram-api';
import { TelegramModule } from '../src/telegram/telegram.module';
import { TestClient } from './client';

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
process.env.TELEGRAM_MODE = 'webhook';

const PASSWORD = 'Secret12345';
const WEBHOOK = '/api/telegram/webhook';
const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

const sent: OutgoingMessage[] = [];
const answered: { id: string; text?: string }[] = [];

const fakeApi: TelegramApi = {
  async sendMessage(message: OutgoingMessage): Promise<void> {
    sent.push(message);
  },
  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    answered.push({ id, text });
  },
  async setCommands(): Promise<void> {},
  async getUpdates(): Promise<unknown[]> {
    return [];
  },
};

/** Последнее сообщение, отправленное в чат. */
function lastSent(chatId: string): OutgoingMessage | undefined {
  return [...sent].reverse().find((message) => message.chatId === chatId);
}

function webhookUpdate(update: object, secret: string | null = 'test-secret') {
  const call = request(WEBHOOK_SERVER as Server)
    .post(WEBHOOK)
    .send(update);
  return secret === null ? call : call.set(SECRET_HEADER, secret);
}

let WEBHOOK_SERVER: Server | string;

describe('Telegram-бот (ТЗ §3.6, §4)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let ipCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuthModule,
        CheckinsModule,
        FinanceModule,
        StatsModule,
        NotificationsModule,
        AccountModule,
        TelegramModule,
      ],
    })
      .overrideProvider(TELEGRAM_API)
      .useValue(fakeApi)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    server = app.getHttpServer() as Server;
    WEBHOOK_SERVER = server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    sent.length = 0;
    answered.length = 0;
    for (const statement of [
      'DELETE FROM "check_in_drafts"',
      'DELETE FROM "check_ins"',
      'DELETE FROM "daily_stats"',
      'DELETE FROM "telegram_links"',
      'DELETE FROM "telegram_link_codes"',
      'DELETE FROM "notification_deliveries"',
      'DELETE FROM "users"',
    ]) {
      await prisma.$executeRawUnsafe(statement);
    }
    mail.clearOutbox();
  });

  async function signUp(
    email: string,
    nickname: string,
  ): Promise<{ client: TestClient; userId: string }> {
    ipCounter += 1;
    const client = new TestClient(server, `10.9.${ipCounter}.1`);
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
    return { client, userId: verified.body.user.id as string };
  }

  /** Регистрация + привязка чата через код из настроек. */
  async function signUpLinked(
    email: string,
    nickname: string,
    chatId: string,
  ): Promise<{ client: TestClient; userId: string }> {
    const account = await signUp(email, nickname);
    const codeResponse = await account.client.post('/api/telegram/link-code');
    expect(codeResponse.status).toBe(201);
    const start = await webhookUpdate({
      update_id: 1,
      message: {
        chat: { id: Number(chatId) },
        from: { username: nickname },
        text: `/start ${codeResponse.body.code}`,
      },
    });
    expect(start.status).toBe(200);
    return account;
  }

  describe('Состояние и код привязки', () => {
    it('без сессии статус недоступен (401)', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/telegram/status')).status).toBe(401);
    });

    it('статус включает бота и показывает отсутствие привязки', async () => {
      const { client } = await signUp('tg-status@example.com', 'tgstatususer');
      const response = await client.get('/api/telegram/status');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ enabled: true, mode: 'webhook', linked: false });
    });

    it('код привязки: TTL 10 минут, в БД только хеш', async () => {
      const { client, userId } = await signUp('tg-code@example.com', 'tgcodeuser');
      const response = await client.post('/api/telegram/link-code');
      expect(response.status).toBe(201);
      expect(response.body.code).toMatch(/^[A-Za-z0-9_-]{8,32}$/);
      expect(response.body.ttlSeconds).toBe(600);

      const stored = await prisma.telegramLinkCode.findFirst({ where: { userId } });
      expect(stored).not.toBeNull();
      expect(stored?.codeHash).not.toBe(response.body.code);
      expect(stored?.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored?.usedAt).toBeNull();
      const ttl = (stored?.expiresAt.getTime() ?? 0) - Date.now();
      expect(ttl).toBeGreaterThan(9 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
    });

    it('ограничение частоты на запрос кода (429)', async () => {
      const { client } = await signUp('tg-flood@example.com', 'tgfloodusr');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await client.post('/api/telegram/link-code')).status).toBe(201);
      }
      const blocked = await client.post('/api/telegram/link-code');
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('rate_limited');
    });
  });

  describe('Вебхук и изоляция', () => {
    it('без секретного заголовка — 403, с неверным — 403', async () => {
      const missing = await webhookUpdate({ update_id: 1 }, null);
      expect(missing.status).toBe(403);
      expect(missing.body.code).toBe('invalid_webhook_secret');

      const wrong = await webhookUpdate({ update_id: 1 }, 'nope');
      expect(wrong.status).toBe(403);
    });

    it('вызов вебхука не требует CSRF-cookie', async () => {
      const response = await webhookUpdate({ update_id: 1 });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    it('неизвестный чат получает только подсказку и не пишет в БД', async () => {
      const status = await webhookUpdate({
        update_id: 1,
        message: { chat: { id: 424242 }, from: {}, text: 'кофе 250' },
      });
      expect(status.status).toBe(200);

      const reply = lastSent('424242');
      expect(reply?.text).toContain('не привязан');
      expect(await prisma.transaction.count()).toBe(0);
      expect(await prisma.checkIn.count()).toBe(0);
    });

    it('/start с неверным кодом не привязывает чат', async () => {
      await signUp('tg-badcode@example.com', 'tgbadcodeus');
      const response = await webhookUpdate({
        update_id: 1,
        message: { chat: { id: 777001 }, from: {}, text: '/start WRONGCODE' },
      });
      expect(response.status).toBe(200);
      expect(lastSent('777001')?.text).toContain('Код не подошёл');
      expect(await prisma.telegramLink.count()).toBe(0);
    });
  });

  describe('Привязка чата', () => {
    it('/start <код> привязывает чат и включает Telegram-чек-ины', async () => {
      const { client, userId } = await signUp('tg-link@example.com', 'tglinkuser');
      const code = await client.post('/api/telegram/link-code');

      const response = await webhookUpdate({
        update_id: 1,
        message: {
          chat: { id: 555 },
          from: { username: 'tg_link_user' },
          text: `/start ${code.body.code}`,
        },
      });
      expect(response.status).toBe(200);
      expect(lastSent('555')?.text).toContain('привязан');

      const link = await prisma.telegramLink.findUnique({ where: { userId } });
      expect(link).toMatchObject({ chatId: '555', username: 'tg_link_user' });

      const storedCode = await prisma.telegramLinkCode.findFirst({ where: { userId } });
      expect(storedCode?.usedAt).not.toBeNull();

      const rule = await prisma.notificationRule.findFirst({
        where: { userId, channel: 'telegram', type: 'checkins' },
      });
      expect(rule?.enabled).toBe(true);

      const status = await client.get('/api/telegram/status');
      expect(status.body).toMatchObject({ linked: true, chatUsername: 'tg_link_user' });

      // Повторный /start в привязанном чате — простое подтверждение.
      await webhookUpdate({
        update_id: 2,
        message: { chat: { id: 555 }, from: {}, text: '/start' },
      });
      expect(lastSent('555')?.text).toContain('уже привязан');
    });

    it('код одноразовый: второй чат по нему не привяжется', async () => {
      const { client } = await signUp('tg-onetime@example.com', 'tgonetimeus');
      const code = await client.post('/api/telegram/link-code');

      await webhookUpdate({
        update_id: 1,
        message: { chat: { id: 801 }, from: {}, text: `/start ${code.body.code}` },
      });
      await webhookUpdate({
        update_id: 2,
        message: { chat: { id: 802 }, from: {}, text: `/start ${code.body.code}` },
      });

      expect(lastSent('802')?.text).toContain('Код не подошёл');
      expect(await prisma.telegramLink.count()).toBe(1);
    });

    it('чат, занятый другим аккаунтом, не перепривязывается', async () => {
      const alice = await signUpLinked('tg-alice@example.com', 'tgaliceuser', '900');
      const bob = await signUp('tg-bob@example.com', 'tgbobuser');
      const code = await bob.client.post('/api/telegram/link-code');

      await webhookUpdate({
        update_id: 3,
        message: { chat: { id: 900 }, from: {}, text: `/start ${code.body.code}` },
      });
      expect(lastSent('900')?.text).toContain('другому аккаунту');

      const link = await prisma.telegramLink.findUnique({ where: { chatId: '900' } });
      expect(link?.userId).toBe(alice.userId);
    });

    it('отвязка чата из настроек', async () => {
      const { client, userId } = await signUpLinked('tg-unlink@example.com', 'tgunlinkus', '910');
      const response = await client.del('/api/telegram/link');
      expect(response.status).toBe(204);
      expect(await prisma.telegramLink.findUnique({ where: { userId } })).toBeNull();
      expect((await client.get('/api/telegram/status')).body.linked).toBe(false);
    });
  });

  describe('Чек-ины из чата', () => {
    const cb = (chat: number, data: string, id = `cb-${data}`) => ({
      update_id: 100,
      callback_query: {
        id,
        data,
        from: { id: 1 },
        message: { message_id: 9, chat: { id: chat } },
      },
    });
    const text = (chat: number, value: string) => ({
      update_id: 101,
      message: { chat: { id: chat }, from: {}, text: value },
    });

    it('/checkin: пошаговый диалог сохраняет ВСЕ поля одной записью, статистика дня их показывает', async () => {
      const { client, userId } = await signUpLinked(
        'tg-checkin@example.com',
        'tgcheckinusr',
        '1001',
      );

      await webhookUpdate(text(1001, '/checkin'));
      expect(
        (lastSent('1001')?.buttons?.flat() ?? []).map((button) => button.callbackData),
      ).toEqual(expect.arrayContaining(['ci:mood:1', 'ci:mood:5']));
      expect(lastSent('1001')?.text).toContain('Шаг 1/6');
      expect(await prisma.checkInDraft.count({ where: { userId } })).toBe(1);

      await webhookUpdate(cb(1001, 'ci:mood:4'));
      await webhookUpdate(cb(1001, 'ci:energy:3'));
      await webhookUpdate(cb(1001, 'ci:stress:2'));
      const sleepButtons = lastSent('1001')?.buttons?.[0]?.map((button) => button.text);
      expect(sleepButtons).toEqual(['4', '5', '6', '7', '8', '9+']);
      await webhookUpdate(text(1001, '7,5'));
      await webhookUpdate(cb(1001, 'ci:tag:1'));
      await webhookUpdate(text(1001, '#йога'));
      await webhookUpdate(cb(1001, 'ci:tags:done'));
      expect(lastSent('1001')?.text).toContain('Шаг 6/6');
      await webhookUpdate(text(1001, 'Хороший день'));

      const summary = lastSent('1001')?.text ?? '';
      expect(summary).toContain('Чек-ин сохранён');
      expect(summary).toContain('Энергия: 3/5');
      expect(summary).toContain('Сон, ч: 7.5');
      expect(summary).toContain('#спорт #йога');
      expect(summary).toContain('Хороший день');

      const checkIns = await prisma.checkIn.findMany({ where: { userId } });
      expect(checkIns).toHaveLength(1);
      expect(checkIns[0]).toMatchObject({
        mood: 4,
        energy: 3,
        stress: 2,
        sleepHours: 7.5,
        tags: ['спорт', 'йога'],
        note: 'Хороший день',
      });
      expect(await prisma.checkInDraft.count({ where: { userId } })).toBe(0);

      const day = await client.get('/api/stats/day');
      expect(day.status).toBe(200);
      expect(day.body).toMatchObject({
        avgMood: 4,
        avgEnergy: 3,
        avgStress: 2,
        avgSleep: 7.5,
        checkins: 1,
      });

      const history = await client.get('/api/checkins');
      expect(history.body.checkIns[0]).toMatchObject({ energy: 3, stress: 2, sleepHours: 7.5 });
    });

    it('пропуск необязательных шагов сохраняет только настроение (старый формат остаётся валидным)', async () => {
      const { client, userId } = await signUpLinked('tg-skip@example.com', 'tgskipuser', '1002');
      await webhookUpdate(text(1002, '/checkin'));
      await webhookUpdate(cb(1002, 'ci:mood:2'));
      await webhookUpdate(cb(1002, 'ci:energy:skip'));
      await webhookUpdate(cb(1002, 'ci:stress:skip'));
      await webhookUpdate(cb(1002, 'ci:sleep:skip'));
      await webhookUpdate(cb(1002, 'ci:tags:done'));
      await webhookUpdate(cb(1002, 'ci:note:skip'));

      const [saved] = await prisma.checkIn.findMany({ where: { userId } });
      expect(saved).toMatchObject({ mood: 2, energy: null, stress: null, sleepHours: null });
      const day = await client.get('/api/stats/day');
      expect(day.body).toMatchObject({
        avgMood: 2,
        avgEnergy: null,
        avgStress: null,
        avgSleep: null,
        checkins: 1,
      });
    });

    it('кнопка настроения из напоминания запускает диалог с готовым настроением', async () => {
      const { userId } = await signUpLinked('tg-remind@example.com', 'tgremindusr', '1003');
      await webhookUpdate(cb(1003, 'ci:mood:5'));
      expect(lastSent('1003')?.text).toContain('Шаг 2/6');
      const draft = await prisma.checkInDraft.findFirst({ where: { userId } });
      expect(draft).toMatchObject({ channel: 'telegram', step: 'energy' });
      expect(draft?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
      expect(await prisma.checkIn.count({ where: { userId } })).toBe(0);

      // Старые кнопки (mood:N) тоже запускают диалог.
      await webhookUpdate(cb(1003, 'mood:3', 'cb-legacy'));
      expect(lastSent('1003')?.text).toContain('Шаг 2/6');
    });

    it('быстрая форма /checkin одной строкой и /mood 4', async () => {
      const { userId } = await signUpLinked('tg-line@example.com', 'tglineuser', '1004');
      await webhookUpdate(text(1004, '/checkin 4 энергия 3 стресс 2 сон 7.5 #спорт заметка'));
      expect(lastSent('1004')?.text).toContain('Чек-ин сохранён');

      await webhookUpdate(text(1004, '/mood 5'));
      await webhookUpdate(text(1004, '/checkin 9'));
      expect(lastSent('1004')?.text).toContain('настроение 1–5');

      const saved = await prisma.checkIn.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      expect(saved).toHaveLength(2);
      expect(saved[0]).toMatchObject({
        mood: 4,
        energy: 3,
        stress: 2,
        sleepHours: 7.5,
        tags: ['спорт'],
        note: 'заметка',
      });
      expect(saved[1]).toMatchObject({ mood: 5, energy: null });
    });

    it('«Отмена» удаляет черновик, истёкший черновик сохраняет настроение', async () => {
      const { userId } = await signUpLinked('tg-cancel@example.com', 'tgcancelusr', '1005');
      await webhookUpdate(text(1005, '/checkin'));
      await webhookUpdate(cb(1005, 'ci:cancel:1'));
      expect(lastSent('1005')?.text).toContain('отменён');
      expect(await prisma.checkInDraft.count({ where: { userId } })).toBe(0);
      expect(await prisma.checkIn.count({ where: { userId } })).toBe(0);

      await webhookUpdate(cb(1005, 'ci:mood:3'));
      await webhookUpdate(cb(1005, 'ci:energy:4'));
      await prisma.checkInDraft.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      // Нажатие по протухшей кнопке — диалог закрыт.
      await webhookUpdate(cb(1005, 'ci:stress:2'));
      expect(lastSent('1005')?.text).toContain('истёк');
    });

    it('чужой чат не может создать чек-ин кнопкой', async () => {
      await webhookUpdate(cb(555444, 'ci:mood:1', 'cb-x'));
      expect(await prisma.checkIn.count()).toBe(0);
      expect(await prisma.checkInDraft.count()).toBe(0);
      expect(lastSent('555444')?.text).toContain('не привязан');
    });

    it('старая запись без новых полей отдаётся API с null и не ломает статистику', async () => {
      const { client, userId } = await signUpLinked('tg-old@example.com', 'tgolduser', '1006');
      await prisma.checkIn.create({ data: { userId, mood: 3 } });
      const list = await client.get('/api/checkins');
      expect(list.body.checkIns[0]).toMatchObject({
        mood: 3,
        energy: null,
        stress: null,
        sleepHours: null,
        tags: [],
        note: null,
      });
      const day = await client.get('/api/stats/day');
      expect(day.body).toMatchObject({ avgMood: 3, avgEnergy: null, checkins: 1 });
    });
  });

  describe('Траты из чата', () => {
    it('«кофе 250» создаёт транзакцию с кнопкой отмены, отмена удаляет', async () => {
      const { client, userId } = await signUpLinked('tg-money@example.com', 'tgmoneyuser', '1101');
      const account = await client.post('/api/finance/accounts', {
        name: 'Карта',
        type: 'card',
        balance: 1000,
      });
      expect(account.status).toBe(201);
      await client.get('/api/finance/overview');

      const response = await webhookUpdate({
        update_id: 2,
        message: { chat: { id: 1101 }, from: {}, text: 'кофе 250' },
      });
      expect(response.status).toBe(200);

      const reply = lastSent('1101');
      expect(reply?.text).toContain('Записал');
      expect(reply?.text).toContain('250');
      const undo = reply?.buttons?.flat()[0];
      expect(undo?.text).toBe('Отменить');

      const transactions = await prisma.transaction.findMany({ where: { userId } });
      expect(transactions).toHaveLength(1);
      expect(Number(transactions[0].amount)).toBe(250);
      expect(transactions[0].comment).toBe('кофе');
      expect(transactions[0].type).toBe('expense');
      expect(undo?.callbackData).toBe(`undo:${transactions[0].id}`);

      await webhookUpdate({
        update_id: 3,
        callback_query: {
          id: 'cb-undo',
          data: `undo:${transactions[0].id}`,
          from: { id: 1 },
          message: { message_id: 12, chat: { id: 1101 } },
        },
      });

      expect(await prisma.transaction.count({ where: { userId } })).toBe(0);
      const account2 = await prisma.account.findUnique({ where: { id: account.body.id } });
      expect(Number(account2?.balance)).toBe(1000);
    });

    it('без счёта подсказывает создать его, а не падает', async () => {
      await signUpLinked('tg-noscore@example.com', 'tgnoscoreus', '1201');
      const response = await webhookUpdate({
        update_id: 2,
        message: { chat: { id: 1201 }, from: {}, text: 'кофе 250' },
      });
      expect(response.status).toBe(200);
      expect(lastSent('1201')?.text).toContain('счёт');
    });

    it('непонятный текст и /help', async () => {
      await signUpLinked('tg-help@example.com', 'tghelpuser', '1301');
      await webhookUpdate({
        update_id: 2,
        message: { chat: { id: 1301 }, from: {}, text: 'привет' },
      });
      expect(lastSent('1301')?.text).toContain('Не понял');

      await webhookUpdate({
        update_id: 3,
        message: { chat: { id: 1301 }, from: {}, text: '/help' },
      });
      expect(lastSent('1301')?.text).toContain('/checkin');
    });

    it('/today отдаёт траты и настроение', async () => {
      const { client } = await signUpLinked('tg-today@example.com', 'tgtodayuser', '1401');
      await client.post('/api/finance/accounts', { name: 'Карта', type: 'card', balance: 500 });
      const account = (await client.get('/api/finance/accounts')).body.accounts[0] as {
        id: string;
      };
      await client.post('/api/finance/transactions', {
        accountId: account.id,
        type: 'expense',
        amount: 120,
        comment: 'обед',
      });

      const response = await webhookUpdate({
        update_id: 2,
        message: { chat: { id: 1401 }, from: {}, text: '/today' },
      });
      expect(response.status).toBe(200);
      expect(lastSent('1401')?.text).toContain('Потрачено');
      expect(lastSent('1401')?.text).toContain('120');
    });
  });

  describe('Диспетчер уведомлений: канал telegram', () => {
    it('чек-ин-вопрос из outbox уходит в чат с inline-кнопками 1–5', async () => {
      const { userId } = await signUpLinked('tg-dispatch@example.com', 'tgdispatchu', '1501');
      const dispatcher = app.get(NotificationDispatcher);

      const delivered = await dispatcher.dispatch(
        {
          userId,
          type: 'checkins',
          channel: 'telegram',
          times: ['09:00'],
          quietHours: { start: 22, end: 8 },
        },
        { now: new Date(), timezone: 'UTC' },
      );
      expect(delivered).toBe(true);

      const result = await app.get(OutboxService).processQueue();
      expect(result.sent).toBe(1);
      const message = lastSent('1501');
      expect(message?.buttons?.flat()).toHaveLength(5);
    });

    it('без привязки чата доставка помечается blocked, а не повторяется', async () => {
      const { userId } = await signUp('tg-none@example.com', 'tgnoneuser');
      const dispatcher = app.get(NotificationDispatcher);
      await dispatcher.dispatch(
        {
          userId,
          type: 'checkins',
          channel: 'telegram',
          times: ['09:00'],
          quietHours: { start: 22, end: 8 },
        },
        { now: new Date(), timezone: 'UTC' },
      );
      const result = await app.get(OutboxService).processQueue();
      expect(result.blocked).toBe(1);
    });
  });

  describe('Экспорт данных', () => {
    it('привязанный Telegram-чат попадает в выгрузку', async () => {
      const { client } = await signUpLinked('tg-export@example.com', 'tgexportusr', '1601');
      const response = await client.get('/api/account/export');
      expect(response.status).toBe(200);
      const doc = response.body as { data: Record<string, unknown[]> };
      expect(doc.data.telegramLinks).toHaveLength(1);
      expect(response.text).toContain('1601');
      expect(response.text).not.toMatch(/code_hash|codeHash/);
    });
  });
});
