// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты функций-метрик достижений (ТЗ v2 §4): реестр покрывает каталог и
// считает числа по данным пользователя. Без БД — MetricData подменяется фейком.
import { ACHIEVEMENT_METRICS } from '@puls/shared';
import { describe, expect, it } from 'vitest';
import { METRICS, type MetricData } from './metrics';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const TODAY = '2026-10-05';

interface CheckinRow {
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
  occurredAt: Date;
  day: string;
  hour: number;
}

interface TransactionRow {
  type: string;
  amount: string;
  amountBase: string;
  toAmount: string | null;
  currency: string;
  date: Date;
  comment: string | null;
  categoryId: string | null;
  accountId: string | null;
  transferAccountId: string | null;
  importHash: string | null;
  day: string;
}

function checkin(day: string, overrides: Partial<CheckinRow> = {}): CheckinRow {
  return {
    mood: 3,
    energy: null,
    stress: null,
    sleepHours: null,
    water: null,
    steps: null,
    tags: [],
    note: null,
    daySummary: null,
    slot: null,
    occurredAt: new Date(`${day}T12:00:00.000Z`),
    day,
    hour: 12,
    ...overrides,
  };
}

function transaction(day: string, overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    type: 'expense',
    amount: '100',
    amountBase: '100',
    toAmount: null,
    currency: 'RUB',
    date: new Date(`${day}T12:00:00.000Z`),
    comment: null,
    categoryId: null,
    accountId: 'acc-1',
    transferAccountId: null,
    importHash: null,
    day,
    ...overrides,
  };
}

/** Фейк MetricData: только источник строк, без Prisma. */
function makeData(partial: Partial<Record<string, unknown>> = {}): MetricData {
  const base = {
    now: NOW,
    user: async () => ({
      timezone: 'UTC',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      checkinWeeklyGoal: null,
    }),
    todayKey: async () => TODAY,
    checkins: async () => [],
    transactions: async () => [],
    accounts: async () => [],
    budgets: async () => [],
    bankBalances: async () => [],
    goals: async () => [],
    goalDeposits: async () => [],
    habitCount: async () => 0,
    habitLogs: async () => [],
    activeDays: async () => new Set<string>(),
  };
  return { ...base, ...partial } as unknown as MetricData;
}

describe('реестр метрик достижений', () => {
  it('покрывает все метрики каталога ровно по одному разу', () => {
    expect(Object.keys(METRICS).sort()).toEqual([...ACHIEVEMENT_METRICS].sort());
  });

  it('каждая метрика возвращает число', async () => {
    const data = makeData();
    for (const metric of ACHIEVEMENT_METRICS) {
      const value = await METRICS[metric](data);
      expect(Number.isFinite(value), metric).toBe(true);
    }
  });
});

describe('метрики чек-инов', () => {
  it('checkin_count считает число записей, checkin_days — разные дни', async () => {
    const data = makeData({
      checkins: async () => [checkin('2026-10-01'), checkin('2026-10-01'), checkin('2026-10-02')],
    });
    expect(await METRICS.checkin_count(data)).toBe(3);
    expect(await METRICS.checkin_days(data)).toBe(2);
  });

  it('checkin_streak_best считает самую длинную серию подряд', async () => {
    const data = makeData({
      checkins: async () => [
        checkin('2026-09-20'),
        checkin('2026-10-01'),
        checkin('2026-10-02'),
        checkin('2026-10-03'),
      ],
    });
    expect(await METRICS.checkin_streak_best(data)).toBe(3);
  });

  it('checkin_water_days считает дни с 8+ стаканами', async () => {
    const data = makeData({
      checkins: async () => [
        checkin('2026-10-01', { water: 8 }),
        checkin('2026-10-02', { water: 5 }),
        checkin('2026-10-03', { water: 10 }),
      ],
    });
    expect(await METRICS.checkin_water_days(data)).toBe(2);
  });
});

describe('метрики финансов и накоплений', () => {
  it('transaction_days считает разные дни с операциями', async () => {
    const data = makeData({
      transactions: async () => [
        transaction('2026-10-01'),
        transaction('2026-10-01', { type: 'income' }),
        transaction('2026-10-02'),
      ],
    });
    expect(await METRICS.transaction_days(data)).toBe(2);
    expect(await METRICS.expense_count(data)).toBe(2);
    expect(await METRICS.income_count(data)).toBe(1);
  });

  it('goal_best_percent берёт лучший процент по цели', async () => {
    const data = makeData({
      goals: async () => [
        { targetAmount: '1000', savedAmount: '500' },
        { targetAmount: '200', savedAmount: '50' },
      ],
    });
    expect(await METRICS.goal_best_percent(data)).toBe(50);
  });
});

describe('метрики активности', () => {
  it('active_days и active_streak_best считают по множеству активных дней', async () => {
    const data = makeData({
      activeDays: async () => new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']),
    });
    expect(await METRICS.active_days(data)).toBe(4);
    expect(await METRICS.active_streak_best(data)).toBe(4);
  });

  it('account_age_days считает дни с регистрации', async () => {
    const data = makeData({
      user: async () => ({
        timezone: 'UTC',
        createdAt: new Date('2026-10-01T12:00:00.000Z'),
        checkinWeeklyGoal: null,
      }),
    });
    expect(await METRICS.account_age_days(data)).toBe(4);
  });
});
