// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * «Год в цифрах» (ТЗ §3.4, J1): чистые функции агрегации за календарный год —
 * топ категорий, самый дорогой день, частый день недели, настроение по месяцам,
 * лучший/худший месяц и самый длинный стрик чек-инов. Без побочных эффектов,
 * чтобы их использовали и API, и web, а тесты были быстрыми.
 */
import { z } from 'zod';
import { computeStreak } from './achievements';
import { moodAverage } from './mood';
import { roundMoney, sumEarned, sumSpent } from './stats';

/** Транзакция года, уже приведённая к дню и сумме в основной валюте. */
export interface WrappedTransaction {
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  /** День «YYYY-MM-DD». */
  day: string;
  categoryId: string | null;
  categoryName: string | null;
}

/** Чек-ин года: настроение и день «YYYY-MM-DD». */
export interface WrappedCheckin {
  mood: number;
  day: string;
}

/** Всё, что нужно для расчёта «Года в цифрах» за один год. */
export interface WrappedInput {
  year: number;
  transactions: readonly WrappedTransaction[];
  checkins: readonly WrappedCheckin[];
  closedGoals: number;
  achievements: readonly string[];
}

/** Итог по категории: сумма расходов и число транзакций. */
export interface WrappedCategoryStat {
  categoryId: string | null;
  categoryName: string | null;
  total: number;
  count: number;
}

/** Среднее настроение за месяц «YYYY-MM». */
export interface WrappedMoodMonth {
  month: string;
  avgMood: number;
}

/** Ответ «Года в цифрах» — общий контракт web и api. */
export interface WrappedResponse {
  year: number;
  timezone: string;
  currency: string;
  spent: number;
  earned: number;
  net: number;
  topCategories: WrappedCategoryStat[];
  mostExpensiveDay: { day: string; spent: number } | null;
  mostFrequentWeekday: { weekday: number; count: number } | null;
  avgMood: number | null;
  bestMonth: WrappedMoodMonth | null;
  worstMonth: WrappedMoodMonth | null;
  checkins: number;
  bestStreak: number;
  closedGoals: number;
  achievements: number;
}

/** Необязательный год; по умолчанию — текущий год пользователя. */
export const WrappedQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(9999).optional(),
});

/** День недели 1=Пн … 7=Вс из ключа дня «YYYY-MM-DD» (по UTC). */
function weekdayOf(day: string): number {
  const dayOfWeek = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dayOfWeek === 0 ? 7 : dayOfWeek;
}

/** Топ категорий расходов (ТЗ §3.4): по убыванию суммы, затем по имени. */
export function topCategories(
  transactions: readonly WrappedTransaction[],
  limit = 3,
): WrappedCategoryStat[] {
  const groups = new Map<string, WrappedCategoryStat>();

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue;
    const key = transaction.categoryId ?? '__none__';
    const group = groups.get(key) ?? {
      categoryId: transaction.categoryId,
      categoryName: transaction.categoryName,
      total: 0,
      count: 0,
    };
    group.total += transaction.amount;
    group.count += 1;
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, total: roundMoney(group.total) }))
    .sort(
      (left, right) =>
        right.total - left.total ||
        (left.categoryName ?? '').localeCompare(right.categoryName ?? '', 'ru'),
    )
    .slice(0, limit);
}

/** Самый дорогой день расходов; при равенстве — ранний; null без расходов. */
export function mostExpensiveDay(
  transactions: readonly WrappedTransaction[],
): { day: string; spent: number } | null {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue;
    totals.set(transaction.day, (totals.get(transaction.day) ?? 0) + transaction.amount);
  }
  if (totals.size === 0) return null;

  let bestDay: string | null = null;
  let bestTotal = 0;
  for (const day of [...totals.keys()].sort()) {
    const total = totals.get(day)!;
    if (bestDay === null || total > bestTotal) {
      bestDay = day;
      bestTotal = total;
    }
  }
  return { day: bestDay!, spent: roundMoney(bestTotal) };
}

/** Частый день недели по числу расходных транзакций; при равенстве — меньший. */
export function mostFrequentWeekday(
  transactions: readonly WrappedTransaction[],
): { weekday: number; count: number } | null {
  const counts = new Map<number, number>();
  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue;
    const weekday = weekdayOf(transaction.day);
    counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let bestWeekday: number | null = null;
  let bestCount = 0;
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const count = counts.get(weekday) ?? 0;
    if (bestWeekday === null || count > bestCount) {
      bestWeekday = weekday;
      bestCount = count;
    }
  }
  return { weekday: bestWeekday!, count: bestCount };
}

/** Среднее настроение по месяцам «YYYY-MM» (один знак), по возрастанию месяца. */
export function moodByMonth(checkins: readonly WrappedCheckin[]): WrappedMoodMonth[] {
  const byMonth = new Map<string, number[]>();
  for (const checkin of checkins) {
    const month = checkin.day.slice(0, 7);
    const values = byMonth.get(month) ?? [];
    values.push(checkin.mood);
    byMonth.set(month, values);
  }

  return [...byMonth.keys()]
    .sort()
    .map((month) => ({ month, avgMood: moodAverage(byMonth.get(month)!) ?? 0 }));
}

/** Лучший и худший месяц по среднему настроению; при равенстве — ранний. */
export function bestWorstMoodMonths(months: readonly WrappedMoodMonth[]): {
  best: WrappedMoodMonth | null;
  worst: WrappedMoodMonth | null;
} {
  if (months.length === 0) return { best: null, worst: null };

  let best = months[0]!;
  let worst = months[0]!;
  for (const month of months) {
    if (month.avgMood > best.avgMood) best = month;
    if (month.avgMood < worst.avgMood) worst = month;
  }
  return { best, worst };
}

/** Самый длинный стрик чек-инов за год по уникальным дням. */
export function bestStreakOf(checkins: readonly WrappedCheckin[]): number {
  const days = [...new Set(checkins.map((checkin) => checkin.day))].sort();
  if (days.length === 0) return 0;
  return computeStreak(days, days[days.length - 1]!).longest;
}

/** Сборка ответа «Год в цифрах» из подготовленных данных (ТЗ §3.4, J1). */
export function buildWrapped(
  input: WrappedInput,
  meta: { timezone: string; currency: string },
): WrappedResponse {
  const spent = sumSpent(input.transactions);
  const earned = sumEarned(input.transactions);
  const months = moodByMonth(input.checkins);
  const { best, worst } = bestWorstMoodMonths(months);

  return {
    year: input.year,
    timezone: meta.timezone,
    currency: meta.currency,
    spent,
    earned,
    net: roundMoney(earned - spent),
    topCategories: topCategories(input.transactions),
    mostExpensiveDay: mostExpensiveDay(input.transactions),
    mostFrequentWeekday: mostFrequentWeekday(input.transactions),
    avgMood: moodAverage(input.checkins.map((checkin) => checkin.mood)),
    bestMonth: best,
    worstMonth: worst,
    checkins: input.checkins.length,
    bestStreak: bestStreakOf(input.checkins),
    closedGoals: input.closedGoals,
    achievements: input.achievements.length,
  };
}
