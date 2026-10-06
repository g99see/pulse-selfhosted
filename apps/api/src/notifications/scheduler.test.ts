// SPDX-License-Identifier: AGPL-3.0-or-later
// Планировщик на чистой логике: БД и транспорт подменены, Valkey не нужен
// (ТЗ §3.6, §9). Интеграция с Valkey/BullMQ здесь сознательно не проверяется.
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import type { DeliveryContext, NotificationDispatcher } from './dispatcher';
import type { DueDelivery } from './due';
import type { OutboxService } from './outbox.service';
import { NotificationsScheduler } from './scheduler';

interface FakeUser {
  id: string;
  timezone: string;
  notificationsEnabled: boolean;
  notificationRules: { type: string; channel: string; enabled: boolean }[];
  notificationChannelSettings: {
    channel: string;
    enabled: boolean;
    schedule: unknown;
    quietStart: number;
    quietEnd: number;
    timezone: string | null;
  }[];
  telegramLink: { blockedAt: Date | null } | null;
  discordLink: { blockedAt: Date | null } | null;
}

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: 'u1',
    timezone: 'UTC',
    notificationsEnabled: true,
    notificationRules: [],
    notificationChannelSettings: [
      {
        channel: 'telegram',
        enabled: true,
        schedule: { times: ['09:00', '15:00', '21:00'], summaryTime: '23:00' },
        quietStart: 22,
        quietEnd: 8,
        timezone: null,
      },
    ],
    telegramLink: { blockedAt: null },
    discordLink: null,
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

  const outbox = { processQueue: async () => undefined } as unknown as OutboxService;

  return {
    scheduler: new NotificationsScheduler(prisma, dispatcher, outbox),
    dispatched,
    findManyArgs,
  };
}

describe('NotificationsScheduler.runOnce', () => {
  it('ставит уведомление, чей слот попал в окно', async () => {
    const { scheduler, dispatched } = makeScheduler([makeUser()]);
    const due = await scheduler.runOnce(
      new Date('2026-10-01T09:10:00Z'),
      new Date('2026-10-01T08:00:00Z'),
    );
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ type: 'checkins', channel: 'telegram' });
    expect(dispatched).toHaveLength(1);
  });

  it('ничего не ставит вне окна', async () => {
    const { scheduler, dispatched } = makeScheduler([makeUser()]);
    const due = await scheduler.runOnce(
      new Date('2026-10-01T14:00:00Z'),
      new Date('2026-10-01T09:10:00Z'),
    );
    expect(due).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });

  it('пропускает заблокированную привязку', async () => {
    const { scheduler, dispatched } = makeScheduler([
      makeUser({ telegramLink: { blockedAt: new Date() } }),
    ]);
    await scheduler.runOnce(new Date('2026-10-01T09:10:00Z'), new Date('2026-10-01T08:00:00Z'));
    expect(dispatched).toHaveLength(0);
  });

  it('пропускает канал без привязки', async () => {
    const { scheduler, dispatched } = makeScheduler([makeUser({ telegramLink: null })]);
    await scheduler.runOnce(new Date('2026-10-01T09:10:00Z'), new Date('2026-10-01T08:00:00Z'));
    expect(dispatched).toHaveLength(0);
  });

  it('берёт только пользователей с включёнными уведомлениями', async () => {
    const { scheduler, findManyArgs } = makeScheduler([makeUser()]);
    await scheduler.runOnce(new Date('2026-10-01T09:10:00Z'), new Date('2026-10-01T08:00:00Z'));
    expect(findManyArgs[0]).toMatchObject({ where: { notificationsEnabled: true } });
  });

  it('во втором тике продолжает окно с прошлого запуска', async () => {
    const { scheduler, dispatched } = makeScheduler([makeUser()]);
    await scheduler.runOnce(new Date('2026-10-01T09:10:00Z'), new Date('2026-10-01T08:00:00Z'));
    expect(dispatched).toHaveLength(1);
    const due = await scheduler.runOnce(new Date('2026-10-01T15:05:00Z'));
    expect(due).toHaveLength(1);
    expect(dispatched).toHaveLength(2);
  });

  it('учитывает часовой пояс пользователя и передаёт его в контекст', async () => {
    const user = makeUser({ timezone: 'Europe/Moscow' });
    user.notificationChannelSettings[0]!.schedule = { times: ['09:00'], summaryTime: '23:00' };
    const { scheduler, dispatched } = makeScheduler([user]);
    // 06:05 UTC = 09:05 MSK — утренний слот уже наступил.
    await scheduler.runOnce(new Date('2026-10-01T06:05:00Z'), new Date('2026-10-01T05:00:00Z'));
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.context.timezone).toBe('Europe/Moscow');
  });
});
