// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты уведомлений (ТЗ §3.6, §7, §9) против реального
// PostgreSQL в схеме puls_test: правила, web-push-подписки и изоляция.
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

interface RuleDto {
  type: string;
  channel: string;
  enabled: boolean;
  times: string[];
  quietHours: { start: number; end: number };
}

interface SubscriptionDto {
  id: string;
  endpoint: string;
  userAgent: string | null;
}

describe('Notifications API (интеграция с PostgreSQL)', () => {
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
      'DELETE FROM "push_subscriptions"',
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

  async function rulesOf(client: TestClient): Promise<RuleDto[]> {
    const response = await client.get('/api/notifications/rules');
    expect(response.status).toBe(200);
    return response.body.rules as RuleDto[];
  }

  const subscription = {
    endpoint: 'https://push.example.com/subscription-1',
    keys: { p256dh: 'BKxTestPushKeyMaterials', auth: 'authSecret123' },
    userAgent: 'vitest',
  };

  describe('Публичный VAPID-ключ (ТЗ §3.6)', () => {
    it('без заданных ключей отправка отключена и это явно видно', async () => {
      const client = new TestClient(server);
      const response = await client.get('/api/notifications/vapid-public-key');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ publicKey: null, enabled: false });
    });

    it('доступен без аутентификации', async () => {
      const response = await new TestClient(server).get('/api/notifications/vapid-public-key');
      expect(response.status).toBe(200);
    });
  });

  describe('Правила уведомлений (ТЗ §3.6, §7)', () => {
    it('требует вход', async () => {
      expect((await new TestClient(server).get('/api/notifications/rules')).status).toBe(401);
    });

    it('возвращает правила по умолчанию для всех пяти типов', async () => {
      const client = await signUp('rules@example.com', 'rulesuser');
      const rules = await rulesOf(client);

      expect(rules).toHaveLength(5);
      const checkins = rules.find((rule) => rule.type === 'checkins');
      expect(checkins).toMatchObject({
        enabled: true,
        channel: 'web_push',
        times: ['09:00', '15:00', '21:00'],
        quietHours: { start: 22, end: 8 },
      });
      expect(rules.some((rule) => rule.type === 'weekly_report' && rule.channel === 'email')).toBe(
        true,
      );
    });

    it('включает и выключает типы отдельно, меняет расписание и тихие часы', async () => {
      const client = await signUp('toggle@example.com', 'toggleuser');

      const updated = await client.put('/api/notifications/rules', {
        rules: [
          {
            type: 'payments',
            channel: 'web_push',
            enabled: false,
            times: ['10:00'],
            quietHours: { start: 23, end: 7 },
          },
        ],
      });
      expect(updated.status).toBe(200);

      const rules = await rulesOf(client);
      const payments = rules.find((rule) => rule.type === 'payments');
      expect(payments).toMatchObject({
        enabled: false,
        times: ['10:00'],
        quietHours: { start: 23, end: 7 },
      });
      expect(rules.find((rule) => rule.type === 'checkins')?.enabled).toBe(true);
    });

    it('принимает число слотов 1–6', async () => {
      const client = await signUp('count@example.com', 'countuser');
      const response = await client.put('/api/notifications/rules', {
        rules: [{ type: 'checkins', enabled: true, times: ['09:00'] }],
      });
      expect(response.status).toBe(200);
      const rules = await rulesOf(client);
      expect(rules.find((rule) => rule.type === 'checkins')?.times).toEqual(['09:00']);
    });

    it('не смешивает правила разных пользователей', async () => {
      const alice = await signUp('alice-notify@example.com', 'alicenotify');
      const bob = await signUp('bob-notify@example.com', 'bobnotify');

      await alice.put('/api/notifications/rules', {
        rules: [{ type: 'budget', enabled: false }],
      });

      const bobRules = await rulesOf(bob);
      expect(bobRules.find((rule) => rule.type === 'budget')?.enabled).toBe(true);
    });

    it('отклоняет некорректное тело', async () => {
      const client = await signUp('bad-rules@example.com', 'badrules');
      const response = await client.put('/api/notifications/rules', {
        rules: [{ type: 'unknown_type', enabled: true }],
      });
      expect(response.status).toBe(400);
    });
  });

  describe('Web-push-подписки (ТЗ §3.6)', () => {
    it('требует вход', async () => {
      const client = new TestClient(server);
      await client.csrf();
      const response = await client.post('/api/notifications/subscriptions', subscription);
      expect(response.status).toBe(401);
    });

    it('сохраняет подписку и возвращает её в списке', async () => {
      const client = await signUp('sub@example.com', 'subuser');
      const created = await client.post('/api/notifications/subscriptions', subscription);
      expect(created.status).toBe(201);
      expect(created.body.endpoint).toBe(subscription.endpoint);

      const list = await client.get('/api/notifications/subscriptions');
      expect(list.status).toBe(200);
      expect((list.body.subscriptions as SubscriptionDto[]).map((s) => s.endpoint)).toContain(
        subscription.endpoint,
      );
    });

    it('обновляет существующую подписку по endpoint без дублей', async () => {
      const client = await signUp('dup@example.com', 'dupuser');
      await client.post('/api/notifications/subscriptions', subscription);
      const again = await client.post('/api/notifications/subscriptions', {
        ...subscription,
        keys: { p256dh: 'UpdatedKey', auth: 'UpdatedAuth' },
      });
      expect(again.status).toBe(201);

      const list = await client.get('/api/notifications/subscriptions');
      expect(list.body.subscriptions).toHaveLength(1);
    });

    it('удаляет подписку по endpoint', async () => {
      const client = await signUp('del-sub@example.com', 'delsub');
      await client.post('/api/notifications/subscriptions', subscription);

      const removed = await client.del('/api/notifications/subscriptions', {
        endpoint: subscription.endpoint,
      });
      expect(removed.status).toBe(204);

      const list = await client.get('/api/notifications/subscriptions');
      expect(list.body.subscriptions).toHaveLength(0);
    });

    it('не даёт удалить чужую подписку', async () => {
      const alice = await signUp('sub-alice@example.com', 'subalice');
      const bob = await signUp('sub-bob@example.com', 'subbob');
      await alice.post('/api/notifications/subscriptions', subscription);

      const removed = await bob.del('/api/notifications/subscriptions', {
        endpoint: subscription.endpoint,
      });
      expect(removed.status).toBe(404);
    });

    it('отклоняет подписку без ключей', async () => {
      const client = await signUp('bad-sub@example.com', 'badsub');
      const response = await client.post('/api/notifications/subscriptions', {
        endpoint: 'https://push.example.com/x',
      });
      expect(response.status).toBe(400);
    });
  });
});
