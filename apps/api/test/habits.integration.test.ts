// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты трекера привычек (ТЗ §4, P2) против реального
// PostgreSQL в схеме puls_test. Запуск: pnpm --filter @puls/api exec vitest run test/habits.integration.test.ts
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

interface HabitDto {
  id: string;
  name: string;
  icon: string;
  cadence: string;
  perWeek: number;
  archived: boolean;
  createdAt: string;
}

interface HabitStatsLike {
  streak: number;
  rate7: number;
  rate30: number;
  totalDone: number;
}

interface HabitTodayItem extends HabitDto, HabitStatsLike {
  done: boolean;
}

/** Ключ календарного дня (UTC) со сдвигом от сегодня. */
function dayKey(offset = 0): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  return date.toISOString().slice(0, 10);
}

describe('Habits API (интеграция с PostgreSQL)', () => {
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
      'DELETE FROM "habit_logs"',
      'DELETE FROM "habits"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "users"',
    ];
    for (const statement of statements) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch {
        // FK соседних фикстур параллельных агентов может помешать — пропускаем.
      }
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

  async function createHabit(client: TestClient, body: Record<string, unknown>): Promise<HabitDto> {
    const response = await client.post('/api/habits', body);
    expect(response.status).toBe(201);
    return response.body as HabitDto;
  }

  describe('CRUD привычек (ТЗ §4)', () => {
    it('создаёт ежедневную привычку с иконкой', async () => {
      const client = await signUp('habit@example.com', 'habituser');
      const habit = await createHabit(client, { name: 'Вода', icon: '💧', cadence: 'daily' });

      expect(habit).toMatchObject({ name: 'Вода', icon: '💧', cadence: 'daily', perWeek: 1, archived: false });
    });

    it('создаёт недельную привычку с целью в неделю', async () => {
      const client = await signUp('habit-week@example.com', 'habitweek');
      const habit = await createHabit(client, { name: 'Спорт', icon: '🏃', cadence: 'weekly', perWeek: 3 });
      expect(habit).toMatchObject({ cadence: 'weekly', perWeek: 3 });
    });

    it('правит, архивирует, читает и удаляет привычку', async () => {
      const client = await signUp('habit-edit@example.com', 'habitedit');
      const habit = await createHabit(client, { name: 'Чтение' });

      const updated = await client.put(`/api/habits/${habit.id}`, { name: 'Чтение 20 минут', perWeek: 5 });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ name: 'Чтение 20 минут', cadence: 'daily', perWeek: 1 });

      const archived = await client.put(`/api/habits/${habit.id}`, { archived: true });
      expect(archived.body.archived).toBe(true);

      const fetched = await client.get(`/api/habits/${habit.id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.archived).toBe(true);

      const list = await client.get('/api/habits');
      expect(list.status).toBe(200);
      expect((list.body.habits as HabitDto[]).map((item) => item.id)).toContain(habit.id);

      expect((await client.del(`/api/habits/${habit.id}`)).status).toBe(204);
      expect((await client.get('/api/habits')).body.habits).toHaveLength(0);
    });

    it('отклоняет неверные данные', async () => {
      const client = await signUp('habit-bad@example.com', 'habitbad');
      expect((await client.post('/api/habits', { name: '' })).status).toBe(400);
      expect((await client.post('/api/habits', { name: 'x', cadence: 'monthly' })).status).toBe(400);
      expect((await client.post('/api/habits', { name: 'x', perWeek: 8 })).status).toBe(400);
    });
  });

  describe('Отметки привычек (ТЗ §4)', () => {
    it('отметка идемпотентна: повтор за ту же дату не создаёт дубликат', async () => {
      const client = await signUp('habit-log@example.com', 'habitlog');
      const habit = await createHabit(client, { name: 'Вода', icon: '💧' });

      const first = await client.post(`/api/habits/${habit.id}/log`, { date: dayKey(0) });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ done: true, stats: { streak: 1, totalDone: 1 } });

      const second = await client.post(`/api/habits/${habit.id}/log`, { date: dayKey(0) });
      expect(second.status).toBe(201);
      expect(second.body.log.id).toBe(first.body.log.id);
      expect(second.body.stats.totalDone).toBe(1);
    });

    it('отметка за прошлый день добавляет серию', async () => {
      const client = await signUp('habit-streak@example.com', 'habitstreak');
      const habit = await createHabit(client, { name: 'Чтение' });

      await client.post(`/api/habits/${habit.id}/log`, { date: dayKey(-1) });
      const today = await client.post(`/api/habits/${habit.id}/log`, { date: dayKey(0) });
      expect(today.body.stats).toMatchObject({ streak: 2, totalDone: 2 });
    });

    it('снятие отметки (done=false) возвращает log=null и уменьшает серию', async () => {
      const client = await signUp('habit-unlog@example.com', 'habitunlog');
      const habit = await createHabit(client, { name: 'Прогулка' });
      await client.post(`/api/habits/${habit.id}/log`, { date: dayKey(0) });

      const removed = await client.post(`/api/habits/${habit.id}/log`, { date: dayKey(0), done: false });
      expect(removed.status).toBe(201);
      expect(removed.body.log).toBeNull();
      expect(removed.body.stats).toMatchObject({ streak: 0, totalDone: 0 });
    });

    it('отклоняет будущую дату', async () => {
      const client = await signUp('habit-future@example.com', 'habitfuture');
      const habit = await createHabit(client, { name: 'Вода' });
      const response = await client.post(`/api/habits/${habit.id}/log`, { date: dayKey(3) });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('habit_future_date');
    });
  });

  describe('Привычки за сегодня и статистика (ТЗ §4)', () => {
    it('today показывает активные привычки с отметкой сегодня', async () => {
      const client = await signUp('habit-today@example.com', 'habittoday');
      const water = await createHabit(client, { name: 'Вода', icon: '💧' });
      const sport = await createHabit(client, { name: 'Спорт', icon: '🏃', cadence: 'weekly', perWeek: 3 });
      await client.post(`/api/habits/${water.id}/log`, { date: dayKey(0) });

      const response = await client.get('/api/habits/today');
      expect(response.status).toBe(200);
      expect(response.body.dayKey).toBe(dayKey(0));
      const items = response.body.habits as HabitTodayItem[];
      expect(items).toHaveLength(2);
      expect(items.find((item) => item.id === water.id)).toMatchObject({ done: true, streak: 1 });
      expect(items.find((item) => item.id === sport.id)).toMatchObject({ done: false, cadence: 'weekly' });
    });

    it('today не показывает архивные привычки', async () => {
      const client = await signUp('habit-arch@example.com', 'habitarch');
      const habit = await createHabit(client, { name: 'Вода' });
      await client.put(`/api/habits/${habit.id}`, { archived: true });

      expect((await client.get('/api/habits/today')).body.habits).toHaveLength(0);
    });

    it('stats считает серию и процент за 7 и 30 дней', async () => {
      const client = await signUp('habit-stats@example.com', 'habitstats');
      const habit = await createHabit(client, { name: 'Чтение' });

      // Отмечаем сегодня, вчера и 5 дней назад — серия 2, за 7 дней 3/7, за 30 дней 3/30.
      for (const offset of [0, -1, -5]) {
        const response = await client.post(`/api/habits/${habit.id}/log`, { date: dayKey(offset) });
        expect(response.status).toBe(201);
      }

      const response = await client.get('/api/habits/stats');
      expect(response.status).toBe(200);
      const item = (response.body.habits as Array<HabitDto & HabitStatsLike>).find(
        (entry) => entry.id === habit.id,
      );
      expect(item).toMatchObject({ streak: 2, rate7: 43, rate30: 10, totalDone: 3 });
    });
  });

  describe('Изоляция данных между пользователями (ТЗ §6)', () => {
    it('не отдаёт и не меняет чужие привычки', async () => {
      const alice = await signUp('habit-alice@example.com', 'habitalice');
      const bob = await signUp('habit-bob@example.com', 'habitbob');
      const aliceHabit = await createHabit(alice, { name: 'Привычка Алисы' });

      expect((await bob.get('/api/habits')).body.habits).toHaveLength(0);
      expect((await bob.get(`/api/habits/${aliceHabit.id}`)).status).toBe(404);
      expect((await bob.put(`/api/habits/${aliceHabit.id}`, { name: 'Взлом' })).status).toBe(404);
      expect((await bob.del(`/api/habits/${aliceHabit.id}`)).status).toBe(404);
      expect((await bob.post(`/api/habits/${aliceHabit.id}/log`, { date: dayKey(0) })).status).toBe(404);

      expect((await alice.get(`/api/habits/${aliceHabit.id}`)).body.name).toBe('Привычка Алисы');
    });

    it('без сессии — 401 unauthorized', async () => {
      const anon = new TestClient(server);
      await anon.csrf();
      expect((await anon.get('/api/habits')).status).toBe(401);
      expect((await anon.get('/api/habits/today')).status).toBe(401);
      expect((await anon.post('/api/habits', { name: 'x' })).status).toBe(401);
    });
  });
});
