// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Функции-метрики достижений (ТЗ v2 §4): ключ метрики → число по пользователю.
 * Каталог (packages/shared/achievement-catalog) только ссылается на ключи, поэтому
 * новое достижение на готовой метрике добавляется строкой каталога без правки
 * этого файла. Данные пользователя читаются лениво и один раз на пересчёт
 * (MetricData), так что десятки метрик не множат запросы.
 */
import {
  computeStreak,
  dayKeyInTimezone,
  localParts,
  weekStartKey,
  type AchievementMetric,
} from '@puls/shared';
import type { PrismaService } from '../prisma/prisma.service';

type Row<T> = T extends Promise<(infer U)[]> ? U : never;

/** Ленивые, мемоизированные выборки данных пользователя для вычисления метрик. */
export class MetricData {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(
    readonly prisma: PrismaService,
    readonly userId: string,
    readonly now: Date = new Date(),
  ) {}

  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    let hit = this.cache.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = load();
      this.cache.set(key, hit);
    }
    return hit;
  }

  user() {
    return this.memo('user', () =>
      this.prisma.user.findUniqueOrThrow({
        where: { id: this.userId },
        select: { timezone: true, createdAt: true, checkinWeeklyGoal: true },
      }),
    );
  }

  async todayKey(): Promise<string> {
    return dayKeyInTimezone(this.now, (await this.user()).timezone);
  }

  checkins() {
    return this.memo('checkins', async () => {
      const timezone = (await this.user()).timezone;
      const rows = await this.prisma.checkIn.findMany({
        where: { userId: this.userId },
        orderBy: { occurredAt: 'asc' },
        select: {
          mood: true,
          energy: true,
          stress: true,
          sleepHours: true,
          water: true,
          steps: true,
          tags: true,
          note: true,
          daySummary: true,
          slot: true,
          occurredAt: true,
        },
      });
      return rows.map((row) => ({
        ...row,
        day: dayKeyInTimezone(row.occurredAt, timezone),
        hour: localParts(row.occurredAt, timezone).hour,
      }));
    });
  }

  transactions() {
    return this.memo('transactions', async () => {
      const rows = await this.prisma.transaction.findMany({
        where: { userId: this.userId },
        select: {
          type: true,
          amount: true,
          amountBase: true,
          toAmount: true,
          currency: true,
          date: true,
          comment: true,
          categoryId: true,
          accountId: true,
          transferAccountId: true,
          importHash: true,
        },
      });
      return rows.map((row) => ({ ...row, day: row.date.toISOString().slice(0, 10) }));
    });
  }

  accounts() {
    return this.memo('accounts', () =>
      this.prisma.account.findMany({
        where: { userId: this.userId },
        select: { id: true, type: true, currency: true, balance: true },
      }),
    );
  }

  budgets() {
    return this.memo('budgets', () =>
      this.prisma.budget.findMany({
        where: { userId: this.userId },
        select: { categoryId: true, month: true, limit: true },
      }),
    );
  }

  bankBalances() {
    return this.memo('bankBalances', () =>
      this.prisma.accountBankBalance.findMany({
        where: { userId: this.userId },
        orderBy: { createdAt: 'asc' },
        select: { accountId: true, source: true, balance: true, asOf: true },
      }),
    );
  }

  goals() {
    return this.memo('goals', () =>
      this.prisma.goal.findMany({
        where: { userId: this.userId },
        select: { targetAmount: true, savedAmount: true },
      }),
    );
  }

  goalDeposits() {
    return this.memo('goalDeposits', () =>
      this.prisma.goalDeposit.findMany({
        where: { userId: this.userId },
        select: { date: true },
      }),
    );
  }

  habitCount() {
    return this.memo('habitCount', () =>
      this.prisma.habit.count({ where: { userId: this.userId } }),
    );
  }

  habitLogs() {
    return this.memo('habitLogs', async () => {
      const rows = await this.prisma.habitLog.findMany({
        where: { userId: this.userId, done: true },
        select: { habitId: true, date: true },
      });
      return rows.map((row) => ({
        habitId: row.habitId,
        day: row.date.toISOString().slice(0, 10),
      }));
    });
  }

  /** Дни активности: любые чек-ины, операции, отметки привычек, пополнения целей. */
  activeDays() {
    return this.memo('activeDays', async () => {
      const [checkins, transactions, logs, deposits] = await Promise.all([
        this.checkins(),
        this.transactions(),
        this.habitLogs(),
        this.goalDeposits(),
      ]);
      return new Set<string>([
        ...checkins.map((row) => row.day),
        ...transactions.map((row) => row.day),
        ...logs.map((row) => row.day),
        ...deposits.map((row) => row.date.toISOString().slice(0, 10)),
      ]);
    });
  }
}

export type MetricFn = (data: MetricData) => Promise<number>;

const distinct = (values: Iterable<string>): number => new Set(values).size;

/** Самая длинная серия подряд идущих дней среди ключей. */
async function longestStreak(data: MetricData, days: Iterable<string>): Promise<number> {
  return computeStreak([...days], await data.todayKey()).longest;
}

/** День недели (0 — воскресенье) для ключа дня YYYY-MM-DD. */
function utcWeekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Выходной ли день (суббота или воскресенье). */
function isWeekend(day: string): boolean {
  const weekday = utcWeekday(day);
  return weekday === 0 || weekday === 6;
}

/** Число разных дней с заданным днём недели (0 — воскресенье). */
function weekdayDays(rows: readonly { day: string }[], weekday: number): number {
  const days = new Set(rows.map((row) => row.day));
  return [...days].filter((day) => utcWeekday(day) === weekday).length;
}

/** Сумма операции в основной валюте (amountBase, при нуле — amount). */
function baseAmount(tx: Row<ReturnType<MetricData['transactions']>>): number {
  const base = Number(tx.amountBase);
  return base > 0 ? base : Number(tx.amount);
}

/** Доходы и расходы по месяцам YYYY-MM в основной валюте. */
function monthlyTotals(
  transactions: readonly Row<ReturnType<MetricData['transactions']>>[],
): Map<string, { income: number; expense: number }> {
  const months = new Map<string, { income: number; expense: number }>();
  for (const tx of transactions) {
    if (tx.type !== 'income' && tx.type !== 'expense') continue;
    const month = tx.day.slice(0, 7);
    const bucket = months.get(month) ?? { income: 0, expense: 0 };
    if (tx.type === 'income') bucket.income += baseAmount(tx);
    else bucket.expense += baseAmount(tx);
    months.set(month, bucket);
  }
  return months;
}

/** Последний ли это день своего месяца для ключа YYYY-MM-DD. */
function isMonthEnd(day: string): boolean {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return dayOfMonth === last;
}

/** Дата-палиндром: YYYYMMDD читается одинаково в обе стороны. */
function isPalindromeDate(day: string): boolean {
  const digits = day.replace(/-/g, '');
  return digits === [...digits].reverse().join('');
}

/** Месяцы, где траты не превысили 80% лимита бюджета. */
async function under80BudgetMonths(data: MetricData): Promise<string[]> {
  const [budgets, transactions, todayKey] = await Promise.all([
    data.budgets(),
    data.transactions(),
    data.todayKey(),
  ]);
  const currentMonth = todayKey.slice(0, 7);
  const limits = new Map<string, number>();
  for (const budget of budgets) {
    limits.set(budget.month, (limits.get(budget.month) ?? 0) + Number(budget.limit));
  }
  const spent = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    const month = tx.day.slice(0, 7);
    spent.set(month, (spent.get(month) ?? 0) + baseAmount(tx));
  }
  return [...limits.keys()].filter(
    (month) => month < currentMonth && (spent.get(month) ?? 0) <= (limits.get(month) ?? 0) * 0.8,
  );
}

/** Самая длинная серия подряд идущих месяцев (YYYY-MM) из набора. */
function longestMonthRun(months: readonly string[]): number {
  const sorted = [...new Set(months)].sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const key of sorted) {
    const [year, month] = key.split('-').map(Number);
    const index = year! * 12 + (month! - 1);
    run = previous !== null && index === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = index;
  }
  return best;
}

/** Закрытые без превышения месяцы: сумма трат за прошедший месяц не выше суммы лимитов. */
async function closedBudgetMonths(data: MetricData): Promise<string[]> {
  const [budgets, transactions, todayKey] = await Promise.all([
    data.budgets(),
    data.transactions(),
    data.todayKey(),
  ]);
  const currentMonth = todayKey.slice(0, 7);
  const limits = new Map<string, number>();
  for (const budget of budgets) {
    limits.set(budget.month, (limits.get(budget.month) ?? 0) + Number(budget.limit));
  }
  const spent = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    const month = tx.day.slice(0, 7);
    const base = Number(tx.amountBase);
    spent.set(month, (spent.get(month) ?? 0) + (base > 0 ? base : Number(tx.amount)));
  }
  return [...limits.keys()].filter(
    (month) => month < currentMonth && (spent.get(month) ?? 0) <= (limits.get(month) ?? 0),
  );
}

/** Счета, у которых баланс Пульса на дату банка совпал с банковским (копейка в копейку). */
async function matchedAccounts(data: MetricData): Promise<number> {
  const [accounts, banks, transactions] = await Promise.all([
    data.accounts(),
    data.bankBalances(),
    data.transactions(),
  ]);
  const latest = new Map<string, (typeof banks)[number]>();
  for (const bank of banks) latest.set(bank.accountId, bank);
  let matched = 0;
  for (const account of accounts) {
    const bank = latest.get(account.id);
    if (!bank) continue;
    const asOf = bank.asOf.toISOString().slice(0, 10);
    let after = 0;
    for (const tx of transactions) {
      if (tx.day <= asOf) continue;
      if (tx.accountId !== account.id && tx.transferAccountId !== account.id) continue;
      if (tx.type === 'income') after += Number(tx.amount);
      else if (tx.type === 'expense') after -= Number(tx.amount);
      else if (tx.accountId === account.id) after -= Number(tx.amount);
      else after += Number(tx.toAmount ?? tx.amount);
    }
    const pulse = Math.round((Number(account.balance) - after) * 100);
    if (pulse === Math.round(Number(bank.balance) * 100)) matched += 1;
  }
  return matched;
}

/** Дни по максимуму значения поля за день, удовлетворяющему условию. */
function daysWhere<T extends { day: string }>(
  rows: readonly T[],
  predicate: (row: T) => boolean,
): Set<string> {
  return new Set(rows.filter(predicate).map((row) => row.day));
}

const isFull = (c: Row<ReturnType<MetricData['checkins']>>): boolean =>
  c.energy !== null &&
  c.stress !== null &&
  c.sleepHours !== null &&
  c.water !== null &&
  c.steps !== null;

/** Утро/вечер: явный слот, а без слота — по местному часу чек-ина. */
const slotOf = (c: Row<ReturnType<MetricData['checkins']>>): 'morning' | 'evening' | 'day' =>
  c.slot === 'morning' || c.slot === 'evening' || c.slot === 'day'
    ? c.slot
    : c.hour < 12
      ? 'morning'
      : c.hour >= 18
        ? 'evening'
        : 'day';

/** Реестр метрик: полный набор ключей из каталога проверяется типом Record. */
export const METRICS: Record<AchievementMetric, MetricFn> = {
  // ----- Чек-ины -----
  checkin_count: async (d) => (await d.checkins()).length,
  checkin_days: async (d) => distinct((await d.checkins()).map((c) => c.day)),
  checkin_streak_best: async (d) =>
    longestStreak(
      d,
      (await d.checkins()).map((c) => c.day),
    ),
  checkin_full_count: async (d) => (await d.checkins()).filter(isFull).length,
  checkin_note_count: async (d) => (await d.checkins()).filter((c) => !!c.note?.trim()).length,
  checkin_tag_count: async (d) => (await d.checkins()).filter((c) => c.tags.length > 0).length,
  checkin_summary_count: async (d) =>
    (await d.checkins()).filter((c) => !!c.daySummary?.trim()).length,
  checkin_energy_count: async (d) => (await d.checkins()).filter((c) => c.energy !== null).length,
  checkin_stress_count: async (d) => (await d.checkins()).filter((c) => c.stress !== null).length,
  checkin_water_days: async (d) => daysWhere(await d.checkins(), (c) => (c.water ?? 0) >= 8).size,
  checkin_steps_days: async (d) =>
    daysWhere(await d.checkins(), (c) => (c.steps ?? 0) >= 10_000).size,
  checkin_sleep_days: async (d) =>
    daysWhere(
      await d.checkins(),
      (c) => c.sleepHours !== null && c.sleepHours >= 7 && c.sleepHours <= 9,
    ).size,
  checkin_morning_count: async (d) =>
    (await d.checkins()).filter((c) => slotOf(c) === 'morning').length,
  checkin_evening_count: async (d) =>
    (await d.checkins()).filter((c) => slotOf(c) === 'evening').length,
  checkin_both_slots_days: async (d) => {
    const rows = await d.checkins();
    const morning = daysWhere(rows, (c) => slotOf(c) === 'morning');
    const evening = daysWhere(rows, (c) => slotOf(c) === 'evening');
    return [...morning].filter((day) => evening.has(day)).length;
  },
  checkin_high_mood_count: async (d) => (await d.checkins()).filter((c) => c.mood >= 5).length,
  checkin_weekend_days: async (d) => {
    const days = new Set((await d.checkins()).map((c) => c.day));
    return [...days].filter((day) => {
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      return weekday === 0 || weekday === 6;
    }).length;
  },
  checkin_goal_weeks: async (d) => {
    const goal = (await d.user()).checkinWeeklyGoal;
    if (!goal) return 0;
    const perWeek = new Map<string, number>();
    for (const c of await d.checkins()) {
      const week = weekStartKey(c.day);
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
    return [...perWeek.values()].filter((count) => count >= goal).length;
  },
  special_midnight_checkins: async (d) => (await d.checkins()).filter((c) => c.hour === 0).length,
  special_early_checkins: async (d) =>
    (await d.checkins()).filter((c) => c.hour >= 4 && c.hour < 6).length,
  special_new_year_checkin: async (d) =>
    (await d.checkins()).some((c) => c.day.slice(5) === '01-01') ? 1 : 0,
  special_leap_day_checkin: async (d) =>
    (await d.checkins()).some((c) => c.day.slice(5) === '02-29') ? 1 : 0,
  mood_comeback_count: async (d) => {
    const rows = await d.checkins();
    let count = 0;
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i - 1]!.mood <= 2 && rows[i]!.mood >= 4) count += 1;
    }
    return count;
  },
  checkin_tag_distinct: async (d) => distinct((await d.checkins()).flatMap((c) => c.tags)),
  checkin_note_chars: async (d) =>
    (await d.checkins()).reduce((sum, c) => sum + (c.note?.trim().length ?? 0), 0),
  checkin_water_total: async (d) =>
    (await d.checkins()).reduce((sum, c) => sum + (c.water ?? 0), 0),
  checkin_steps_total: async (d) =>
    (await d.checkins()).reduce((sum, c) => sum + (c.steps ?? 0), 0),
  checkin_sleep_avg_x10: async (d) => {
    const values = (await d.checkins())
      .map((c) => c.sleepHours)
      .filter((value): value is number => value !== null);
    if (values.length === 0) return 0;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10);
  },
  checkin_mood_avg_x10: async (d) => {
    const rows = await d.checkins();
    if (rows.length === 0) return 0;
    return Math.round((rows.reduce((sum, c) => sum + c.mood, 0) / rows.length) * 10);
  },
  checkin_energy_avg_x10: async (d) => {
    const values = (await d.checkins())
      .map((c) => c.energy)
      .filter((value): value is number => value !== null);
    if (values.length === 0) return 0;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10);
  },
  checkin_calm_count: async (d) =>
    (await d.checkins()).filter((c) => c.stress !== null && c.stress <= 2).length,
  checkin_energized_count: async (d) =>
    (await d.checkins()).filter((c) => c.energy !== null && c.energy >= 4).length,
  checkin_late_count: async (d) => (await d.checkins()).filter((c) => c.hour >= 22).length,
  checkin_double_days: async (d) => {
    const perDay = new Map<string, number>();
    for (const c of await d.checkins()) perDay.set(c.day, (perDay.get(c.day) ?? 0) + 1);
    return [...perDay.values()].filter((count) => count >= 2).length;
  },
  checkin_full_streak_best: async (d) => longestStreak(d, daysWhere(await d.checkins(), isFull)),
  checkin_perfect_weeks: async (d) => {
    const perWeek = new Map<string, Set<string>>();
    for (const c of await d.checkins()) {
      const week = weekStartKey(c.day);
      const days = perWeek.get(week) ?? new Set<string>();
      days.add(c.day);
      perWeek.set(week, days);
    }
    return [...perWeek.values()].filter((days) => days.size >= 7).length;
  },
  checkin_water_streak_best: async (d) =>
    longestStreak(
      d,
      daysWhere(await d.checkins(), (c) => (c.water ?? 0) >= 8),
    ),
  checkin_steps_streak_best: async (d) =>
    longestStreak(
      d,
      daysWhere(await d.checkins(), (c) => (c.steps ?? 0) >= 10_000),
    ),
  checkin_sleep_streak_best: async (d) =>
    longestStreak(
      d,
      daysWhere(
        await d.checkins(),
        (c) => c.sleepHours !== null && c.sleepHours >= 7 && c.sleepHours <= 9,
      ),
    ),
  checkin_monday_days: async (d) => weekdayDays(await d.checkins(), 1),
  checkin_tuesday_days: async (d) => weekdayDays(await d.checkins(), 2),
  checkin_wednesday_days: async (d) => weekdayDays(await d.checkins(), 3),
  checkin_thursday_days: async (d) => weekdayDays(await d.checkins(), 4),
  checkin_friday_days: async (d) => weekdayDays(await d.checkins(), 5),
  checkin_saturday_days: async (d) => weekdayDays(await d.checkins(), 6),
  checkin_sunday_days: async (d) => weekdayDays(await d.checkins(), 0),
  special_friday13_checkin: async (d) =>
    (await d.checkins()).some((c) => utcWeekday(c.day) === 5 && c.day.slice(8, 10) === '13')
      ? 1
      : 0,
  special_month_start_checkin: async (d) =>
    (await d.checkins()).filter((c) => c.day.slice(8, 10) === '01').length,
  special_month_end_checkin: async (d) =>
    (await d.checkins()).filter((c) => isMonthEnd(c.day)).length,
  special_palindrome_checkin: async (d) =>
    (await d.checkins()).some((c) => isPalindromeDate(c.day)) ? 1 : 0,
  special_halloween_checkin: async (d) =>
    (await d.checkins()).some((c) => c.day.slice(5) === '10-31') ? 1 : 0,

  // ----- Финансы: операции -----
  transaction_count: async (d) => (await d.transactions()).length,
  income_count: async (d) => (await d.transactions()).filter((t) => t.type === 'income').length,
  expense_count: async (d) => (await d.transactions()).filter((t) => t.type === 'expense').length,
  transfer_count: async (d) => (await d.transactions()).filter((t) => t.type === 'transfer').length,
  transaction_days: async (d) => distinct((await d.transactions()).map((t) => t.day)),
  transaction_streak_best: async (d) =>
    longestStreak(
      d,
      (await d.transactions()).map((t) => t.day),
    ),
  transaction_comment_count: async (d) =>
    (await d.transactions()).filter((t) => !!t.comment?.trim()).length,
  category_used_count: async (d) =>
    distinct((await d.transactions()).flatMap((t) => (t.categoryId ? [t.categoryId] : []))),
  currency_count: async (d) => {
    const [accounts, transactions] = await Promise.all([d.accounts(), d.transactions()]);
    return distinct([...accounts.map((a) => a.currency), ...transactions.map((t) => t.currency)]);
  },
  account_count: async (d) => (await d.accounts()).length,
  account_type_count: async (d) => distinct((await d.accounts()).map((a) => a.type)),
  expense_total_base: async (d) =>
    (await d.transactions())
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + baseAmount(t), 0),
  income_total_base: async (d) =>
    (await d.transactions())
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + baseAmount(t), 0),
  savings_rate_best: async (d) => {
    let best = 0;
    for (const { income, expense } of monthlyTotals(await d.transactions()).values()) {
      if (income > 0) best = Math.max(best, Math.floor(((income - expense) / income) * 100));
    }
    return best;
  },
  net_positive_months: async (d) => {
    let count = 0;
    for (const { income, expense } of monthlyTotals(await d.transactions()).values()) {
      if (income > 0 && income > expense) count += 1;
    }
    return count;
  },
  transaction_max_amount: async (d) => {
    let max = 0;
    for (const t of await d.transactions()) max = Math.max(max, baseAmount(t));
    return max;
  },
  transaction_round_count: async (d) =>
    (await d.transactions()).filter((t) => {
      const amount = Math.round(Number(t.amount));
      return amount > 0 && amount % 100 === 0;
    }).length,
  transaction_weekend_count: async (d) =>
    (await d.transactions()).filter((t) => isWeekend(t.day)).length,
  transaction_distinct_months: async (d) =>
    distinct((await d.transactions()).map((t) => t.day.slice(0, 7))),
  transaction_long_comment_count: async (d) =>
    (await d.transactions()).filter((t) => (t.comment?.trim().length ?? 0) >= 20).length,
  import_days: async (d) =>
    distinct((await d.transactions()).filter((t) => t.importHash !== null).map((t) => t.day)),
  reconciliation_source_count: async (d) => distinct((await d.bankBalances()).map((b) => b.source)),
  budget_under80_months: async (d) => (await under80BudgetMonths(d)).length,
  goal_active_count: async (d) =>
    (await d.goals()).filter(
      (g) => Number(g.targetAmount) > 0 && Number(g.savedAmount) < Number(g.targetAmount),
    ).length,
  goal_saved_total: async (d) =>
    (await d.goals()).reduce((sum, g) => sum + Number(g.savedAmount), 0),

  // ----- Финансы: бюджеты -----
  budget_count: async (d) => (await d.budgets()).length,
  budget_category_count: async (d) => distinct((await d.budgets()).map((b) => b.categoryId)),
  budget_closed_months: async (d) => (await closedBudgetMonths(d)).length,
  budget_closed_streak_best: async (d) => longestMonthRun(await closedBudgetMonths(d)),

  // ----- Финансы: сверка и импорт -----
  reconciliation_count: async (d) => (await d.bankBalances()).length,
  reconciliation_account_count: async (d) =>
    distinct((await d.bankBalances()).map((b) => b.accountId)),
  reconciliation_statement_count: async (d) =>
    (await d.bankBalances()).filter((b) => b.source === 'statement').length,
  reconciliation_matched_accounts: matchedAccounts,
  import_transaction_count: async (d) =>
    (await d.transactions()).filter((t) => t.importHash !== null).length,

  // ----- Накопления -----
  goal_count: async (d) => (await d.goals()).length,
  goal_best_percent: async (d) => {
    let best = 0;
    for (const goal of await d.goals()) {
      const target = Number(goal.targetAmount);
      if (target > 0) best = Math.max(best, Math.floor((Number(goal.savedAmount) / target) * 100));
    }
    return best;
  },
  goal_completed_count: async (d) =>
    (await d.goals()).filter(
      (g) => Number(g.targetAmount) > 0 && Number(g.savedAmount) >= Number(g.targetAmount),
    ).length,
  goal_deposit_count: async (d) => (await d.goalDeposits()).length,
  goal_deposit_days: async (d) =>
    distinct((await d.goalDeposits()).map((g) => g.date.toISOString().slice(0, 10))),

  // ----- Привычки -----
  habit_count: (d) => d.habitCount(),
  habit_log_count: async (d) => (await d.habitLogs()).length,
  habit_active_days: async (d) => distinct((await d.habitLogs()).map((l) => l.day)),
  habit_best_streak: async (d) => {
    const byHabit = new Map<string, string[]>();
    for (const log of await d.habitLogs()) {
      byHabit.set(log.habitId, [...(byHabit.get(log.habitId) ?? []), log.day]);
    }
    const today = await d.todayKey();
    let best = 0;
    for (const days of byHabit.values()) best = Math.max(best, computeStreak(days, today).longest);
    return best;
  },
  habit_multi_days: async (d) => {
    const perDay = new Map<string, number>();
    for (const log of await d.habitLogs()) perDay.set(log.day, (perDay.get(log.day) ?? 0) + 1);
    return [...perDay.values()].filter((count) => count >= 3).length;
  },
  habit_active_count: async (d) => distinct((await d.habitLogs()).map((l) => l.habitId)),
  habit_week_count: async (d) => distinct((await d.habitLogs()).map((l) => weekStartKey(l.day))),
  habit_month_count: async (d) => distinct((await d.habitLogs()).map((l) => l.day.slice(0, 7))),

  // ----- Активность -----
  active_days: async (d) => (await d.activeDays()).size,
  active_streak_best: async (d) => longestStreak(d, await d.activeDays()),
  active_modules: async (d) => {
    const [checkins, transactions, budgets, goals, habits, banks] = await Promise.all([
      d.checkins(),
      d.transactions(),
      d.budgets(),
      d.goals(),
      d.habitCount(),
      d.bankBalances(),
    ]);
    return [
      checkins.length > 0,
      transactions.length > 0,
      budgets.length > 0,
      goals.length > 0,
      habits > 0,
      banks.length > 0,
      transactions.some((t) => t.importHash !== null),
    ].filter(Boolean).length;
  },
  account_age_days: async (d) =>
    Math.max(0, Math.floor((d.now.getTime() - (await d.user()).createdAt.getTime()) / 86_400_000)),
  perfect_days: async (d) => {
    const [checkins, transactions, logs] = await Promise.all([
      d.checkins(),
      d.transactions(),
      d.habitLogs(),
    ]);
    const full = daysWhere(checkins, isFull);
    const tx = new Set(transactions.map((t) => t.day));
    const habit = new Set(logs.map((l) => l.day));
    return [...full].filter((day) => tx.has(day) && habit.has(day)).length;
  },
  active_weekday_count: async (d) => {
    const days = await d.activeDays();
    return new Set([...days].map((day) => utcWeekday(day))).size;
  },
  active_month_count: async (d) => {
    const days = await d.activeDays();
    return new Set([...days].map((day) => day.slice(0, 7))).size;
  },
  active_weekend_days: async (d) => {
    const days = await d.activeDays();
    return [...days].filter((day) => isWeekend(day)).length;
  },
  account_age_months: async (d) =>
    Math.floor(
      Math.max(0, d.now.getTime() - (await d.user()).createdAt.getTime()) / (86_400_000 * 30),
    ),
};
