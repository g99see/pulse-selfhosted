// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты капсулы времени (ТЗ §4, P2) против реального
// PostgreSQL в схеме puls_test: шифрование тела, метаданные до открытия,
// снимок статистики после, планировщик с CAS-захватом и изоляция владельца.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { CapsulesScheduler } from '../src/capsules/capsules.scheduler';
import { PushService } from '../src/notifications/push.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

interface CapsuleDto {
  id: string;
  title: string;
  createdAt: string;
  openAt: string;
  openedAt: string | null;
  open: boolean;
  body?: string | null;
  snapshot?: {
    spent: number;
    earned: number;
    avgMood: number | null;
    checkins: number;
    goals: { title: string; percent: number }[];
  } | null;
}

describe('Capsules API (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let scheduler: CapsulesScheduler;
  let push: PushService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    scheduler = app.get(CapsulesScheduler);
    push = app.get(PushService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    const statements = [
      'DELETE FROM "time_capsules"',
      'DELETE FROM "goal_deposits"',
      'DELETE FROM "goals"',
      'DELETE FROM "transactions"',
      'DELETE FROM "budgets"',
      'DELETE FROM "categories" WHERE "user_id" IS NOT NULL',
      'DELETE FROM "accounts"',
      'DELETE FROM "check_ins"',
      'DELETE FROM "push_subscriptions"',
      'DELETE FROM "notification_rules"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "users"',
    ];
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
    mail.clearOutbox();
    push.clearOutbox();
  });

  async function signUp(email: string, nickname: string): Promise<{ client: TestClient; userId: string }> {
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
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { client, userId: user.id };
  }

  function unique(prefix: string): string {
    return `${prefix}-${Date.now().toString().slice(-9)}-${Math.floor(Math.random() * 1000)}`;
  }

  async function createCapsule(
    client: TestClient,
    body: Record<string, unknown>,
  ): Promise<CapsuleDto> {
    const response = await client.post('/api/capsules', body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as CapsuleDto;
  }

  it('создаёт капсулу-пресет и не отдаёт тело до открытия', async () => {
    const email = `${unique('cap')}@example.com`;
    const { client, userId } = await signUp(email, unique('capuser'));

    const created = await createCapsule(client, {
      title: 'Привет из прошлого',
      body: 'Секретное письмо про цели и деньги.',
      preset: 'month',
    });

    expect(created.open).toBe(false);
    expect(created.openedAt).toBeNull();
    expect(created.body ?? null).toBeNull();
    expect(created.snapshot ?? null).toBeNull();
    // open_at не раньше суток от создания.
    expect(new Date(created.openAt).getTime() - new Date(created.createdAt).getTime()).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1000,
    );

    // Тело лежит в БД зашифрованным (ТЗ §6) и не содержит открытого текста.
    const row = await prisma.timeCapsule.findFirstOrThrow({ where: { userId } });
    expect(row.bodyEncrypted.startsWith('v1.')).toBe(true);
    expect(row.bodyEncrypted).not.toContain('Секретное письмо');

    const list = await client.get('/api/capsules');
    expect(list.status).toBe(200);
    const listItem = (list.body.capsules as CapsuleDto[])[0];
    expect(listItem.title).toBe('Привет из прошлого');
    expect(listItem.body ?? null).toBeNull();
    expect(listItem.snapshot ?? null).toBeNull();

    const detail = await client.get(`/api/capsules/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.body ?? null).toBeNull();
    expect(detail.body.snapshot ?? null).toBeNull();
  });

  it('отклоняет срок раньше суток и позже десяти лет', async () => {
    const { client } = await signUp(`${unique('cap')}@example.com`, unique('capuser'));
    const now = Date.now();

    const tooSoon = await client.post('/api/capsules', {
      title: 'x',
      body: 'y',
      openAt: new Date(now + 60_000).toISOString(),
    });
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.body.code).toBe('capsule_too_soon');

    const tooFar = await client.post('/api/capsules', {
      title: 'x',
      body: 'y',
      openAt: new Date(now + 11 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(tooFar.status).toBe(400);
    expect(tooFar.body.code).toBe('capsule_too_far');

    const neither = await client.post('/api/capsules', { title: 'x', body: 'y' });
    expect(neither.status).toBe(400);
  });

  it('после открытия отдаёт расшифрованное письмо и снимок статистики периода', async () => {
    const { client, userId } = await signUp(`${unique('cap')}@example.com`, unique('capuser'));

    const account = await prisma.account.create({
      data: { userId, name: 'Карта', type: 'card', balance: 0, currency: 'RUB' },
    });
    const created = await createCapsule(client, {
      title: 'Итоги месяца',
      body: 'Как прошёл месяц — вот цифры.',
      preset: 'month',
    });

    // Заполняем период данными: расход, доход, чек-ины и цель.
    await prisma.transaction.createMany({
      data: [
        { userId, accountId: account.id, type: 'expense', amount: 1000, amountBase: 1000, currency: 'RUB', date: new Date() },
        { userId, accountId: account.id, type: 'expense', amount: 500.5, amountBase: 500.5, currency: 'RUB', date: new Date() },
        { userId, accountId: account.id, type: 'income', amount: 2000, amountBase: 2000, currency: 'RUB', date: new Date() },
      ],
    });
    await prisma.checkIn.createMany({
      data: [
        { userId, mood: 5, occurredAt: new Date(), createdAt: new Date() },
        { userId, mood: 4, occurredAt: new Date(), createdAt: new Date() },
      ],
    });
    await prisma.goal.create({
      data: { userId, title: 'Отпуск', targetAmount: 100_000, savedAmount: 40_000 },
    });

    // dev-хук открывает капсулу, не дожидаясь open_at.
    const opened = await client.post(`/api/capsules/${created.id}/dev-open`, {});
    expect(opened.status).toBe(201);
    const detail = opened.body as CapsuleDto;

    expect(detail.open).toBe(true);
    expect(detail.body).toBe('Как прошёл месяц — вот цифры.');
    expect(detail.snapshot).toBeTruthy();
    expect(detail.snapshot?.spent).toBe(1500.5);
    expect(detail.snapshot?.earned).toBe(2000);
    expect(detail.snapshot?.checkins).toBe(2);
    expect(detail.snapshot?.avgMood).toBe(4.5);
    expect(detail.snapshot?.goals[0]).toMatchObject({ title: 'Отпуск', percent: 40 });

    // Снимок сохранён в БД и переиспользуется при повторном чтении.
    const row = await prisma.timeCapsule.findFirstOrThrow({ where: { userId } });
    expect(row.snapshot).toBeTruthy();
    const again = await client.get(`/api/capsules/${created.id}`);
    expect((again.body as CapsuleDto).snapshot?.spent).toBe(1500.5);
  });

  it('планировщик открывает созревшую капсулу один раз и шлёт уведомление', async () => {
    const { client, userId } = await signUp(`${unique('cap')}@example.com`, unique('capuser'));
    await prisma.pushSubscription.create({
      data: {
        userId,
        endpoint: 'https://push.example.com/capsule',
        p256dh: 'BKxTestPushKeyMaterials',
        auth: 'authSecret123',
      },
    });

    const created = await createCapsule(client, {
      title: 'Созревшая',
      body: 'Уже можно читать.',
      preset: 'month',
    });
    const now = new Date();
    await prisma.timeCapsule.update({
      where: { id: created.id },
      data: { openAt: new Date(now.getTime() - 1000) },
    });

    const first = await scheduler.runOnce(now);
    expect(first).toContain(created.id);

    const row = await prisma.timeCapsule.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.openedAt).not.toBeNull();
    expect(row.snapshot).toBeTruthy();

    const delivered = push.outbox().filter((entry) => entry.payload.type === 'capsule');
    expect(delivered).toHaveLength(1);

    // Второй тик ничего не открывает повторно (CAS по opened_at).
    const second = await scheduler.runOnce(now);
    expect(second).toEqual([]);
    expect(push.outbox().filter((entry) => entry.payload.type === 'capsule')).toHaveLength(1);
  });

  it('не отдаёт и не удаляет чужую капсулу', async () => {
    const owner = await signUp(`${unique('cap')}@example.com`, unique('capuser'));
    const stranger = await signUp(`${unique('cap')}@example.com`, unique('capuser'));

    const created = await createCapsule(owner.client, {
      title: 'Личное',
      body: 'Только для меня.',
      preset: 'year',
    });

    const foreign = await stranger.client.get(`/api/capsules/${created.id}`);
    expect(foreign.status).toBe(404);

    const foreignDelete = await stranger.client.del(`/api/capsules/${created.id}`);
    expect(foreignDelete.status).toBe(404);

    const ownDelete = await owner.client.del(`/api/capsules/${created.id}`);
    expect(ownDelete.status).toBe(204);

    const missing = await owner.client.get(`/api/capsules/${created.id}`);
    expect(missing.status).toBe(404);
  });
});
