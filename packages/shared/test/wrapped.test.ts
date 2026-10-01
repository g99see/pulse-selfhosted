// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  WrappedQuerySchema,
  bestStreakOf,
  bestWorstMoodMonths,
  buildWrapped,
  moodByMonth,
  mostExpensiveDay,
  mostFrequentWeekday,
  topCategories,
  type WrappedCheckin,
  type WrappedTransaction,
} from '../src/wrapped';

function expense(
  day: string,
  amount: number,
  categoryId: string | null,
  categoryName: string | null,
): WrappedTransaction {
  return { type: 'expense', amount, day, categoryId, categoryName };
}

describe('topCategories (ТЗ §3.4, J1)', () => {
  it('берёт только расходы и сортирует по сумме убыванию', () => {
    const transactions: WrappedTransaction[] = [
      expense('2026-01-01', 300, 'food', 'Еда'),
      expense('2026-01-02', 100, 'food', 'Еда'),
      expense('2026-02-01', 500, 'rent', 'Жильё'),
      { type: 'income', amount: 9999, day: '2026-03-01', categoryId: null, categoryName: null },
      { type: 'transfer', amount: 4000, day: '2026-03-02', categoryId: null, categoryName: null },
    ];

    const result = topCategories(transactions);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      categoryId: 'rent',
      categoryName: 'Жильё',
      total: 500,
      count: 1,
    });
    expect(result[1]).toMatchObject({
      categoryId: 'food',
      categoryName: 'Еда',
      total: 400,
      count: 2,
    });
  });

  it('ограничивает топ-3 и группирует расходы без категории', () => {
    const transactions: WrappedTransaction[] = [
      expense('2026-01-01', 10, 'a', 'А'),
      expense('2026-01-01', 20, 'b', 'Б'),
      expense('2026-01-01', 30, 'c', 'В'),
      expense('2026-01-01', 40, null, null),
      expense('2026-01-01', 5, null, null),
    ];

    const result = topCategories(transactions);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ categoryId: null, categoryName: null, total: 45, count: 2 });
    expect(result[1]).toMatchObject({ categoryId: 'c', total: 30 });
  });

  it('округляет суммы до копеек', () => {
    const result = topCategories([
      expense('2026-01-01', 0.1, 'a', 'А'),
      expense('2026-01-01', 0.2, 'a', 'А'),
    ]);
    expect(result[0]!.total).toBe(0.3);
  });
});

describe('mostExpensiveDay (ТЗ §3.4, J1)', () => {
  it('находит день с максимальной суммой расходов', () => {
    const transactions: WrappedTransaction[] = [
      expense('2026-01-05', 100, 'a', 'А'),
      expense('2026-01-05', 150, 'a', 'А'),
      expense('2026-01-09', 200, 'a', 'А'),
    ];
    expect(mostExpensiveDay(transactions)).toEqual({ day: '2026-01-05', spent: 250 });
  });

  it('при равенстве берёт ранний день', () => {
    const transactions: WrappedTransaction[] = [
      expense('2026-03-10', 500, 'a', 'А'),
      expense('2026-02-01', 500, 'a', 'А'),
    ];
    expect(mostExpensiveDay(transactions)).toEqual({ day: '2026-02-01', spent: 500 });
  });

  it('без расходов — null', () => {
    expect(mostExpensiveDay([])).toBeNull();
    expect(
      mostExpensiveDay([
        { type: 'income', amount: 100, day: '2026-01-01', categoryId: null, categoryName: null },
      ]),
    ).toBeNull();
  });
});

describe('mostFrequentWeekday (ТЗ §3.4, J1)', () => {
  it('считает частый день недели по числу расходов (1=Пн … 7=Вс)', () => {
    // 2026-01-01 — четверг (4). Два расхода в четверг, один в пятницу.
    const transactions: WrappedTransaction[] = [
      expense('2026-01-01', 10, 'a', 'А'),
      expense('2026-01-08', 10, 'a', 'А'),
      expense('2026-01-02', 10, 'a', 'А'),
    ];
    expect(mostFrequentWeekday(transactions)).toEqual({ weekday: 4, count: 2 });
  });

  it('при равенстве берёт меньший день недели', () => {
    // Понедельник 2026-01-05 и вторник 2026-01-06 по одному расходу.
    const transactions: WrappedTransaction[] = [
      expense('2026-01-06', 10, 'a', 'А'),
      expense('2026-01-05', 10, 'a', 'А'),
    ];
    expect(mostFrequentWeekday(transactions)).toEqual({ weekday: 1, count: 1 });
  });

  it('без расходов — null', () => {
    expect(mostFrequentWeekday([])).toBeNull();
  });
});

describe('moodByMonth / bestWorstMoodMonths (ТЗ §3.4, J1)', () => {
  it('среднее по месяцам с одним знаком и по возрастанию', () => {
    const checkins: WrappedCheckin[] = [
      { mood: 4, day: '2026-02-01' },
      { mood: 2, day: '2026-02-02' },
      { mood: 5, day: '2026-01-10' },
    ];
    const months = moodByMonth(checkins);
    expect(months).toEqual([
      { month: '2026-01', avgMood: 5 },
      { month: '2026-02', avgMood: 3 },
    ]);
  });

  it('находит лучший и худший месяц, при равенстве — ранний', () => {
    const months = [
      { month: '2026-01', avgMood: 3 },
      { month: '2026-02', avgMood: 5 },
      { month: '2026-03', avgMood: 5 },
      { month: '2026-04', avgMood: 1 },
    ];
    const { best, worst } = bestWorstMoodMonths(months);
    expect(best).toEqual({ month: '2026-02', avgMood: 5 });
    expect(worst).toEqual({ month: '2026-04', avgMood: 1 });
  });

  it('пустой список — null/null', () => {
    expect(bestWorstMoodMonths([])).toEqual({ best: null, worst: null });
  });
});

describe('bestStreakOf (ТЗ §3.4, J1)', () => {
  it('считает самый длинный стрик по уникальным дням', () => {
    const checkins: WrappedCheckin[] = [
      { mood: 3, day: '2026-01-01' },
      { mood: 4, day: '2026-01-02' },
      { mood: 5, day: '2026-01-02' },
      { mood: 2, day: '2026-01-03' },
      { mood: 4, day: '2026-02-10' },
    ];
    expect(bestStreakOf(checkins)).toBe(3);
  });

  it('без чек-инов — 0', () => {
    expect(bestStreakOf([])).toBe(0);
  });
});

describe('buildWrapped — полная сборка (ТЗ §3.4, J1)', () => {
  const transactions: WrappedTransaction[] = [
    expense('2026-01-05', 1000, 'food', 'Еда'),
    expense('2026-01-05', 500, 'food', 'Еда'),
    expense('2026-02-11', 2000, 'rent', 'Жильё'),
    { type: 'income', amount: 50000, day: '2026-01-01', categoryId: null, categoryName: null },
    { type: 'income', amount: 10000, day: '2026-02-01', categoryId: null, categoryName: null },
    { type: 'transfer', amount: 7000, day: '2026-03-01', categoryId: null, categoryName: null },
  ];
  const checkins: WrappedCheckin[] = [
    { mood: 5, day: '2026-01-05' },
    { mood: 3, day: '2026-01-06' },
    { mood: 2, day: '2026-02-10' },
  ];

  it('собирает все показатели года', () => {
    const result = buildWrapped(
      { year: 2026, transactions, checkins, closedGoals: 2, achievements: ['a', 'b', 'c'] },
      { timezone: 'Europe/Moscow', currency: 'RUB' },
    );

    expect(result.year).toBe(2026);
    expect(result.timezone).toBe('Europe/Moscow');
    expect(result.currency).toBe('RUB');
    expect(result.spent).toBe(3500);
    expect(result.earned).toBe(60000);
    expect(result.net).toBe(56500);
    expect(result.avgMood).toBe(3.3);
    expect(result.checkins).toBe(3);
    expect(result.bestStreak).toBe(2);
    expect(result.closedGoals).toBe(2);
    expect(result.achievements).toBe(3);
    expect(result.topCategories[0]).toMatchObject({ categoryName: 'Жильё', total: 2000 });
    expect(result.topCategories[1]).toMatchObject({ categoryName: 'Еда', total: 1500 });
    expect(result.mostExpensiveDay).toEqual({ day: '2026-02-11', spent: 2000 });
    expect(result.mostFrequentWeekday).toEqual({ weekday: 1, count: 2 });
    expect(result.bestMonth).toEqual({ month: '2026-01', avgMood: 4 });
    expect(result.worstMonth).toEqual({ month: '2026-02', avgMood: 2 });
  });

  it('данные только за один месяц', () => {
    const result = buildWrapped(
      {
        year: 2026,
        transactions: [expense('2026-06-01', 300, 'food', 'Еда')],
        checkins: [{ mood: 4, day: '2026-06-01' }],
        closedGoals: 0,
        achievements: [],
      },
      { timezone: 'UTC', currency: 'RUB' },
    );

    expect(result.spent).toBe(300);
    expect(result.earned).toBe(0);
    expect(result.net).toBe(-300);
    expect(result.bestMonth).toEqual({ month: '2026-06', avgMood: 4 });
    expect(result.worstMonth).toEqual({ month: '2026-06', avgMood: 4 });
    expect(result.topCategories).toHaveLength(1);
  });

  it('пустой год — нули и null', () => {
    const result = buildWrapped(
      { year: 2026, transactions: [], checkins: [], closedGoals: 0, achievements: [] },
      { timezone: 'UTC', currency: 'RUB' },
    );

    expect(result).toMatchObject({
      year: 2026,
      spent: 0,
      earned: 0,
      net: 0,
      avgMood: null,
      checkins: 0,
      bestStreak: 0,
      closedGoals: 0,
      achievements: 0,
      mostExpensiveDay: null,
      mostFrequentWeekday: null,
      bestMonth: null,
      worstMonth: null,
    });
    expect(result.topCategories).toEqual([]);
  });
});

describe('WrappedQuerySchema (ТЗ §3.4, J1)', () => {
  it('необязательный год приводится к числу', () => {
    expect(WrappedQuerySchema.safeParse({}).success).toBe(true);
    expect(WrappedQuerySchema.parse({ year: '2026' }).year).toBe(2026);
  });

  it('отклоняет год вне диапазона', () => {
    expect(WrappedQuerySchema.safeParse({ year: '1969' }).success).toBe(false);
    expect(WrappedQuerySchema.safeParse({ year: 'abc' }).success).toBe(false);
  });
});
