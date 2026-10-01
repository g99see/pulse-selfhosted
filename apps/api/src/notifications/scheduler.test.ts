// SPDX-License-Identifier: AGPL-3.0-or-later
// Планировщик на чистой логике: БД и транспорт подменены, Valkey не нужен
// (ТЗ §3.6, §9). Интеграция с Valkey/BullMQ здесь сознательно не проверяется.
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationDispatcher, DeliveryContext } from './dispatcher';
import type { DueDelivery } from './due';
import { NotificationsScheduler } from './scheduler';

interface FakeUser {
  id: string;
  email: string;
  timezone: string;
  notificationsEnabled: boolean;
  notificationRules: {
    type: string;
    channel: string;
    schedule: unknown;
    quietHoursStart: number;
    quietHoursEnd: number;
    enabled: boolean;
  }[];
}

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: 'u1',
    email: 'u1@example.com',
    timezone: 'UTC',
    notificationsEnabled: true,
    notificationRules: [
      {
        type: 'checkins',
        channel: 'web_push',
        schedule: { times: ['09:00', '15:00', '21:00'] },
        quietHoursStart: 22,
        quietHoursEnd: 8,
        enabled: true,
      },
    ],
    ...overrides,
  };
}

function makeScheduler(users: FakeUser[]) {
  const dispatched: { delivery: DueDelivery; context: DeliveryContext }[] = [];
  const findManyArgs: unknown[] = [];

  const prisma = {
    user: {
      findMany: async (args: unknown) => {
        findManyArgs.push(args);
        return users.filter((user) => user.notificationsEnabled);
      },
    },
  } as unknown as PrismaService;

  const dispatcher = {
    dispatch: async (delivery: DueDelivery, context: DeliveryContext) => {
      dispatched.push({ delivery, context });
      return true;
    },
  } as unknown as NotificationDispatcher;

  return { scheduler: new NotificationsScheduler(prisma, dispatcher), dispatched, findManyArgs };
}

describe('NotificationsScheduler.runOnce', () => {
  it('отправляет уведомление, чей слот попал в окно', async () => {
    const { scheduler, dispatched } = makeScheduler([makeUser()]);

    const due = await scheduler.runOnce(
      new Date('2026-10-01T09:10:00Z'),
      new Date('2026-10-01T08:00:00Z'),
    );

    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ type: 'checkins', channel: 'web_push' });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].context.email).toBe('u1@example.com');
  });

  it('ничего не отправляет вне окна', async () => {
    const { scheduler, dispatched } = makeScheduler([makeUser()]);

    const due = await scheduler.runOnce(
      new Date('2026-10-01T14:00:00Z'),
      new Date('2026-10-01T09:10:00Z'),
    );

    expect(due).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });

  it('берёт только пользователей с включёнными уведомлениями', async () => {
    const { scheduler, findManyArgs } = makeScheduler([makeUser()]);
    await scheduler.runOnce(new Date('2026-10-01T09:10:00Z'), new Date('2026-10-01T08:00:00Z'));
    expect(findManyArgs[0]).toMatchObject({ where: { notificationsEnabled: true } });
  });

  it('во втором тике продолжает окно с прошлого запуска', async () => {
    const { scheduler, dispatched } = makeScheduler([makeUser()]);

    await scheduler.runOnce(
      new Date('2026-10-01T09:10:00Z'),
      new Date('2026-10-01T08:00:00Z'),
    );
    expect(dispatched).toHaveLength(1);

    // Второй вызов без from: окно (09:10, 15:05] — слот 15:00 попадает.
    const due = await scheduler.runOnce(new Date('2026-10-01T15:05:00Z'));
    expect(due).toHaveLength(1);
    expect(dispatched).toHaveLength(2);
  });

  it('учитывает часовой пояс пользователя', async () => {
    const user = makeUser({
      timezone: 'Europe/Moscow',
      notificationRules: [
        {
          type: 'checkins',
          channel: 'web_push',
          schedule: { times: ['09:00'] },
          quietHoursStart: 22,
          quietHoursEnd: 8,
          enabled: true,
        },
      ],
    });
    const { scheduler, dispatched } = makeScheduler([user]);

    // 06:05 UTC = 09:05 MSK — утренний слот уже наступил.
    await scheduler.runOnce(
      new Date('2026-10-01T06:05:00Z'),
      new Date('2026-10-01T05:00:00Z'),
    );
    expect(dispatched).toHaveLength(1);
  });
});
