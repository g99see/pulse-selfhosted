// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты чек-инов (ТЗ §3.3, §5 сценарий 1) против реального
// PostgreSQL в схеме puls_test. Запуск: pnpm --filter @puls/api test
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { todayKeyInTimezone } from '@puls/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

interface CheckInDto {
  id: string;
  mood: number;
  energy: number | null;
  stress: number | null;
  sleepHours: number | null;
  water: number | null;
  steps: number | null;
  tags: string[];
  note: string | null;
  daySummary: string | null;
  slot: string | null;
  occurredAt: string;
  createdAt: string;
  sleepIgnored?: boolean;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

describe('CheckIn API (интеграция с PostgreSQL)', () => {
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
      'DELETE FROM "check_ins"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "accounts"',
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

  async function createCheckIn(
    client: TestClient,
    body: Record<string, unknown>,
  ): Promise<CheckInDto> {
    const response = await client.post('/api/checkins', body);
    expect(response.status).toBe(201);
    return response.body as CheckInDto;
  }

  /** Часовой пояс Etc/GMT±X, в котором сейчас локальный час подходит под условие. */
  function zoneWhere(predicate: (localHour: number) => boolean): string {
    const utcHour = new Date().getUTCHours();
    const offsets = [
      0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8, 9, -9, 10, -10, 11, -11, 12,
    ];
    for (const offset of offsets) {
      if (!predicate((utcHour + offset + 24) % 24)) continue;
      if (offset === 0) return 'Etc/GMT';
      return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
    }
    throw new Error('не нашёл часовой пояс под условие');
  }

  async function setTimezone(email: string, timezone: string): Promise<void> {
    await prisma.user.update({ where: { email }, data: { timezone } });
  }

  describe('Быстрый ответ настроением (ТЗ §3.3, §5 сценарий 1)', () => {
    it('принимает настроение одним ответом и ставит время сейчас', async () => {
      const client = await signUp('mood@example.com', 'mooduser');
      const dto = await createCheckIn(client, { mood: 4 });

      expect(dto.mood).toBe(4);
      expect(dto.energy).toBeNull();
      expect(Number.isNaN(Date.parse(dto.occurredAt))).toBe(false);
    });

    it('POST /quick сохраняет только настроение за 5 секунд', async () => {
      const client = await signUp('quick@example.com', 'quickcheck');
      const response = await client.post('/api/checkins/quick', { mood: 2, slot: 'day' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ mood: 2, slot: 'day', water: null, steps: null });
    });

    it('отклоняет настроение вне 1–5', async () => {
      const client = await signUp('bad-mood@example.com', 'badmood');
      const response = await client.post('/api/checkins', { mood: 6 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('validation_error');
    });
  });

  describe('Расширенный чек-ин (ТЗ §3.3)', () => {
    it('сохраняет энергию, стресс, сон, воду, шаги, теги и заметку', async () => {
      const client = await signUp('extended@example.com', 'extendeduser');
      // Сон принимается только утром — ставим пояс, где сейчас 04:00–12:00.
      await setTimezone(
        'extended@example.com',
        zoneWhere((hour) => hour >= 4 && hour < 12),
      );
      const dto = await createCheckIn(client, {
        mood: 3,
        energy: 2,
        stress: 4,
        sleepHours: 6.5,
        water: 5,
        steps: 9000,
        tags: ['работа', 'спорт'],
        note: 'Тяжёлый, но продуктивный день',
      });

      expect(dto).toMatchObject({
        mood: 3,
        energy: 2,
        stress: 4,
        sleepHours: 6.5,
        water: 5,
        steps: 9000,
        tags: ['работа', 'спорт'],
        note: 'Тяжёлый, но продуктивный день',
      });
    });

    it('сохраняет вечерний итог дня одной строкой', async () => {
      const client = await signUp('evening@example.com', 'eveninguser');
      const dto = await createCheckIn(client, {
        mood: 5,
        slot: 'evening',
        daySummary: 'Успел на тренировку и закончил отчёт',
      });

      expect(dto.daySummary).toBe('Успел на тренировку и закончил отчёт');
      expect(dto.slot).toBe('evening');
    });
  });

  describe('Заполнение задним числом (ТЗ §3.3)', () => {
    it('принимает чек-ин в пределах 24 часов', async () => {
      const client = await signUp('backfill@example.com', 'backfill');
      const dto = await createCheckIn(client, { mood: 3, occurredAt: hoursAgo(3) });

      expect(dto.mood).toBe(3);
      expect(Date.parse(dto.occurredAt)).toBeLessThan(Date.now() - 60 * 60 * 1000);
    });

    it('отклоняет чек-ин старше 24 часов с кодом', async () => {
      const client = await signUp('old@example.com', 'olduser');
      const response = await client.post('/api/checkins', { mood: 3, occurredAt: hoursAgo(25) });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('checkin_window_expired');
    });

    it('отклоняет время в будущем', async () => {
      const client = await signUp('future@example.com', 'futureuser');
      const response = await client.post('/api/checkins', {
        mood: 3,
        occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('validation_error');
    });
  });

  describe('Список и получение за период (ТЗ §3.3)', () => {
    it('фильтрует чек-ины по периоду и отдаёт один по id', async () => {
      const client = await signUp('list@example.com', 'listuser');
      const first = await createCheckIn(client, { mood: 2, occurredAt: hoursAgo(20) });
      await createCheckIn(client, { mood: 5, occurredAt: hoursAgo(1) });

      const all = await client.get('/api/checkins');
      expect(all.status).toBe(200);
      expect(all.body.checkIns).toHaveLength(2);

      const period = await client.get(`/api/checkins?from=${encodeURIComponent(hoursAgo(5))}`);
      expect(period.body.checkIns).toHaveLength(1);
      expect(period.body.checkIns[0].mood).toBe(5);

      const one = await client.get(`/api/checkins/${first.id}`);
      expect(one.status).toBe(200);
      expect(one.body.mood).toBe(2);
    });

    it('GET /today отдаёт чек-ины текущего дня', async () => {
      const client = await signUp('today@example.com', 'todayuser');
      const created = await createCheckIn(client, { mood: 4 });

      const today = await client.get('/api/checkins/today');
      expect(today.status).toBe(200);
      expect(today.body.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(today.body.checkIns.map((item: CheckInDto) => item.id)).toContain(created.id);
    });

    it('GET /today согласован со /stats/day по границам дня (единая реализация)', async () => {
      const client = await signUp('todaytz@example.com', 'todaytzuser');
      // Зона со сменой DST — граница дня должна совпадать у обоих эндпоинтов.
      const timezone = 'Pacific/Auckland';
      await setTimezone('todaytz@example.com', timezone);
      const created = await createCheckIn(client, { mood: 4 });

      const today = await client.get('/api/checkins/today');
      expect(today.status).toBe(200);
      expect(today.body.dayKey).toBe(todayKeyInTimezone(timezone, new Date()));
      expect(today.body.checkIns.map((item: CheckInDto) => item.id)).toContain(created.id);

      const stats = await client.get(`/api/stats/day?date=${today.body.dayKey}`);
      expect(stats.status).toBe(200);
      expect(stats.body.day).toBe(today.body.dayKey);
      expect(stats.body.checkins).toBeGreaterThanOrEqual(1);
    });

    it('чужой или несуществующий чек-ин → 404', async () => {
      const alice = await signUp('alice@example.com', 'alicecheck');
      const bob = await signUp('bob@example.com', 'bobcheck');
      const aliceCheckIn = await createCheckIn(alice, { mood: 3 });

      const foreign = await bob.get(`/api/checkins/${aliceCheckIn.id}`);
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('checkin_not_found');

      const missing = await bob.get('/api/checkins/does-not-exist');
      expect(missing.status).toBe(404);
    });
  });

  describe('Правка и удаление (ТЗ §3.3)', () => {
    it('дописывает итог дня в свой чек-ин', async () => {
      const client = await signUp('edit@example.com', 'editcheck');
      const created = await createCheckIn(client, { mood: 3 });

      const updated = await client.put(`/api/checkins/${created.id}`, {
        daySummary: 'Позвонил родителям',
      });
      expect(updated.status).toBe(200);
      expect(updated.body.daySummary).toBe('Позвонил родителям');
      expect(updated.body.mood).toBe(3);
    });

    it('не даёт править или удалять чужой чек-ин', async () => {
      const alice = await signUp('alice2@example.com', 'alice2check');
      const bob = await signUp('bob2@example.com', 'bob2check');
      const aliceCheckIn = await createCheckIn(alice, { mood: 3 });

      expect((await bob.put(`/api/checkins/${aliceCheckIn.id}`, { mood: 1 })).status).toBe(404);
      expect((await bob.del(`/api/checkins/${aliceCheckIn.id}`)).status).toBe(404);
      expect((await alice.get(`/api/checkins/${aliceCheckIn.id}`)).body.mood).toBe(3);
    });

    it('удаляет свой чек-ин', async () => {
      const client = await signUp('delete@example.com', 'deletecheck');
      const created = await createCheckIn(client, { mood: 1 });

      expect((await client.del(`/api/checkins/${created.id}`)).status).toBe(204);
      expect((await client.get('/api/checkins')).body.checkIns).toHaveLength(0);
    });
  });

  describe('Расписание напоминаний (ТЗ §3.3)', () => {
    it('по умолчанию — 3 раза в день (утро, день, вечер)', async () => {
      const client = await signUp('schedule@example.com', 'scheduleuser');
      const response = await client.get('/api/checkins/schedule');

      expect(response.status).toBe(200);
      expect(response.body.schedule.timesPerDay).toBe(3);
      expect(response.body.schedule.times).toHaveLength(3);
    });

    it('настраивается от 1 до 6 раз в день', async () => {
      const client = await signUp('schedule2@example.com', 'schedule2');
      const updated = await client.put('/api/checkins/schedule', {
        timesPerDay: 5,
        times: ['07:00', '10:00', '13:00', '18:00', '22:00'],
      });

      expect(updated.status).toBe(200);
      expect(updated.body.schedule.timesPerDay).toBe(5);
      expect((await client.get('/api/checkins/schedule')).body.schedule.times).toHaveLength(5);
    });

    it('отклоняет 0, 7 и несовпадение числа времён', async () => {
      const client = await signUp('schedule3@example.com', 'schedule3');

      for (const bad of [
        { timesPerDay: 0, times: [] },
        { timesPerDay: 7, times: ['07:00'] },
        { timesPerDay: 3, times: ['09:00'] },
      ]) {
        const response = await client.put('/api/checkins/schedule', bad);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe('validation_error');
      }
    });
  });

  describe('Сон — только утром (локальное 04:00–12:00, ТЗ §3.3)', () => {
    const isMorningHour = (hour: number) => hour >= 4 && hour < 12;

    it('утром поле сна сохраняется', async () => {
      const client = await signUp('sleep-am@example.com', 'sleepam');
      await setTimezone('sleep-am@example.com', zoneWhere(isMorningHour));
      const dto = await createCheckIn(client, { mood: 3, sleepHours: 7.5 });
      expect(dto.sleepHours).toBe(7.5);
      expect(dto.sleepIgnored).toBeUndefined();
    });

    it('днём/вечером поле сна тихо игнорируется, без ошибки, но с флагом sleepIgnored', async () => {
      const client = await signUp('sleep-pm@example.com', 'sleeppm');
      await setTimezone(
        'sleep-pm@example.com',
        zoneWhere((hour) => !isMorningHour(hour)),
      );
      const dto = await createCheckIn(client, { mood: 3, sleepHours: 7.5 });
      expect(dto.sleepHours).toBeNull();
      expect(dto.mood).toBe(3);
      // Клиент должен узнать, что сон отброшен (а не потерять данные молча, ТЗ §3.3).
      expect(dto.sleepIgnored).toBe(true);
    });

    it('без сна вне окна флаг не выставляется', async () => {
      const client = await signUp('sleep-none@example.com', 'sleepnone');
      await setTimezone(
        'sleep-none@example.com',
        zoneWhere((hour) => !isMorningHour(hour)),
      );
      const dto = await createCheckIn(client, { mood: 3 });
      expect(dto.sleepIgnored).toBeUndefined();
    });
  });

  describe('Изоляция данных (ТЗ §6)', () => {
    it('каждый пользователь видит только свои чек-ины', async () => {
      const alice = await signUp('alice3@example.com', 'alice3check');
      const bob = await signUp('bob3@example.com', 'bob3check');

      await createCheckIn(alice, { mood: 5 });
      await createCheckIn(bob, { mood: 1 });

      expect((await alice.get('/api/checkins')).body.checkIns).toHaveLength(1);
      expect((await alice.get('/api/checkins')).body.checkIns[0].mood).toBe(5);
      expect((await bob.get('/api/checkins')).body.checkIns).toHaveLength(1);
      expect((await bob.get('/api/checkins')).body.checkIns[0].mood).toBe(1);
    });

    it('без сессии — 401 unauthorized', async () => {
      const anon = new TestClient(server);
      await anon.csrf();
      expect((await anon.get('/api/checkins')).status).toBe(401);
      expect((await anon.post('/api/checkins', { mood: 3 })).status).toBe(401);
    });
  });
});
