// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты чистой логики достижений и стриков (ТЗ §2, §4, P1).
// Границы дня и переход на летнее время проверяются через часовой пояс.
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENTS,
  computeStreak,
  evaluateAchievements,
  isBudgetMonthClosedWithinLimit,
  nextStreakMilestone,
  streakFromInstants,
  type AchievementCode,
} from '../src/achievements';

describe('computeStreak (ТЗ §4, стрик чек-инов по дням)', () => {
  it('считает подряд идущие дни до сегодня включительно', () => {
    const result = computeStreak(
      ['2026-09-29', '2026-09-30', '2026-10-01'],
      '2026-10-01',
    );
    expect(result.current).toBe(3);
    expect(result.checkedToday).toBe(true);
    expect(result.lastDayKey).toBe('2026-10-01');
  });

  it('сегодняшний день ещё не засчитан — стрик не сбрасывается', () => {
    const result = computeStreak(['2026-09-28', '2026-09-29', '2026-09-30'], '2026-10-01');
    expect(result.current).toBe(3);
    expect(result.checkedToday).toBe(false);
  });

  it('пропуск дня сбрасывает стрик: считаются только дни до разрыва', () => {
    const result = computeStreak(
      ['2026-09-25', '2026-09-26', '2026-09-28', '2026-09-29', '2026-09-30'],
      '2026-10-01',
    );
    expect(result.current).toBe(3);
  });

  it('разрыв раньше — текущий стрик 0, но самый длинный сохраняется', () => {
    const result = computeStreak(['2026-09-01', '2026-09-02', '2026-09-03'], '2026-10-01');
    expect(result.current).toBe(0);
    expect(result.longest).toBe(3);
  });

  it('единственный чек-ин сегодня — стрик 1', () => {
    expect(computeStreak(['2026-10-01'], '2026-10-01').current).toBe(1);
  });

  it('пустой список — нули и нет последнего дня', () => {
    const result = computeStreak([], '2026-10-01');
    expect(result.current).toBe(0);
    expect(result.longest).toBe(0);
    expect(result.lastDayKey).toBeNull();
  });

  it('дубликаты дней не удваивают стрик', () => {
    const result = computeStreak(
      ['2026-09-30', '2026-09-30', '2026-10-01', '2026-10-01'],
      '2026-10-01',
    );
    expect(result.current).toBe(2);
    expect(result.longest).toBe(2);
  });

  it('пересекает границу месяца и года', () => {
    const result = computeStreak(['2025-12-30', '2025-12-31', '2026-01-01'], '2026-01-01');
    expect(result.current).toBe(3);
  });

  it('текущий стрик не длиннее самого длинного', () => {
    const result = computeStreak(
      ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-30'],
      '2026-10-01',
    );
    expect(result.current).toBe(1);
    expect(result.longest).toBe(4);
  });
});

describe('streakFromInstants (границы дня и переход на летнее время, ТЗ §4)', () => {
  it('относит момент к дню в поясе пользователя (Москва, +03:00)', () => {
    // 22:30 UTC 1 октября — это уже 2 октября в Москве.
    const instants = [
      new Date('2026-09-30T20:00:00.000Z'), // 30 сентября, 23:00 MSK
      new Date('2026-10-01T12:00:00.000Z'), // 1 октября, 15:00 MSK
      new Date('2026-10-01T22:30:00.000Z'), // уже 2 октября, 01:30 MSK
    ];
    const result = streakFromInstants(instants, 'Europe/Moscow', new Date('2026-10-01T23:00:00.000Z'));
    expect(result.current).toBe(3);
    expect(result.todayKey).toBe('2026-10-02');
    expect(result.lastDayKey).toBe('2026-10-02');
  });

  it('день на границе совпадает ровно в полночь по поясу', () => {
    const instants = [
      new Date('2026-10-01T20:59:59.000Z'), // 1 октября, 23:59:59 MSK
      new Date('2026-10-01T21:00:00.000Z'), // ровно 00:00 2 октября MSK
    ];
    const result = streakFromInstants(instants, 'Europe/Moscow', new Date('2026-10-02T21:00:00.000Z'));
    expect(result.todayKey).toBe('2026-10-03');
    expect(result.current).toBe(2);
    expect(result.checkedToday).toBe(false);
  });

  it('переход на летнее время не разрывает стрик (America/New_York, +1 час)', () => {
    // 8 марта 2026 — переход на летнее время в США (02:00 → 03:00 по местному).
    const instants = [
      new Date('2026-03-07T12:00:00.000Z'), // 7 марта, EST
      new Date('2026-03-08T05:30:00.000Z'), // 00:30 8 марта, EST
      new Date('2026-03-08T16:00:00.000Z'), // 12:00 8 марта, уже EDT
      new Date('2026-03-09T04:00:00.000Z'), // 00:00 9 марта, EDT
    ];
    const result = streakFromInstants(instants, 'America/New_York', new Date('2026-03-09T12:00:00.000Z'));
    expect(result.current).toBe(3);
  });

  it('переход обратно на зимнее время не разрывает стрик (Europe/Berlin, -1 час)', () => {
    // 25 октября 2026 — переход на зимнее время в Европе (03:00 → 02:00).
    const instants = [
      new Date('2026-10-24T10:00:00.000Z'),
      new Date('2026-10-25T00:30:00.000Z'), // 02:30 CEST
      new Date('2026-10-25T01:30:00.000Z'), // 02:30 CET (тот же календарный день)
      new Date('2026-10-25T23:00:00.000Z'), // 00:00 26 октября CET
    ];
    const result = streakFromInstants(instants, 'Europe/Berlin', new Date('2026-10-26T12:00:00.000Z'));
    expect(result.current).toBe(3);
    expect(result.checkedToday).toBe(true);
  });
});

describe('evaluateAchievements (ТЗ §4, условия бейджей)', () => {
  const base = {
    checkinsCount: 0,
    transactionsCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    closedBudgetsCount: 0,
  };

  it('пустой контекст — нет достижений', () => {
    expect(evaluateAchievements(base)).toEqual([]);
  });

  it('первый чек-ин и первая транзакция', () => {
    const codes = evaluateAchievements({ ...base, checkinsCount: 1, transactionsCount: 1 });
    expect(codes).toContain('first_checkin');
    expect(codes).toContain('first_transaction');
  });

  it('бейджи за 7/30/100 дней по самому длинному стрику', () => {
    expect(evaluateAchievements({ ...base, checkinsCount: 7, longestStreak: 7 })).toContain(
      'checkin_streak_7',
    );
    expect(
      evaluateAchievements({ ...base, checkinsCount: 7, longestStreak: 7 }),
    ).not.toContain('checkin_streak_30');

    const hundred = evaluateAchievements({ ...base, checkinsCount: 100, longestStreak: 100 });
    expect(hundred).toEqual(
      expect.arrayContaining(['first_checkin', 'checkin_streak_7', 'checkin_streak_30', 'checkin_streak_100']),
    );
  });

  it('текущий стрик тоже учитывается, если он длиннее исторического', () => {
    expect(evaluateAchievements({ ...base, checkinsCount: 7, currentStreak: 7 })).toContain(
      'checkin_streak_7',
    );
  });

  it('бейдж за первый закрытый месяц без превышения бюджета', () => {
    expect(evaluateAchievements({ ...base, closedBudgetsCount: 1 })).toContain('first_budget_closed');
  });

  it('все коды из определения присутствуют в списке', () => {
    const definitions = ACHIEVEMENTS.map((item) => item.code);
    expect(definitions.sort()).toEqual([...ACHIEVEMENT_CODES].sort());
  });
});

describe('nextStreakMilestone (ТЗ §4, прогресс до следующего бейджа)', () => {
  it('до 7 дней — ближайший бейдж 7', () => {
    expect(nextStreakMilestone(3)).toEqual({ code: 'checkin_streak_7', threshold: 7 });
    expect(nextStreakMilestone(0)).toEqual({ code: 'checkin_streak_7', threshold: 7 });
  });

  it('между порогами выбирает следующий', () => {
    expect(nextStreakMilestone(7)).toEqual({ code: 'checkin_streak_30', threshold: 30 });
    expect(nextStreakMilestone(29)).toEqual({ code: 'checkin_streak_30', threshold: 30 });
    expect(nextStreakMilestone(30)).toEqual({ code: 'checkin_streak_100', threshold: 100 });
  });

  it('после 100 дней следующих порогов нет', () => {
    expect(nextStreakMilestone(100)).toBeNull();
    expect(nextStreakMilestone(150)).toBeNull();
  });
});

describe('isBudgetMonthClosedWithinLimit (ТЗ §4, «месяц без превышения»)', () => {
  it('прошедший месяц в пределах лимита — закрыт', () => {
    expect(isBudgetMonthClosedWithinLimit(50_000, 40_000, '2026-08', '2026-10')).toBe(true);
    expect(isBudgetMonthClosedWithinLimit(50_000, 50_000, '2026-08', '2026-10')).toBe(true);
  });

  it('прошедший месяц с превышением — не закрыт', () => {
    expect(isBudgetMonthClosedWithinLimit(50_000, 51_000, '2026-08', '2026-10')).toBe(false);
  });

  it('текущий месяц ещё не закрыт', () => {
    expect(isBudgetMonthClosedWithinLimit(50_000, 10_000, '2026-10', '2026-10')).toBe(false);
  });
});

describe('ACHIEVEMENT_CODES', () => {
  it('содержит ожидаемые коды', () => {
    const expected: AchievementCode[] = [
      'first_checkin',
      'checkin_streak_7',
      'checkin_streak_30',
      'checkin_streak_100',
      'first_transaction',
      'first_budget_closed',
      'first_goal',
      'goal_half',
      'goal_complete',
    ];
    expect([...ACHIEVEMENT_CODES].sort()).toEqual(expected.sort());
  });
});
