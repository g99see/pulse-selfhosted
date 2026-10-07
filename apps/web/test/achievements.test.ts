// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { achievementByCode, type AchievementStatusDto, type StreakDto } from '@puls/shared';
import {
  ACHIEVEMENT_GROUP_ORDER,
  defaultAchievementStatus,
  descriptionThreshold,
  groupAchievements,
  levelLabelKey,
  recentlyEarnedCodes,
  streakProgress,
} from '../src/lib/achievements';

function status(overrides: Partial<AchievementStatusDto> & { code: string }): AchievementStatusDto {
  return {
    group: 'checkin',
    icon: '⭐',
    rarity: 'common',
    hidden: false,
    earned: false,
    earnedAt: null,
    level: null,
    value: 0,
    nextThreshold: null,
    progress: 0,
    tiers: [],
    ...overrides,
  };
}

describe('ACHIEVEMENT_GROUP_ORDER (ТЗ v2 §4)', () => {
  it('держит порядок групп: чек-ины, финансы, активность, особые', () => {
    expect(ACHIEVEMENT_GROUP_ORDER).toEqual(['checkin', 'finance', 'activity', 'special']);
  });
});

describe('groupAchievements (ТЗ v2 §4)', () => {
  it('группирует в порядке каталога и добивает отсутствующие полными статусами', () => {
    const groups = groupAchievements([status({ code: 'checkin_streak', earned: true, value: 7 })]);

    expect(groups.map((view) => view.group)).toEqual(ACHIEVEMENT_GROUP_ORDER);

    const checkin = groups.find((view) => view.group === 'checkin');
    const earned = checkin?.items.find((item) => item.code === 'checkin_streak');
    expect(earned?.earned).toBe(true);
    expect(earned?.value).toBe(7);

    // Отсутствующий в ответе API статус синтезируется целиком из каталога.
    const synthesized = checkin?.items.find((item) => item.code === 'checkin_total');
    expect(synthesized).toBeDefined();
    expect(synthesized?.group).toBe('checkin');
    expect(synthesized?.icon).toBe('🌱');
    expect(synthesized?.earned).toBe(false);
    expect(synthesized?.nextThreshold).toBe(1);
    expect(synthesized?.tiers).toHaveLength(3);
    expect(synthesized?.tiers.every((tier) => tier.earnedAt === null)).toBe(true);
  });

  it('в каждой группе возвращает полные DTO, а не только code/earned', () => {
    const groups = groupAchievements([]);
    for (const view of groups) {
      expect(view.items.length).toBeGreaterThan(0);
      for (const item of view.items) {
        expect(item.group).toBe(view.group);
        expect(typeof item.icon).toBe('string');
        expect(item.icon.length).toBeGreaterThan(0);
        expect(Array.isArray(item.tiers)).toBe(true);
      }
    }
  });
});

describe('defaultAchievementStatus (ТЗ v2 §4)', () => {
  it('строит полный статус из записи каталога', () => {
    const definition = achievementByCode('checkin_streak');
    expect(definition).toBeDefined();

    const item = defaultAchievementStatus(definition!);
    expect(item.code).toBe('checkin_streak');
    expect(item.group).toBe('checkin');
    expect(item.icon).toBe('🔥');
    expect(item.rarity).toBe('rare');
    expect(item.hidden).toBe(false);
    expect(item.earned).toBe(false);
    expect(item.earnedAt).toBeNull();
    expect(item.level).toBeNull();
    expect(item.value).toBe(0);
    expect(item.nextThreshold).toBe(7);
    expect(item.progress).toBe(0);
    expect(item.tiers[0]).toEqual({ level: 'bronze', threshold: 7, earnedAt: null });
    expect(item.tiers).toHaveLength(3);
  });
});

describe('descriptionThreshold (подстановка {n})', () => {
  it('берёт следующий непройденный порог', () => {
    const item = status({
      code: 'x',
      nextThreshold: 30,
      tiers: [
        { level: 'bronze', threshold: 1, earnedAt: '2026-01-01T00:00:00.000Z' },
        { level: 'silver', threshold: 30, earnedAt: null },
        { level: 'gold', threshold: 100, earnedAt: null },
      ],
    });
    expect(descriptionThreshold(item)).toBe(30);
  });

  it('когда всё получено — берёт порог высшего уровня', () => {
    const item = status({
      code: 'y',
      earned: true,
      nextThreshold: null,
      level: 'gold',
      tiers: [{ level: 'gold', threshold: 100, earnedAt: '2026-01-01T00:00:00.000Z' }],
    });
    expect(descriptionThreshold(item)).toBe(100);
  });
});

describe('levelLabelKey (ТЗ v2 §4)', () => {
  it('строит i18n-ключ подписи уровня', () => {
    expect(levelLabelKey('bronze')).toBe('achievements.level.bronze');
    expect(levelLabelKey('gold')).toBe('achievements.level.gold');
  });
});

describe('streakProgress (ТЗ §4)', () => {
  const base: StreakDto = {
    current: 0,
    longest: 0,
    checkedToday: false,
    todayKey: '2026-10-01',
    lastDayKey: null,
    nextMilestone: { code: 'checkin_streak', threshold: 7 },
  };

  it('считает долю до следующего порога', () => {
    expect(streakProgress({ ...base, current: 3, longest: 3 })).toBeCloseTo(3 / 7);
  });

  it('после 100 дней прогресс равен 1 (порогов больше нет)', () => {
    expect(streakProgress({ ...base, current: 100, longest: 100, nextMilestone: null })).toBe(1);
  });
});

describe('recentlyEarnedCodes (анимация конфетти)', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z');

  it('возвращает достижения, полученные в пределах окна', () => {
    const codes = recentlyEarnedCodes(
      [
        status({
          code: 'checkin_total',
          earned: true,
          earnedAt: '2026-10-01T11:59:56.000Z',
        }),
        status({
          code: 'transactions_total',
          earned: true,
          earnedAt: '2026-10-01T09:00:00.000Z',
        }),
      ],
      now,
    );
    expect(codes).toEqual(['checkin_total']);
  });

  it('не возвращает неполученные достижения', () => {
    expect(
      recentlyEarnedCodes([status({ code: 'goals_created', earned: false, earnedAt: null })], now),
    ).toEqual([]);
  });
});
