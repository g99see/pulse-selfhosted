// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  addDays,
  budgetRemaining,
  buildMoodCalendar,
  comparePeriods,
  dayKeyInTimezone,
  groupSpentByCategory,
  periodRange,
  periodRangeFromDay,
  previousPeriodRange,
  sumEarned,
  sumSpent,
  todayKeyInTimezone,
  zonedDayBounds,
} from '../src/stats';

describe('dayKeyInTimezone (границы дней по часовому поясу, ТЗ §3.4)', () => {
  it('относит момент к дню в часовом поясе пользователя', () => {
    // 2026-10-01 22:30 UTC — это уже 2 октября в Москве (+03:00).
    const instant = new Date('2026-10-01T22:30:00.000Z');
    expect(dayKeyInTimezone(instant, 'UTC')).toBe('2026-10-01');
    expect(dayKeyInTimezone(instant, 'Europe/Moscow')).toBe('2026-10-02');
    expect(dayKeyInTimezone(instant, 'America/New_York')).toBe('2026-10-01');
  });

  it('пересекает полночь назад при отрицательном смещении', () => {
    // 2026-10-02 02:00 UTC — это 1 октября в Нью-Йорке (-04:00).
    const instant = new Date('2026-10-02T02:00:00.000Z');
    expect(dayKeyInTimezone(instant, 'America/New_York')).toBe('2026-10-01');
    expect(dayKeyInTimezone(instant, 'UTC')).toBe('2026-10-02');
    expect(dayKeyInTimezone(instant, 'Asia/Tokyo')).toBe('2026-10-02');
  });

  it('полночь по поясу принадлежит начинающемуся дню', () => {
    const instant = new Date('2026-10-02T00:00:00.000Z');
    expect(dayKeyInTimezone(instant, 'UTC')).toBe('2026-10-02');
    expect(dayKeyInTimezone(instant, 'Europe/Berlin')).toBe('2026-10-02');
    // Каракас (-04:30) — момент 00:00 UTC это ещё 1 октября 19:30.
    expect(dayKeyInTimezone(instant, 'America/Caracas')).toBe('2026-10-01');
  });
});

describe('todayKeyInTimezone', () => {
  it('берёт день относительно опорного момента', () => {
    const reference = new Date('2026-10-01T22:30:00.000Z');
    expect(todayKeyInTimezone('Europe/Moscow', reference)).toBe('2026-10-02');
    expect(todayKeyInTimezone('UTC', reference)).toBe('2026-10-01');
  });
});

describe('zonedDayBounds', () => {
  it('возвращает UTC-интервал локального дня [начало, конец)', () => {
    const { start, end } = zonedDayBounds('2026-10-02', 'Europe/Moscow');
    expect(start.toISOString()).toBe('2026-10-01T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-02T21:00:00.000Z');
  });

  it('работает для UTC и отрицательных смещений', () => {
    expect(zonedDayBounds('2026-10-01', 'UTC').start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(zonedDayBounds('2026-10-01', 'UTC').end.toISOString()).toBe('2026-10-02T00:00:00.000Z');

    const newYork = zonedDayBounds('2026-10-01', 'America/New_York');
    expect(newYork.start.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(newYork.end.toISOString()).toBe('2026-10-02T04:00:00.000Z');
  });

  it('учитывает переход на летнее/зимнее время (день длиной 25 и 23 часа)', () => {
    const autumn = zonedDayBounds('2026-10-25', 'Europe/Berlin');
    expect(autumn.end.getTime() - autumn.start.getTime()).toBe(25 * 60 * 60 * 1000);

    const spring = zonedDayBounds('2026-03-29', 'Europe/Berlin');
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});

describe('addDays', () => {
  it('сдвигает ключ дня через границы месяца и года', () => {
    expect(addDays('2026-10-01', 1)).toBe('2026-10-02');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('суммы трат и доходов (ТЗ §3.4, переводы не расход)', () => {
  const transactions = [
    { type: 'expense', amount: 450 },
    { type: 'expense', amount: 100.5 },
    { type: 'income', amount: 80000 },
    { type: 'transfer', amount: 2000 },
  ] as const;

  it('складывает только расходы и игнорирует переводы', () => {
    expect(sumSpent(transactions)).toBe(550.5);
  });

  it('складывает только доходы', () => {
    expect(sumEarned(transactions)).toBe(80000);
  });

  it('на пустом списке возвращает 0 и убирает ошибки округления', () => {
    expect(sumSpent([])).toBe(0);
    expect(sumEarned([])).toBe(0);
    expect(sumSpent([{ type: 'expense', amount: 0.1 }, { type: 'expense', amount: 0.2 }])).toBe(0.3);
  });
});

describe('траты по категориям (ТЗ §3.4, отчёт за период)', () => {
  const transactions = [
    { type: 'expense', amount: 300, categoryId: 'food', categoryName: 'Еда' },
    { type: 'expense', amount: 200, categoryId: 'food', categoryName: 'Еда' },
    { type: 'expense', amount: 100, categoryId: 'transport', categoryName: 'Транспорт' },
    { type: 'expense', amount: 50, categoryId: null, categoryName: null },
    { type: 'income', amount: 5000, categoryId: 'salary', categoryName: 'Зарплата' },
    { type: 'transfer', amount: 1000, categoryId: null, categoryName: null },
  ] as const;

  it('группирует расходы по категориям и сортирует по сумме', () => {
    expect(groupSpentByCategory(transactions)).toEqual([
      { categoryId: 'food', categoryName: 'Еда', total: 500, count: 2 },
      { categoryId: 'transport', categoryName: 'Транспорт', total: 100, count: 1 },
      { categoryId: null, categoryName: null, total: 50, count: 1 },
    ]);
  });

  it('на пустом списке возвращает пустой массив', () => {
    expect(groupSpentByCategory([])).toEqual([]);
  });
});

describe('остаток бюджета (ТЗ §3.4)', () => {
  it('считает лимит минус потраченное, включая превышение', () => {
    expect(budgetRemaining(10000, 8500)).toBe(1500);
    expect(budgetRemaining(1000, 1200)).toBe(-200);
    expect(budgetRemaining(0, 0)).toBe(0);
  });
});

describe('периоды отчётов (ТЗ §3.4)', () => {
  it('день — один ключ в часовом поясе пользователя', () => {
    expect(periodRange('day', 'Europe/Moscow', new Date('2026-10-01T22:30:00.000Z'))).toEqual({
      period: 'day',
      from: '2026-10-02',
      to: '2026-10-02',
    });
  });

  it('неделя — с понедельника по воскресенье', () => {
    expect(periodRange('week', 'UTC', new Date('2026-10-01T10:00:00.000Z'))).toEqual({
      period: 'week',
      from: '2026-09-28',
      to: '2026-10-04',
    });
    // Воскресенье остаётся в той же неделе.
    expect(periodRange('week', 'UTC', new Date('2026-10-04T23:00:00.000Z')).from).toBe('2026-09-28');
  });

  it('месяц — от первого до последнего числа', () => {
    expect(periodRange('month', 'UTC', new Date('2026-10-01T10:00:00.000Z'))).toEqual({
      period: 'month',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(periodRange('month', 'UTC', new Date('2028-02-12T00:00:00.000Z')).to).toBe('2028-02-29');
  });

  it('год — с 1 января по 31 декабря', () => {
    expect(periodRange('year', 'UTC', new Date('2026-06-15T10:00:00.000Z'))).toEqual({
      period: 'year',
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('previousPeriodRange берёт ровно предыдущий период', () => {
    expect(previousPeriodRange({ period: 'day', from: '2026-10-02', to: '2026-10-02' })).toEqual({
      period: 'day',
      from: '2026-10-01',
      to: '2026-10-01',
    });
    expect(previousPeriodRange({ period: 'week', from: '2026-09-28', to: '2026-10-04' })).toEqual({
      period: 'week',
      from: '2026-09-21',
      to: '2026-09-27',
    });
    expect(previousPeriodRange({ period: 'month', from: '2026-10-01', to: '2026-10-31' })).toEqual({
      period: 'month',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(previousPeriodRange({ period: 'month', from: '2026-01-01', to: '2026-01-31' })).toEqual({
      period: 'month',
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(previousPeriodRange({ period: 'year', from: '2026-01-01', to: '2026-12-31' })).toEqual({
      period: 'year',
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });
});

describe('periodRangeFromDay', () => {
  it('строит период от конкретного дня', () => {
    expect(periodRangeFromDay('day', '2026-10-15')).toEqual({
      period: 'day',
      from: '2026-10-15',
      to: '2026-10-15',
    });
    expect(periodRangeFromDay('week', '2026-10-01')).toEqual({
      period: 'week',
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(periodRangeFromDay('month', '2026-10-15')).toEqual({
      period: 'month',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(periodRangeFromDay('year', '2026-07-04')).toEqual({
      period: 'year',
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });
});

describe('тепловая карта настроения за месяц (ТЗ §3.4)', () => {
  it('строит все дни месяца со средним настроением и null без данных', () => {
    const calendar = buildMoodCalendar('2026-10', { '2026-10-01': 4, '2026-10-03': 2.5 });
    expect(calendar).toHaveLength(31);
    expect(calendar[0]).toEqual({ day: '2026-10-01', dayOfMonth: 1, mood: 4 });
    expect(calendar[1]).toEqual({ day: '2026-10-02', dayOfMonth: 2, mood: null });
    expect(calendar[2]).toEqual({ day: '2026-10-03', dayOfMonth: 3, mood: 2.5 });
    expect(calendar[30]).toEqual({ day: '2026-10-31', dayOfMonth: 31, mood: null });
  });

  it('февраль в високосный год — 29 дней', () => {
    expect(buildMoodCalendar('2028-02', {})).toHaveLength(29);
  });
});

describe('сравнение периодов (ТЗ §3.4, разница в процентах)', () => {
  it('считает процентное изменение по тратам, доходам, настроению и чек-инам', () => {
    const comparison = comparePeriods(
      { spent: 1100, earned: 5000, avgMood: 4.2, checkins: 9 },
      { spent: 1000, earned: 4000, avgMood: 4, checkins: 10 },
    );

    expect(comparison.spent).toEqual({ current: 1100, previous: 1000, change: 10 });
    expect(comparison.earned).toEqual({ current: 5000, previous: 4000, change: 25 });
    expect(comparison.avgMood).toEqual({ current: 4.2, previous: 4, change: 5 });
    expect(comparison.checkins).toEqual({ current: 9, previous: 10, change: -10 });
  });

  it('без базового значения изменение — null', () => {
    const comparison = comparePeriods(
      { spent: 500, earned: 0, avgMood: null, checkins: 2 },
      { spent: 0, earned: 0, avgMood: null, checkins: 0 },
    );
    expect(comparison.spent.change).toBeNull();
    expect(comparison.avgMood.change).toBeNull();
    expect(comparison.checkins.change).toBeNull();
  });

  it('нули в обоих периодах — 0%', () => {
    const comparison = comparePeriods(
      { spent: 0, earned: 0, avgMood: null, checkins: 0 },
      { spent: 0, earned: 0, avgMood: null, checkins: 0 },
    );
    expect(comparison.spent.change).toBe(0);
    expect(comparison.earned.change).toBe(0);
  });
});


