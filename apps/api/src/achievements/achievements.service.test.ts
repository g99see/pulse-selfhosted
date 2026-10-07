// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты сервиса достижений (ТЗ v2 §4) с фейковым Prisma: идемпотентная
// выдача, маскировка скрытых, выдача по метрике, устойчивость к сбоям и backfill.
// Интеграция с реальным PostgreSQL — в test/achievements.integration.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENT_CATALOG } from '@puls/shared';
import { AchievementsService, catalogHash } from './achievements.service';
import type { PrismaService } from '../prisma/prisma.service';

const USER_ID = 'user-1';
const NOW = new Date('2026-10-05T12:00:00.000Z');
const HIDDEN_CODE = 'midnight_checkin';

interface StoredRow {
  userId: string;
  code: string;
  level: string;
}

interface FakeOptions {
  checkinRows?: unknown[];
  userAchievements?: StoredRow[];
  failCheckins?: boolean;
  catalogHashStored?: string | null;
}

/** Минимальный фейк PrismaService для юнит-тестов сервиса. */
function makePrisma(options: FakeOptions = {}) {
  const store = new Map<string, StoredRow>();
  for (const row of options.userAchievements ?? []) {
    store.set(`${row.userId}|${row.code}|${row.level}`, row);
  }

  const prisma = {
    achievement: { upsert: vi.fn(async () => ({})) },
    instanceSettings: {
      findUnique: vi.fn(async () => ({
        achievementsCatalogHash: options.catalogHashStored ?? null,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    userAchievement: {
      createMany: vi.fn(async (args: { data: StoredRow[] }) => {
        let count = 0;
        for (const row of args.data) {
          const key = `${row.userId}|${row.code}|${row.level}`;
          if (!store.has(key)) {
            store.set(key, row);
            count += 1;
          }
        }
        return { count };
      }),
      findMany: vi.fn(async (args: { where: { userId: string } }) =>
        [...store.values()]
          .filter((row) => row.userId === args.where.userId)
          .map((row) => ({ code: row.code, level: row.level, earnedAt: NOW })),
      ),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        timezone: 'UTC',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        checkinWeeklyGoal: null,
      })),
      findUnique: vi.fn(async () => ({ timezone: 'UTC' })),
      findMany: vi.fn(async () => [] as Array<{ id: string }>),
    },
    checkIn: {
      findMany: vi.fn(async () => {
        if (options.failCheckins) throw new Error('db down');
        return options.checkinRows ?? [];
      }),
    },
    transaction: { findMany: vi.fn(async () => []) },
    account: { findMany: vi.fn(async () => []) },
    budget: { findMany: vi.fn(async () => []) },
    accountBankBalance: { findMany: vi.fn(async () => []) },
    goal: { findMany: vi.fn(async () => []) },
    goalDeposit: { findMany: vi.fn(async () => []) },
    habit: { count: vi.fn(async () => 0) },
    habitLog: { findMany: vi.fn(async () => []) },
  };

  return { prisma: prisma as unknown as PrismaService, store, raw: prisma };
}

describe('AchievementsService.grant (ТЗ §4)', () => {
  it('выдаёт уровень один раз и отклоняет повтор', async () => {
    const { prisma } = makePrisma();
    const service = new AchievementsService(prisma);

    expect(await service.grant(USER_ID, 'checkin_total', 'bronze')).toBe(true);
    expect(await service.grant(USER_ID, 'checkin_total', 'bronze')).toBe(false);
  });

  it('разные уровни — разные строки выдачи', async () => {
    const { prisma } = makePrisma();
    const service = new AchievementsService(prisma);

    expect(await service.grant(USER_ID, 'checkin_streak', 'bronze')).toBe(true);
    expect(await service.grant(USER_ID, 'checkin_streak', 'silver')).toBe(true);
    expect(await service.grant(USER_ID, 'checkin_streak', 'silver')).toBe(false);
  });

  it('неизвестный код не пишется в базу', async () => {
    const { prisma, raw } = makePrisma();
    const service = new AchievementsService(prisma);

    expect(await service.grant(USER_ID, 'no_such_achievement', 'bronze')).toBe(false);
    expect(raw.userAchievement.createMany).not.toHaveBeenCalled();
  });
});

describe('AchievementsService.evaluate (ТЗ §4)', () => {
  it('выдаёт бронзу checkin_total, когда метрика достигла порога', async () => {
    const { prisma } = makePrisma({ checkinRows: [{ mood: 3, occurredAt: NOW }] });
    const service = new AchievementsService(prisma);

    const awarded = await service.evaluate(USER_ID, ['checkin_count'], { silent: true });
    expect(awarded).toContainEqual({ code: 'checkin_total', level: 'bronze' });
  });

  it('повторный пересчёт не выдаёт тот же уровень снова', async () => {
    const { prisma } = makePrisma({ checkinRows: [{ mood: 3, occurredAt: NOW }] });
    const service = new AchievementsService(prisma);

    await service.evaluate(USER_ID, ['checkin_count'], { silent: true });
    expect(await service.evaluate(USER_ID, ['checkin_count'], { silent: true })).toEqual([]);
  });

  it('onEvent глотает сбой вычисления и возвращает пусто', async () => {
    const { prisma } = makePrisma({ failCheckins: true });
    const service = new AchievementsService(prisma);

    await expect(service.onEvent(USER_ID, 'checkin')).resolves.toEqual([]);
  });
});

describe('AchievementsService.list (ТЗ §4)', () => {
  it('отдаёт весь каталог и маскирует скрытое достижение, пока не получено', async () => {
    const { prisma } = makePrisma();
    const service = new AchievementsService(prisma);

    const { achievements } = await service.list(USER_ID);
    expect(achievements.length).toBe(ACHIEVEMENT_CATALOG.length);

    const hidden = achievements.find((item) => item.code === HIDDEN_CODE);
    expect(hidden?.hidden).toBe(true);
    expect(hidden?.earned).toBe(false);
    expect(hidden?.value).toBe(0);
    expect(hidden?.nextThreshold).toBeNull();
    expect(hidden?.progress).toBe(0);
    for (const tier of hidden?.tiers ?? []) expect(tier.threshold).toBe(0);
  });

  it('полученный уровень виден в списке и в уровнях', async () => {
    const { prisma } = makePrisma();
    const service = new AchievementsService(prisma);
    await service.grant(USER_ID, 'checkin_total', 'gold');

    const { achievements } = await service.list(USER_ID);
    const badge = achievements.find((item) => item.code === 'checkin_total');
    expect(badge?.earned).toBe(true);
    expect(badge?.level).toBe('gold');
    expect(badge?.tiers.find((tier) => tier.level === 'gold')?.earnedAt).not.toBeNull();
  });
});

describe('AchievementsService: каталог и backfill (ТЗ §4)', () => {
  it('отпечаток каталога стабилен', () => {
    const hash = catalogHash();
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(catalogHash()).toBe(hash);
  });

  it('backfillIfNeeded пропускает пересчёт, когда отпечаток совпадает', async () => {
    const { prisma, raw } = makePrisma({ catalogHashStored: catalogHash() });
    const service = new AchievementsService(prisma);

    expect(await service.backfillIfNeeded()).toBeNull();
    expect(raw.user.findMany).not.toHaveBeenCalled();
  });

  it('backfillIfNeeded пересчитывает и запоминает отпечаток, когда он новый', async () => {
    const { prisma, raw } = makePrisma({ catalogHashStored: null });
    const service = new AchievementsService(prisma);

    const result = await service.backfillIfNeeded();
    expect(result).toEqual({ users: 0, awarded: 0 });
    expect(raw.user.findMany).toHaveBeenCalled();
    expect(raw.instanceSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { achievementsCatalogHash: catalogHash() } }),
    );
  });
});
