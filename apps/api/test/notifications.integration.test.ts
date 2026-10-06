// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты уведомлений v2 (каналы Telegram/Discord, outbox, привязка
// Discord, блокировки, миграция web_push → telegram) против реального PostgreSQL.
// Telegram и Discord API подменены фейками — в сеть ничего не уходит.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { DomainEvents } from '../src/api-access/domain-events';
import { DISCORD_API, DiscordApiError, FakeDiscordApi } from '../src/discord/discord-api';
import { DiscordService } from '../src/discord/discord.service';
import { BudgetAlerts } from '../src/notifications/budget-alerts';
import { NotificationDispatcher } from '../src/notifications/dispatcher';
import { OutboxService } from '../src/notifications/outbox.service';
import { MAX_ATTEMPTS } from '../src/notifications/outbox-logic';
import { NotificationsScheduler } from '../src/notifications/scheduler';
import { PrismaService } from '../src/prisma/prisma.service';
import { TELEGRAM_API, type OutgoingMessage, type TelegramApi } from '../src/telegram/telegram-api';
import { TestClient } from './client';

process.env.DISCORD_BOT_TOKEN = 'test-discord-token';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';

const PASSWORD = 'Secret12345';

const sentTelegram: OutgoingMessage[] = [];
let telegramFailure: unknown = null;
const fakeTelegram: TelegramApi = {
  async sendMessage(message) {
    if (telegramFailure) {
      const failure = telegramFailure;
      telegramFailure = null;
      throw failure;
    }
    sentTelegram.push(message);
  },
  async answerCallbackQuery() {},
  async setCommands() {},
  async getUpdates() {
    return [];
  },
};

const fakeDiscord = new FakeDiscordApi();

interface ChannelDto {
  channel: string;
  enabled: boolean;
  configured: boolean;
  linked: boolean;
  blocked: boolean;
  times: string[];
  summaryTime: string;
  quietHours: { start: number; end: number };
  timezone: string | null;
  types: Record<string, boolean>;
}

describe('Уведомления v2 (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let outbox: OutboxService;
  let dispatcher: NotificationDispatcher;
  let discord: DiscordService;
  let ipCounter = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TELEGRAM_API)
      .useValue(fakeTelegram)
      .overrideProvider(DISCORD_API)
      .useValue(fakeDiscord)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    outbox = app.get(OutboxService);
    dispatcher = app.get(NotificationDispatcher);
    discord = app.get(DiscordService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    for (const statement of [
      'DELETE FROM "notification_deliveries"',
      'DELETE FROM "notification_channel_settings"',
      'DELETE FROM "notification_rules"',
      'DELETE FROM "discord_link_codes"',
      'DELETE FROM "discord_links"',
      'DELETE FROM "telegram_links"',
      'DELETE FROM "transactions"',
      'DELETE FROM "budgets"',
      'DELETE FROM "categories" WHERE "user_id" IS NOT NULL',
      'DELETE FROM "accounts"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "check_ins"',
      'DELETE FROM "users"',
    ]) {
      await prisma.$executeRawUnsafe(statement);
    }
    mail.clearOutbox();
    fakeDiscord.clear();
    sentTelegram.length = 0;
    telegramFailure = null;
  });

  async function signUp(
    email: string,
    nickname: string,
  ): Promise<{ client: TestClient; userId: string }> {
    ipCounter += 1;
    const client = new TestClient(server, `10.8.${ipCounter}.1`);
    await client.csrf();
    const registered = await client.post('/api/auth/register', {
      email,
      password: PASSWORD,
      nickname,
    });
    expect(registered.status).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return { client, userId: verified.body.user.id as string };
  }

  async function linkTelegram(userId: string, chatId = `tg-${userId}`): Promise<void> {
    await prisma.telegramLink.create({ data: { userId, chatId } });
  }

  async function linkDiscord(userId: string, discordUserId = `du-${userId}`): Promise<string> {
    const dmChannelId = `dm-${discordUserId}`;
    await prisma.discordLink.create({ data: { userId, discordUserId, dmChannelId } });
    return dmChannelId;
  }

  const message = (type = 'checkins') => ({ type, title: 'Заголовок', body: 'Текст' });

  describe('Настройки каналов', () => {
    it('требует вход', async () => {
      expect((await new TestClient(server).get('/api/notifications/channels')).status).toBe(401);
    });

    it('отдаёт telegram и discord с умолчаниями', async () => {
      const { client } = await signUp('ch@example.com', 'chuser');
      const response = await client.get('/api/notifications/channels');
      expect(response.status).toBe(200);
      const channels = response.body.channels as ChannelDto[];
      expect(channels.map((item) => item.channel)).toEqual(['telegram', 'discord']);
      expect(channels[0]).toMatchObject({
        enabled: true,
        linked: false,
        configured: true,
        times: ['09:00', '15:00', '21:00'],
        quietHours: { start: 22, end: 8 },
        timezone: null,
      });
      expect(channels[0]!.types.daily_summary).toBe(true);
      expect(channels[0]!.types.reconciliation_mismatch).toBe(true);
    });

    it('сохраняет включение, расписание, тихие часы, часовой пояс и типы по каналу', async () => {
      const { client } = await signUp('ch2@example.com', 'ch2user');
      const updated = await client.put('/api/notifications/channels/discord', {
        enabled: false,
        times: ['10:00', '20:00'],
        summaryTime: '22:15',
        quietHours: { start: 23, end: 7 },
        timezone: 'Europe/Berlin',
        types: { budget: false },
      });
      expect(updated.status).toBe(200);
      const [telegram, discordChannel] = updated.body.channels as ChannelDto[];
      expect(discordChannel).toMatchObject({
        enabled: false,
        times: ['10:00', '20:00'],
        summaryTime: '22:15',
        quietHours: { start: 23, end: 7 },
        timezone: 'Europe/Berlin',
      });
      expect(discordChannel!.types.budget).toBe(false);
      // Другой канал не затронут.
      expect(telegram!.enabled).toBe(true);
      expect(telegram!.types.budget).toBe(true);
    });

    it('отклоняет неизвестный канал, плохой пояс и web_push', async () => {
      const { client } = await signUp('ch3@example.com', 'ch3user');
      expect((await client.put('/api/notifications/channels/web_push', {})).status).toBe(404);
      expect(
        (await client.put('/api/notifications/channels/telegram', { timezone: 'Mars/Base' }))
          .status,
      ).toBe(400);
      expect(
        (await client.put('/api/notifications/channels/telegram', { times: ['xx'] })).status,
      ).toBe(400);
    });

    it('не смешивает настройки разных пользователей', async () => {
      const alice = await signUp('a-ch@example.com', 'achuser');
      const bob = await signUp('b-ch@example.com', 'bchuser');
      await alice.client.put('/api/notifications/channels/telegram', { enabled: false });
      const bobChannels = (await bob.client.get('/api/notifications/channels')).body
        .channels as ChannelDto[];
      expect(bobChannels[0]!.enabled).toBe(true);
    });

    it('старые эндпоинты web push удалены', async () => {
      const { client } = await signUp('old@example.com', 'olduser');
      expect((await client.get('/api/notifications/vapid-public-key')).status).toBe(404);
      expect((await client.get('/api/notifications/subscriptions')).status).toBe(404);
      expect((await client.post('/api/notifications/subscriptions', {})).status).toBe(404);
    });
  });

  describe('Привязка Discord', () => {
    it('статус и код привязки: TTL 10 минут, в БД только хеш', async () => {
      const { client, userId } = await signUp('dc1@example.com', 'dc1user');
      const status = await client.get('/api/discord/status');
      expect(status.body).toMatchObject({ enabled: true, linked: false, blocked: false });

      const created = await client.post('/api/discord/link-code');
      expect(created.status).toBe(201);
      expect(created.body.ttlSeconds).toBe(600);
      const row = await prisma.discordLinkCode.findFirstOrThrow({ where: { userId } });
      expect(row.codeHash).not.toContain(created.body.code as string);
    });

    it('slash-команда /link code:<код> привязывает аккаунт и открывает DM', async () => {
      const { client, userId } = await signUp('dc2@example.com', 'dc2user');
      const { code } = (await client.post('/api/discord/link-code')).body as { code: string };

      await discord.handleEvent({
        kind: 'interaction',
        discordUserId: '555',
        username: 'neo',
        interactionId: 'i1',
        token: 't1',
        command: 'link',
        code,
      });

      const link = await prisma.discordLink.findUniqueOrThrow({ where: { userId } });
      expect(link).toMatchObject({ discordUserId: '555', dmChannelId: 'dm-555', username: 'neo' });
      expect(fakeDiscord.responses.at(-1)?.content).toContain('привязан');
      expect((await client.get('/api/discord/status')).body).toMatchObject({
        linked: true,
        username: 'neo',
      });
    });

    it('личное сообщение «/link КОД» тоже привязывает; код одноразовый', async () => {
      const { client, userId } = await signUp('dc3@example.com', 'dc3user');
      const { code } = (await client.post('/api/discord/link-code')).body as { code: string };

      await discord.handleEvent({
        kind: 'message',
        discordUserId: '556',
        username: 'trinity',
        channelId: 'dm-556',
        text: `/link ${code}`,
      });
      expect(
        (await prisma.discordLink.findUniqueOrThrow({ where: { userId } })).discordUserId,
      ).toBe('556');

      // Второй Discord-аккаунт тем же кодом не привяжется.
      await discord.handleEvent({
        kind: 'message',
        discordUserId: '557',
        username: 'morpheus',
        channelId: 'dm-557',
        text: `/link ${code}`,
      });
      expect(await prisma.discordLink.count()).toBe(1);
      expect(fakeDiscord.lastTo('dm-557')?.content).toContain('не подошёл');
    });

    it('неверный код не привязывает, любая реплика получает подсказку', async () => {
      await signUp('dc4@example.com', 'dc4user');
      await discord.handleEvent({
        kind: 'message',
        discordUserId: '558',
        username: 'x',
        channelId: 'dm-558',
        text: '/link wrongcode99',
      });
      expect(await prisma.discordLink.count()).toBe(0);
      await discord.handleEvent({
        kind: 'message',
        discordUserId: '558',
        username: 'x',
        channelId: 'dm-558',
        text: 'привет',
      });
      expect(fakeDiscord.lastTo('dm-558')?.content).toContain('/link');
    });

    it('Discord-аккаунт, занятый другим пользователем, не перепривязывается', async () => {
      const first = await signUp('dc5a@example.com', 'dc5a');
      const second = await signUp('dc5b@example.com', 'dc5b');
      await linkDiscord(first.userId, '600');
      const { code } = (await second.client.post('/api/discord/link-code')).body as {
        code: string;
      };

      await discord.handleEvent({
        kind: 'message',
        discordUserId: '600',
        username: 'x',
        channelId: 'dm-600',
        text: `/link ${code}`,
      });
      expect(await prisma.discordLink.findFirst({ where: { userId: second.userId } })).toBeNull();
    });

    it('отвязка из настроек', async () => {
      const { client, userId } = await signUp('dc6@example.com', 'dc6user');
      await linkDiscord(userId);
      expect((await client.del('/api/discord/link')).status).toBe(204);
      expect(await prisma.discordLink.count()).toBe(0);
    });
  });

  describe('Outbox: отправка, повторы, блокировки', () => {
    it('Discord: сообщение ставится в очередь и уходит личным сообщением', async () => {
      const { userId } = await signUp('ob1@example.com', 'ob1user');
      const channelId = await linkDiscord(userId);

      expect(await dispatcher.notify(userId, 'checkins', message())).toBe(1);
      const queued = await prisma.notificationDelivery.findFirstOrThrow({ where: { userId } });
      expect(queued).toMatchObject({ channel: 'discord', status: 'queued', attempts: 0 });

      const result = await outbox.processQueue();
      expect(result.sent).toBe(1);
      expect(fakeDiscord.lastTo(channelId)?.content).toContain('Заголовок');
      const done = await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: queued.id },
      });
      expect(done).toMatchObject({ status: 'sent', attempts: 1 });
      expect(done.sentAt).not.toBeNull();
    });

    it('Telegram: чек-ин уходит с кнопками 1–5', async () => {
      const { userId } = await signUp('ob2@example.com', 'ob2user');
      await linkTelegram(userId, '7001');
      await dispatcher.notify(userId, 'checkins', { ...message(), kind: 'checkin' });
      await outbox.processQueue();
      expect(sentTelegram.at(-1)?.chatId).toBe('7001');
      expect(sentTelegram.at(-1)?.buttons?.flat()).toHaveLength(5);
    });

    it('сообщение уходит в оба привязанных канала', async () => {
      const { userId } = await signUp('ob3@example.com', 'ob3user');
      await linkTelegram(userId);
      await linkDiscord(userId);
      expect(await dispatcher.notify(userId, 'payments', message('payments'))).toBe(2);
      expect((await outbox.processQueue()).sent).toBe(2);
    });

    it('выключенный канал, тип и общий переключатель не получают сообщений', async () => {
      const { client, userId } = await signUp('ob4@example.com', 'ob4user');
      await linkTelegram(userId);
      await client.put('/api/notifications/channels/telegram', { types: { budget: false } });
      expect(await dispatcher.notify(userId, 'budget', message('budget'))).toBe(0);
      await client.put('/api/notifications/channels/telegram', { enabled: false });
      expect(await dispatcher.notify(userId, 'checkins', message())).toBe(0);
      await client.put('/api/notifications/channels/telegram', { enabled: true });
      await prisma.user.update({ where: { id: userId }, data: { notificationsEnabled: false } });
      expect(await dispatcher.notify(userId, 'checkins', message())).toBe(0);
    });

    it('временная ошибка: backoff, повтор позже, затем отправка', async () => {
      const { userId } = await signUp('ob5@example.com', 'ob5user');
      const channelId = await linkDiscord(userId);
      fakeDiscord.failures.push(new DiscordApiError('Server error', 500, undefined));
      await dispatcher.notify(userId, 'checkins', message());

      const t0 = new Date();
      const first = await outbox.processQueue(t0);
      expect(first).toMatchObject({ sent: 0, retried: 1 });
      const retry = await prisma.notificationDelivery.findFirstOrThrow({ where: { userId } });
      expect(retry).toMatchObject({ status: 'queued', attempts: 1 });
      expect(retry.lastError).toContain('Server error');
      expect(retry.nextAttemptAt.getTime()).toBe(t0.getTime() + 30_000);

      // До срока повтора запись не трогаем.
      expect((await outbox.processQueue(new Date(t0.getTime() + 10_000))).sent).toBe(0);

      const later = new Date(t0.getTime() + 31_000);
      expect((await outbox.processQueue(later)).sent).toBe(1);
      expect(fakeDiscord.lastTo(channelId)).toBeDefined();
      expect(
        (await prisma.notificationDelivery.findFirstOrThrow({ where: { userId } })).status,
      ).toBe('sent');
    });

    it(`после ${MAX_ATTEMPTS} неудач запись становится failed и больше не отправляется`, async () => {
      const { userId } = await signUp('ob6@example.com', 'ob6user');
      await linkDiscord(userId);
      await dispatcher.notify(userId, 'checkins', message());

      let now = new Date();
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        fakeDiscord.failures.push(new DiscordApiError('boom', 500, undefined));
        await outbox.processQueue(now);
        now = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      }
      const row = await prisma.notificationDelivery.findFirstOrThrow({ where: { userId } });
      expect(row).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
      expect((await outbox.processQueue(now)).sent).toBe(0);
    });

    it('Discord 50007: привязка блокируется, очередь гасится, новые не ставятся', async () => {
      const { userId } = await signUp('ob7@example.com', 'ob7user');
      await linkDiscord(userId);
      await dispatcher.notify(userId, 'checkins', message());
      await dispatcher.notify(userId, 'payments', message('payments'));
      fakeDiscord.failures.push(
        new DiscordApiError('Cannot send messages to this user', 403, 50007),
      );

      const result = await outbox.processQueue();
      expect(result.blocked).toBe(1);
      const rows = await prisma.notificationDelivery.findMany({ where: { userId } });
      expect(rows.map((row) => row.status).sort()).toEqual(['blocked', 'blocked']);
      expect(
        (await prisma.discordLink.findUniqueOrThrow({ where: { userId } })).blockedAt,
      ).not.toBeNull();

      expect(await dispatcher.notify(userId, 'checkins', message())).toBe(0);
      expect(await prisma.notificationDelivery.count({ where: { userId } })).toBe(2);
    });

    it('Telegram 403 «bot was blocked»: привязка блокируется и статус это показывает', async () => {
      const { client, userId } = await signUp('ob8@example.com', 'ob8user');
      await linkTelegram(userId, '7002');
      await dispatcher.notify(userId, 'checkins', message());
      telegramFailure = { error_code: 403, description: 'Forbidden: bot was blocked by the user' };

      expect((await outbox.processQueue()).blocked).toBe(1);
      expect(
        (await prisma.telegramLink.findUniqueOrThrow({ where: { userId } })).blockedAt,
      ).not.toBeNull();
      expect((await client.get('/api/telegram/status')).body.blocked).toBe(true);
      const channels = (await client.get('/api/notifications/channels')).body
        .channels as ChannelDto[];
      expect(channels[0]).toMatchObject({ linked: true, blocked: true });
      expect(await dispatcher.notify(userId, 'checkins', message())).toBe(0);
    });

    it('тихие часы: отправка откладывается до их конца', async () => {
      const { userId } = await signUp('ob9@example.com', 'ob9user');
      await linkTelegram(userId);
      // 23:30 UTC при тихих часах 22–08 (пояс канала UTC).
      const now = new Date('2026-10-01T23:30:00Z');
      await outbox.enqueue(userId, 'telegram', message(), {
        now,
        timezone: 'UTC',
        quietHours: { start: 22, end: 8 },
      });
      const row = await prisma.notificationDelivery.findFirstOrThrow({ where: { userId } });
      expect(row.nextAttemptAt.toISOString()).toBe('2026-10-02T08:00:00.000Z');
      expect((await outbox.processQueue(now)).sent).toBe(0);
      expect((await outbox.processQueue(new Date('2026-10-02T08:00:01Z'))).sent).toBe(1);
    });
  });

  describe('Журнал и метрики', () => {
    it('пользователь видит последние 20 доставок, чужие — нет', async () => {
      const alice = await signUp('lg-a@example.com', 'lgalice');
      const bob = await signUp('lg-b@example.com', 'lgbob');
      await linkTelegram(alice.userId);
      await linkTelegram(bob.userId);
      for (let i = 0; i < 25; i += 1) {
        await dispatcher.notify(alice.userId, 'checkins', message());
      }
      await dispatcher.notify(bob.userId, 'checkins', message());

      const log = await alice.client.get('/api/notifications/deliveries');
      expect(log.status).toBe(200);
      expect(log.body.deliveries).toHaveLength(20);
      expect(log.body.deliveries[0]).toMatchObject({ channel: 'telegram', status: 'queued' });
      expect(log.body.deliveries[0]).not.toHaveProperty('payload');
      expect((await bob.client.get('/api/notifications/deliveries')).body.deliveries).toHaveLength(
        1,
      );
    });

    it('метрики по статусам — только админу', async () => {
      const admin = await signUp('mt-admin@example.com', 'mtadmin');
      const regular = await signUp('mt-user@example.com', 'mtuser');
      await prisma.user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
      await linkTelegram(regular.userId);
      await dispatcher.notify(regular.userId, 'checkins', message());
      await dispatcher.notify(regular.userId, 'payments', message('payments'));
      await outbox.processQueue();
      await dispatcher.notify(regular.userId, 'budget', message('budget'));

      expect((await regular.client.get('/api/admin/notifications/metrics')).status).toBe(403);
      const metrics = await admin.client.get('/api/admin/notifications/metrics');
      expect(metrics.status).toBe(200);
      expect(metrics.body.counts).toEqual({ queued: 1, sent: 2, failed: 0, blocked: 0 });
      expect(metrics.body.byChannel.telegram.sent).toBe(2);
    });
  });

  describe('Типы уведомлений', () => {
    it('итог дня: планировщик ставит в очередь сообщение с тратами и настроением', async () => {
      const { client, userId } = await signUp('sm@example.com', 'smuser');
      await linkDiscord(userId);
      await prisma.user.update({ where: { id: userId }, data: { timezone: 'UTC' } });
      await client.put('/api/notifications/channels/discord', {
        times: ['09:00'],
        summaryTime: '21:30',
        types: { checkins: false },
      });
      await prisma.checkIn.create({ data: { userId, mood: 4, occurredAt: new Date() } });

      const scheduler = app.get(NotificationsScheduler);
      const due = await scheduler.runOnce(
        new Date('2026-10-01T21:35:00Z'),
        new Date('2026-10-01T21:25:00Z'),
      );
      expect(due.map((item) => item.type)).toEqual(['daily_summary']);

      const row = await prisma.notificationDelivery.findFirstOrThrow({ where: { userId } });
      expect(row).toMatchObject({ channel: 'discord', type: 'daily_summary' });
      const payload = row.payload as { title: string; body: string };
      expect(payload.title).toContain('Итог дня');
      expect(payload.body).toMatch(/Потрачено[\s\S]*Получено[\s\S]*Настроение[\s\S]*Чек-инов/);
    });

    it('бюджет: 80% и превышение ставят уведомления один раз на порог', async () => {
      const { userId } = await signUp('bd@example.com', 'bduser');
      await linkTelegram(userId);
      const account = await prisma.account.create({ data: { userId, name: 'Карта' } });
      const category = await prisma.category.create({ data: { userId, name: 'Еда' } });
      const month = new Date().toISOString().slice(0, 7);
      await prisma.budget.create({ data: { userId, categoryId: category.id, month, limit: 1000 } });
      const alerts = app.get(BudgetAlerts);

      async function spend(amount: number): Promise<boolean> {
        const transaction = await prisma.transaction.create({
          data: {
            userId,
            accountId: account.id,
            categoryId: category.id,
            type: 'expense',
            amount,
            amountBase: amount,
            date: new Date(),
          },
        });
        return alerts.onTransaction({
          event: 'transaction.created',
          userId,
          data: { id: transaction.id, type: 'expense' },
          occurredAt: new Date().toISOString(),
        });
      }

      expect(await spend(500)).toBe(false); // 50%
      expect(await spend(350)).toBe(true); // 85% — предупреждение
      expect(await spend(50)).toBe(false); // 90% — порог уже пройден
      expect(await spend(200)).toBe(true); // 110% — превышено
      expect(await spend(100)).toBe(false);

      const rows = await prisma.notificationDelivery.findMany({
        where: { userId, type: 'budget' },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect((rows[0]!.payload as { title: string }).title).toContain('85%');
      expect((rows[1]!.payload as { title: string }).title).toContain('превышен');
    });

    it('доменное событие transaction.created доходит до подписчика бюджета', async () => {
      const { userId } = await signUp('bd2@example.com', 'bd2user');
      await linkTelegram(userId);
      // Подписка живая: событие без транзакции в БД безвредно.
      expect(() =>
        DomainEvents.emit('transaction.created', userId, { id: 'missing', type: 'expense' }),
      ).not.toThrow();
    });

    it('reconciliation_mismatch: хук ставит уведомление и уважает переключатель типа', async () => {
      const { client, userId } = await signUp('rc@example.com', 'rcuser');
      await linkTelegram(userId);
      const info = { accountName: 'Карта', difference: '120 ₽' };

      expect(await dispatcher.notifyReconciliationMismatch(userId, info)).toBe(true);
      expect(
        await prisma.notificationDelivery.count({ where: { type: 'reconciliation_mismatch' } }),
      ).toBe(1);

      await client.put('/api/notifications/channels/telegram', {
        types: { reconciliation_mismatch: false },
      });
      expect(await dispatcher.notifyReconciliationMismatch(userId, info)).toBe(false);
    });
  });

  describe('Миграция: web_push → telegram', () => {
    function migrationSegment(name: string): string {
      const sql = readFileSync(
        join(__dirname, '../prisma/migrations/20261006120000_notifications_v2/migration.sql'),
        'utf8',
      );
      const start = sql.indexOf(`-- BEGIN ${name}`);
      const end = sql.indexOf(`-- END ${name}`);
      expect(start).toBeGreaterThan(-1);
      return sql.slice(start, end);
    }

    async function runSegment(name: string): Promise<void> {
      const sql = migrationSegment(name)
        .split('\n')
        .filter((line) => !line.startsWith('--'))
        .join('\n');
      for (const statement of sql
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)) {
        await prisma.$executeRawUnsafe(statement);
      }
    }

    it('переносит правила web_push и email в telegram, конфликты решает в пользу telegram', async () => {
      const a = await signUp('mg-a@example.com', 'mga');
      const b = await signUp('mg-b@example.com', 'mgb');
      const raw = (userId: string, type: string, channel: string, enabled = true) =>
        prisma.notificationRule.create({ data: { userId, type, channel, enabled } });

      await raw(a.userId, 'checkins', 'web_push');
      await raw(a.userId, 'budget', 'web_push', false);
      await raw(a.userId, 'weekly_report', 'email');
      // У b уже есть правило в telegram — оно выигрывает у старого web_push.
      await raw(b.userId, 'checkins', 'telegram', false);
      await raw(b.userId, 'checkins', 'web_push', true);
      // Дубль web_push + email одного типа схлопывается в одно правило.
      await raw(b.userId, 'payments', 'web_push');
      await raw(b.userId, 'payments', 'email');

      await runSegment('web_push_to_telegram');

      const rules = await prisma.notificationRule.findMany({
        orderBy: [{ userId: 'asc' }, { type: 'asc' }],
      });
      expect(rules.every((rule) => rule.channel === 'telegram')).toBe(true);

      const ofA = rules.filter((rule) => rule.userId === a.userId);
      expect(ofA.map((rule) => [rule.type, rule.enabled]).sort()).toEqual([
        ['budget', false],
        ['checkins', true],
        ['weekly_report', true],
      ]);
      const ofB = rules.filter((rule) => rule.userId === b.userId);
      expect(ofB.filter((rule) => rule.type === 'checkins')).toEqual([
        expect.objectContaining({ enabled: false }),
      ]);
      expect(ofB.filter((rule) => rule.type === 'payments')).toHaveLength(1);
    });

    it('расписание и тихие часы правила checkins переезжают в настройки канала', async () => {
      const { userId } = await signUp('mg-c@example.com', 'mgc');
      await prisma.notificationRule.create({
        data: {
          userId,
          type: 'checkins',
          channel: 'telegram',
          schedule: { times: ['08:00', '20:00'] },
          quietHoursStart: 23,
          quietHoursEnd: 7,
        },
      });
      await runSegment('channel_settings_from_rules');
      const setting = await prisma.notificationChannelSetting.findFirstOrThrow({
        where: { userId },
      });
      expect(setting).toMatchObject({ channel: 'telegram', quietStart: 23, quietEnd: 7 });
      expect(setting.schedule).toEqual({ times: ['08:00', '20:00'], summaryTime: '21:30' });
    });

    it('таблицы push_subscriptions больше нет', async () => {
      const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT to_regclass(current_schema() || '.push_subscriptions') IS NOT NULL AS exists`,
      );
      expect(rows[0]!.exists).toBe(false);
    });
  });
});
