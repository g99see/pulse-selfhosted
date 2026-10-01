// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты карточки «Поделиться» (ТЗ §3.7, сценарий 2) против
// реального PostgreSQL в схеме puls_test. Запуск: pnpm --filter @puls/api test
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

interface GoalDto {
  id: string;
  percent: number;
}

interface SvgResponse {
  status: number;
  contentType: string;
  svg: string;
}

describe('Share card API (интеграция с PostgreSQL)', () => {
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
      'DELETE FROM "user_achievements"',
      'DELETE FROM "goal_deposits"',
      'DELETE FROM "goals"',
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

  async function createGoal(client: TestClient, targetAmount: number): Promise<GoalDto> {
    const response = await client.post('/api/goals', { title: 'Ноутбук', targetAmount });
    expect(response.status).toBe(201);
    return response.body as GoalDto;
  }

  /** GET, возвращающий тело как текст (SVG приходит буфером). */
  async function getSvg(client: TestClient, path: string): Promise<SvgResponse> {
    const response = await client.getBinary(path);
    return {
      status: response.status,
      contentType: String(response.headers['content-type'] ?? ''),
      svg: Buffer.isBuffer(response.body)
        ? response.body.toString('utf8')
        : String(response.body ?? ''),
    };
  }

  describe('SVG-карточка (ТЗ §3.7)', () => {
    it('отдаёт image/svg+xml с процентом и без сумм по умолчанию', async () => {
      const client = await signUp('share-svg@example.com', 'sharesvg');
      const goal = await createGoal(client, 120000);
      const deposit = await client.post(`/api/goals/${goal.id}/deposit`, { amount: 60000 });
      expect(deposit.status).toBe(201);

      const response = await getSvg(client, `/api/share/card?type=goal_progress&id=${goal.id}`);
      expect(response.status).toBe(200);
      expect(response.contentType).toContain('image/svg+xml');
      expect(response.svg).toContain('50%');
      expect(response.svg).toContain('Ноутбук');
      // Суммы по умолчанию скрыты (ТЗ §3.7).
      expect(response.svg).not.toContain('Накоплено');
      expect(response.svg.replace(/\u00a0/g, ' ')).not.toContain('60 000');
    });

    it('при amounts=1 показывает суммы', async () => {
      const client = await signUp('share-amounts@example.com', 'shareamounts');
      const goal = await createGoal(client, 120000);
      await client.post(`/api/goals/${goal.id}/deposit`, { amount: 60000 });

      const response = await getSvg(
        client,
        `/api/share/card?type=goal_progress&id=${goal.id}&amounts=1`,
      );
      expect(response.status).toBe(200);
      expect(response.svg).toContain('Накоплено');
      expect(response.svg.replace(/\u00a0/g, ' ')).toContain('60 000');
    });

    it('формат story задаёт размеры 1080×1920, locale=en — английские подписи', async () => {
      const client = await signUp('share-format@example.com', 'shareformat');
      const goal = await createGoal(client, 1000);

      const response = await getSvg(
        client,
        `/api/share/card?type=goal_progress&id=${goal.id}&format=story&locale=en`,
      );
      expect(response.status).toBe(200);
      expect(response.svg).toContain('width="1080"');
      expect(response.svg).toContain('height="1920"');
      expect(response.svg).toContain('Goal progress');
    });

    it('карточка стрика не требует id', async () => {
      const client = await signUp('share-streak@example.com', 'sharestreak');
      const response = await getSvg(client, '/api/share/card?type=checkin_streak&format=square');
      expect(response.status).toBe(200);
      expect(response.svg).toContain('width="1080"');
      expect(response.svg).toContain('height="1080"');
    });

    it('карточка достижения отдаётся только за полученный бейдж', async () => {
      const client = await signUp('share-badge@example.com', 'sharebadge');
      const notEarned = await getSvg(client, '/api/share/card?type=achievement&id=goal_half');
      expect(notEarned.status).toBe(404);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'share-badge@example.com' },
      });
      await prisma.userAchievement.create({ data: { userId: user.id, code: 'goal_half' } });

      const earned = await getSvg(client, '/api/share/card?type=achievement&id=goal_half');
      expect(earned.status).toBe(200);
      expect(earned.svg).toContain('Половина пути');
    });

    it('карточка среднего настроения формируется без данных', async () => {
      const client = await signUp('share-mood@example.com', 'sharemood');
      const response = await getSvg(client, '/api/share/card?type=avg_mood');
      expect(response.status).toBe(200);
      expect(response.svg).toContain('Среднее настроение');
    });
  });

  describe('PNG-карточка (ТЗ §3.7)', () => {
    it('отдаёт PNG-файл', async () => {
      const client = await signUp('share-png@example.com', 'sharepng');
      const goal = await createGoal(client, 120000);
      await client.post(`/api/goals/${goal.id}/deposit`, { amount: 60000 });

      const response = await client.getBinary(
        `/api/share/card.png?type=goal_progress&id=${goal.id}&format=story`,
      );
      expect(response.status).toBe(200);
      expect(String(response.headers['content-type'])).toContain('image/png');
      const body = response.body as Buffer;
      expect(body.length).toBeGreaterThan(1000);
      // Сигнатура PNG: \x89 P N G.
      expect(body.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
  });

  describe('Валидация и изоляция (ТЗ §6)', () => {
    it('без сессии — 401', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/share/card?type=checkin_streak')).status).toBe(401);
    });

    it('чужую цель разделить нельзя — 404', async () => {
      const alice = await signUp('share-alice@example.com', 'sharealice');
      const bob = await signUp('share-bob@example.com', 'sharebob');
      const aliceGoal = await createGoal(alice, 50000);

      expect((await bob.get(`/api/share/card?type=goal_progress&id=${aliceGoal.id}`)).status).toBe(
        404,
      );
      expect(
        (await bob.get(`/api/share/card.png?type=goal_progress&id=${aliceGoal.id}`)).status,
      ).toBe(404);
    });

    it('отклоняет неизвестный тип и отсутствующий id цели — 400', async () => {
      const client = await signUp('share-validate@example.com', 'sharevalidate');
      expect((await client.get('/api/share/card?type=nope')).status).toBe(400);
      expect((await client.get('/api/share/card?type=goal_progress')).status).toBe(400);
    });
  });
});
