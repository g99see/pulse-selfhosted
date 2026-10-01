// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты виджета цели (ТЗ §4, P3) против реального PostgreSQL в
// схеме puls_test: анонимная отдача публичной цели, 404 для приватных и
// subscribers-целей, скрытие сумм, CORS только на чтение и кэш 60 секунд.
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

interface WidgetDto {
  id: string;
  title: string;
  percent: number;
  image: string | null;
  milestones: number[];
  deadline: string | null;
  nickname: string;
}

describe('Goal widget API (интеграция с PostgreSQL)', () => {
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
    // Удаляем только свои данные; чужие таблицы параллельных агентов не трогаем.
    const statements = [
      'DELETE FROM "goal_deposits"',
      'DELETE FROM "goals"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "users"',
    ];
    for (const statement of statements) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch {
        // Соседние фикстуры параллельных агентов могут держать FK — пропускаем.
      }
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

  /** Создаёт цель владельца напрямую в БД: тесту важен только виджет. */
  async function createGoal(
    nickname: string,
    data: { visibility: string; targetAmount: number; savedAmount: number; title?: string },
  ): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { nickname } });
    const goal = await prisma.goal.create({
      data: {
        userId: user.id,
        title: data.title ?? 'Ноутбук',
        targetAmount: data.targetAmount,
        savedAmount: data.savedAmount,
        visibility: data.visibility,
        currency: user.currency,
      },
    });
    return goal.id;
  }

  async function setProfileVisibility(nickname: string, visibility: string): Promise<void> {
    await prisma.user.update({ where: { nickname }, data: { profileVisibility: visibility } });
  }

  it('публичная цель публичного профиля отдаётся анонимно с процентами и вехами', async () => {
    await signUp('ann1@example.com', 'annone');
    await setProfileVisibility('annone', 'public');
    const goalId = await createGoal('annone', {
      visibility: 'public',
      targetAmount: 100000,
      savedAmount: 25000,
    });

    const anon = new TestClient(server);
    const response = await anon.get(`/api/public/widgets/goal/${goalId}`);
    expect(response.status).toBe(200);

    const widget = (response.body as { widget: WidgetDto }).widget;
    expect(widget).toMatchObject({
      id: goalId,
      title: 'Ноутбук',
      percent: 25,
      milestones: [25],
      nickname: 'annone',
    });

    // Суммы по умолчанию скрыты — в ответе только проценты.
    expect(JSON.stringify(response.body)).not.toContain('100000');
    expect(JSON.stringify(response.body)).not.toContain('25000');
    expect(widget).not.toHaveProperty('targetAmount');
    expect(widget).not.toHaveProperty('savedAmount');

    // CORS только на чтение и кэш 60 секунд.
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-methods']).toBe('GET');
    expect(String(response.headers['cache-control'])).toContain('max-age=60');
  });

  it('накопление 100% отдаёт все вехи', async () => {
    await signUp('ann2@example.com', 'anntwo');
    await setProfileVisibility('anntwo', 'public');
    const goalId = await createGoal('anntwo', {
      visibility: 'public',
      targetAmount: 50000,
      savedAmount: 50000,
    });

    const anon = new TestClient(server);
    const response = await anon.get(`/api/public/widgets/goal/${goalId}`);
    expect(response.status).toBe(200);
    const widget = (response.body as { widget: WidgetDto }).widget;
    expect(widget.percent).toBe(100);
    expect(widget.milestones).toEqual([25, 50, 75, 100]);
  });

  it('приватная цель не отдаётся (404)', async () => {
    await signUp('priv1@example.com', 'privone');
    await setProfileVisibility('privone', 'public');
    const goalId = await createGoal('privone', {
      visibility: 'private',
      targetAmount: 1000,
      savedAmount: 0,
    });

    const anon = new TestClient(server);
    const response = await anon.get(`/api/public/widgets/goal/${goalId}`);
    expect(response.status).toBe(404);
  });

  it('цель уровня subscribers не отдаётся анонимно (404)', async () => {
    await signUp('sub1@example.com', 'subone');
    await setProfileVisibility('subone', 'public');
    const goalId = await createGoal('subone', {
      visibility: 'subscribers',
      targetAmount: 1000,
      savedAmount: 100,
    });

    const anon = new TestClient(server);
    const response = await anon.get(`/api/public/widgets/goal/${goalId}`);
    expect(response.status).toBe(404);
  });

  it('публичная цель при закрытом профиле владельца не отдаётся (404)', async () => {
    await signUp('prof1@example.com', 'profone');
    const goalId = await createGoal('profone', {
      visibility: 'public',
      targetAmount: 1000,
      savedAmount: 100,
    });

    const anon = new TestClient(server);
    const response = await anon.get(`/api/public/widgets/goal/${goalId}`);
    expect(response.status).toBe(404);
  });

  it('несуществующая цель — 404', async () => {
    const anon = new TestClient(server);
    const response = await anon.get('/api/public/widgets/goal/nonexistent');
    expect(response.status).toBe(404);
  });
});
