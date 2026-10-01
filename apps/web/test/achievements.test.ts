// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { AchievementStatusDto, StreakDto } from '@puls/shared';
import { groupAchievements, recentlyEarnedCodes, streakProgress } from '../src/lib/achievements';

function status(
  partial: Partial<AchievementStatusDto> & { code: AchievementStatusDto['code'] },
): AchievementStatusDto {
  return { earned: false, earnedAt: null, progress: 0, ...partial };
}

describe('groupAchievements (ТЗ §4)', () => {
  it('группирует бейджи в порядке каталога и добивает отсутствующие', () => {
    const groups = groupAchievements([
      status({ code: 'checkin_streak_7', earned: true, progress: 1 }),
    ]);
    expect(groups.map((view) => view.group)).toEqual(['checkins', 'finance', 'goals']);
    const checkins = groups.find((view) => view.group === 'checkins');
    expect(checkins?.items[1]?.code).toBe('checkin_streak_7');
    expect(checkins?.items[1]?.earned).toBe(true);
    const finance = groups.find((view) => view.group === 'finance');
    expect(finance?.items.every((item) => !item.earned)).toBe(true);
  });
});

describe('streakProgress (ТЗ §4)', () => {
  const base: StreakDto = {
    current: 0,
    longest: 0,
    checkedToday: false,
    todayKey: '2026-10-01',
    lastDayKey: null,
    nextMilestone: { code: 'checkin_streak_7', threshold: 7 },
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

  it('возвращает бейджи, полученные в пределах окна', () => {
    const codes = recentlyEarnedCodes(
      [
        status({ code: 'first_checkin', earned: true, earnedAt: '2026-10-01T11:59:56.000Z' }),
        status({ code: 'first_transaction', earned: true, earnedAt: '2026-10-01T09:00:00.000Z' }),
      ],
      now,
    );
    expect(codes).toEqual(['first_checkin']);
  });

  it('не возвращает неподученные бейджи', () => {
    expect(
      recentlyEarnedCodes([status({ code: 'first_goal', earned: false, earnedAt: null })], now),
    ).toEqual([]);
  });
});
