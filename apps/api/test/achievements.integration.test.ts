// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты стриков и достижений (ТЗ §2, §4, P1) против реального
// PostgreSQL. Запуск: pnpm --filter @puls/api test
import { Prisma } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AchievementsService } from '../src/achievements/achievements.service';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

interface AchievementStatus {
  code: string;
  earned: boolean;
  earnedAt: string | null;
  progress: number;
}

interface StreakDto {
  current: number;
  longest: number;
  checkedToday: boolean;
  todayKey: string;
  lastDayKey: string | null;
  nextMilestone: { code: string; threshold: number } | null;
}

/** Момент ровно n суток назад от текущего (границы дней в UTC). */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/** Последний день прошлого месяца и его ключ YYYY-MM. */
function previousMonth(): { monthKey: string; midDay: Date } {
  const todayKey = new Date().toISOString().slice(0, 10);
  const [year, month] = todayKey.split('-').map(Number);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return {
    monthKey: `${prevYear}-${String(prevMonth).padStart(2, '0')}`,
    midDay: new Date(Date.UTC(prevYear, prevMonth - 1, 15)),
  };
}

describe('Achievements API (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;
  let achievements: AchievementsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    achievements = app.get(AchievementsService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    const statements = [
      'DELETE FROM "user_achievements"',
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
    const registered = await client.post('/api/auth/register', { email, password: PASSWORD, nickname });
    expect(registered.status).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    expect(token).toBeTruthy();
    const verified = await client.post('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    return client;
  }

  async function userIdOf(email: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return user.id;
  }

  async function addCheckIn(userId: string, occurredAt: Date): Promise<void> {
    await prisma.checkIn.create({ data: { userId, mood: 3, occurredAt } });
  }

  function codes(response: { body: { achievements: AchievementStatus[] } }): AchievementStatus[] {
    return response.body.achievements;
  }

  function earnedCode(statuses: AchievementStatus[], code: string): AchievementStatus | undefined {
    return statuses.find((item) => item.code === code);
  }

  describe('Каталог и авторизация (ТЗ §4, §6)', () => {
    it('без сессии — 401', async () => {
      const anon = new TestClient(server);
      await anon.csrf();
      expect((await anon.get('/api/achievements')).status).toBe(401);
      expect((await anon.get('/api/achievements/streak')).status).toBe(401);
    });

    it('отдаёт все бейджи каталога, ещё не полученные', async () => {
      const client = await signUp('catalog@example.com', 'cataloguser');
      const response = await client.get('/api/achievements');

      expect(response.status).toBe(200);
      const statuses = codes(response);
      expect(statuses.length).toBeGreaterThanOrEqual(9);
      for (const status of statuses) {
        expect(status.earned).toBe(false);
        expect(status.earnedAt).toBeNull();
      }
      expect(response.body.streak.current).toBe(0);
    });
  });

  describe('Стрики (ТЗ §4)', () => {
    it('считает подряд идущие дни и не сбрасывается, если сегодня ещё нет чек-ина', async () => {
      const client = await signUp('streak@example.com', 'streakuser');
      const userId = await userIdOf('streak@example.com');
      await addCheckIn(userId, daysAgo(1));
      await addCheckIn(userId, daysAgo(2));

      const streak = (await client.get('/api/achievements/streak')).body as StreakDto;
      expect(streak.current).toBe(2);
      expect(streak.checkedToday).toBe(false);
      expect(streak.nextMilestone?.threshold).toBe(7);
    });

    it('сегодняшний чек-ин входит в стрик', async () => {
      const client = await signUp('streak2@example.com', 'streakuser2');
      const userId = await userIdOf('streak2@example.com');
      await addCheckIn(userId, daysAgo(0));
      await addCheckIn(userId, daysAgo(1));
      await addCheckIn(userId, daysAgo(2));

      const streak = (await client.get('/api/achievements/streak')).body as StreakDto;
      expect(streak.current).toBe(3);
      expect(streak.checkedToday).toBe(true);
    });

    it('пропуск дня разрывает стрик, но самый длинный сохраняется', async () => {
      const client = await signUp('streak3@example.com', 'streakuser3');
      const userId = await userIdOf('streak3@example.com');
      for (const day of [8, 7, 6, 5, 1, 0]) await addCheckIn(userId, daysAgo(day));

      const streak = (await client.get('/api/achievements/streak')).body as StreakDto;
      expect(streak.current).toBe(2);
      expect(streak.longest).toBe(4);
    });

    it('дни считаются в часовом поясе пользователя', async () => {
      const client = await signUp('streak-tz@example.com', 'streaktz');
      const userId = await userIdOf('streak-tz@example.com');
      await prisma.user.update({ where: { id: userId }, data: { timezone: 'Asia/Tokyo' } });
      // 22:30 UTC = уже следующие сутки в Токио (+09:00).
      const now = new Date();
      const tokyoNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      await prisma.checkIn.create({ data: { userId, mood: 4, occurredAt: tokyoNow } });

      const streak = (await client.get('/api/achievements/streak')).body as StreakDto;
      expect(streak.todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(streak.current).toBe(1);
    });
  });

  describe('Условия бейджей (ТЗ §4)', () => {
    it('первый чек-ин выдаётся после записи чек-ина', async () => {
      const client = await signUp('first-checkin@example.com', 'firstcheckin');
      const userId = await userIdOf('first-checkin@example.com');

      const created = await client.post('/api/checkins', { mood: 4 });
      expect(created.status).toBe(201);

      // Выдача происходит сразу после записи чек-ина (явный вызов из сервиса).
      const earned = await prisma.userAchievement.findUnique({
        where: { userId_code: { userId, code: 'first_checkin' } },
      });
      expect(earned).not.toBeNull();

      const response = await client.get('/api/achievements');
      expect(earnedCode(codes(response), 'first_checkin')?.earned).toBe(true);
    });

    it('ленивая проверка при чтении выдаёт бейдж за 7 дней подряд', async () => {
      const client = await signUp('week@example.com', 'weekuser');
      const userId = await userIdOf('week@example.com');
      for (let day = 0; day < 7; day += 1) await addCheckIn(userId, daysAgo(day));

      const response = await client.get('/api/achievements');
      const badge = earnedCode(codes(response), 'checkin_streak_7');
      expect(badge?.earned).toBe(true);
      expect(badge?.earnedAt).not.toBeNull();
      expect(badge?.progress).toBe(1);
      expect(response.body.streak.current).toBe(7);
    });

    it('до 100 дней бейджи за 30 и 100 не выдаются, прогресс растёт', async () => {
      const client = await signUp('week2@example.com', 'weekuser2');
      const userId = await userIdOf('week2@example.com');
      for (let day = 0; day < 10; day += 1) await addCheckIn(userId, daysAgo(day));

      const statuses = codes(await client.get('/api/achievements'));
      expect(earnedCode(statuses, 'checkin_streak_7')?.earned).toBe(true);
      expect(earnedCode(statuses, 'checkin_streak_30')?.earned).toBe(false);
      expect(earnedCode(statuses, 'checkin_streak_100')?.earned).toBe(false);
      const progress = earnedCode(statuses, 'checkin_streak_30')?.progress ?? 0;
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThan(1);
    });

    it('первая транзакция выдаёт бейдж', async () => {
      const client = await signUp('transaction@example.com', 'txuser');
      const userId = await userIdOf('transaction@example.com');
      const account = await prisma.account.create({
        data: { userId, name: 'Карта', type: 'card', balance: 0, currency: 'RUB' },
      });
      await prisma.transaction.create({
        data: {
          userId,
          accountId: account.id,
          type: 'expense',
          amount: new Prisma.Decimal(450),
          currency: 'RUB',
          date: new Date(),
        },
      });

      const statuses = codes(await client.get('/api/achievements'));
      expect(earnedCode(statuses, 'first_transaction')?.earned).toBe(true);
    });

    it('первый закрытый месяц без превышения бюджета выдаёт бейдж', async () => {
      const client = await signUp('budget@example.com', 'budgetuser');
      const userId = await userIdOf('budget@example.com');
      const { monthKey, midDay } = previousMonth();
      const account = await prisma.account.create({
        data: { userId, name: 'Карта', type: 'card', balance: 0, currency: 'RUB' },
      });
      const category = await prisma.category.create({
        data: { userId, name: 'Еда', kind: 'expense', icon: 'utensils', color: '#123456' },
      });
      await prisma.budget.create({
        data: { userId, categoryId: category.id, month: monthKey, limit: new Prisma.Decimal(50_000) },
      });
      await prisma.transaction.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: category.id,
          type: 'expense',
          amount: new Prisma.Decimal(40_000),
          currency: 'RUB',
          date: midDay,
        },
      });

      const statuses = codes(await client.get('/api/achievements'));
      expect(earnedCode(statuses, 'first_budget_closed')?.earned).toBe(true);
    });

    it('превышение бюджета в прошлом месяце не выдаёт бейдж', async () => {
      const client = await signUp('budget-over@example.com', 'budgetover');
      const userId = await userIdOf('budget-over@example.com');
      const { monthKey, midDay } = previousMonth();
      const account = await prisma.account.create({
        data: { userId, name: 'Карта', type: 'card', balance: 0, currency: 'RUB' },
      });
      const category = await prisma.category.create({
        data: { userId, name: 'Еда', kind: 'expense', icon: 'utensils', color: '#123456' },
      });
      await prisma.budget.create({
        data: { userId, categoryId: category.id, month: monthKey, limit: new Prisma.Decimal(50_000) },
      });
      await prisma.transaction.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: category.id,
          type: 'expense',
          amount: new Prisma.Decimal(60_000),
          currency: 'RUB',
          date: midDay,
        },
      });

      const statuses = codes(await client.get('/api/achievements'));
      expect(earnedCode(statuses, 'first_budget_closed')?.earned).toBe(false);
    });
  });

  describe('award: публичный метод для других модулей (цели, ТЗ §4)', () => {
    it('вручает бейдж по коду и он виден при чтении', async () => {
      const client = await signUp('goal@example.com', 'goaluser');
      const userId = await userIdOf('goal@example.com');

      const awarded = await achievements.award(userId, 'goal_half');
      expect(awarded).toBe(true);

      const statuses = codes(await client.get('/api/achievements'));
      expect(earnedCode(statuses, 'goal_half')?.earned).toBe(true);
    });

    it('идемпотентен: повторная выдача не создаёт дубликат', async () => {
      await signUp('idem@example.com', 'idemuser');
      const userId = await userIdOf('idem@example.com');

      expect(await achievements.award(userId, 'goal_complete')).toBe(true);
      expect(await achievements.award(userId, 'goal_complete')).toBe(false);
      expect(await prisma.userAchievement.count({ where: { userId, code: 'goal_complete' } })).toBe(1);
    });

    it('гонка двух вызовов: ровно одна выдача, без ошибок', async () => {
      await signUp('race@example.com', 'raceuser');
      const userId = await userIdOf('race@example.com');

      const results = await Promise.all([
        achievements.award(userId, 'first_goal'),
        achievements.award(userId, 'first_goal'),
      ]);
      expect([...results].sort()).toEqual([false, true]);
      expect(await prisma.userAchievement.count({ where: { userId, code: 'first_goal' } })).toBe(1);
    });

    it('неизвестный код отклоняется', async () => {
      await signUp('unknown@example.com', 'unknownuser');
      const userId = await userIdOf('unknown@example.com');

      await expect(
        achievements.award(userId, 'does_not_exist' as never),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('Изоляция данных (ТЗ §6)', () => {
    it('достижения одного пользователя не видны другому', async () => {
      const alice = await signUp('alice-ach@example.com', 'aliceach');
      const bob = await signUp('bob-ach@example.com', 'bobach');
      const aliceId = await userIdOf('alice-ach@example.com');

      await achievements.award(aliceId, 'goal_complete');

      expect(earnedCode(codes(await alice.get('/api/achievements')), 'goal_complete')?.earned).toBe(true);
      expect(earnedCode(codes(await bob.get('/api/achievements')), 'goal_complete')?.earned).toBe(false);
    });
  });
});
