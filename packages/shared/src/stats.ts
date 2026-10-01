// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Статистика (ТЗ §3.4, §6): чистые функции агрегации — границы дней по часовому
 * поясу пользователя, суммы трат и доходов, разбивка по категориям, тепловая
 * карта настроения и сравнение периодов. Без побочных эффектов, чтобы их
 * использовали и API, и web, а тесты были быстрыми.
 */
import { percentChange } from './dates';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Смещение часового пояса относительно UTC в миллисекундах для момента. */
function timezoneOffsetMs(timezone: string, instant: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - instant.getTime();
}

/** UTC-момент локальной полуночи указанного дня (или другого часа) в поясе. */
function zonedTimeToUtc(dayKey: string, timezone: string, hour = 0): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  const target = Date.UTC(year, (month ?? 1) - 1, day ?? 1, hour, 0, 0, 0);

  let timestamp = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = timezoneOffsetMs(timezone, new Date(timestamp));
    const next = target - offset;
    if (next === timestamp) break;
    timestamp = next;
  }
  return new Date(timestamp);
}

/** Ключ дня YYYY-MM-DD, к которому момент относится в часовом поясе. */
export function dayKeyInTimezone(instant: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(instant);
}

/** Сегодняшний день (YYYY-MM-DD) в часовом поясе пользователя. */
export function todayKeyInTimezone(timezone: string, reference: Date = new Date()): string {
  return dayKeyInTimezone(reference, timezone);
}

/** UTC-интервал локального дня: [начало, конец) — ТЗ §3.4 «границы дней». */
export function zonedDayBounds(dayKey: string, timezone: string): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(dayKey, timezone),
    end: zonedTimeToUtc(addDays(dayKey, 1), timezone),
  };
}

/** Сдвиг ключа дня на n суток (чистая арифметика по календарю, без поясов). */
export function addDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export { DAY_MS };

/* ----- Агрегация денег (ТЗ §3.4) ----- */

export type StatTransactionKind = 'expense' | 'income' | 'transfer';

/** Минимум, нужный для сумм: тип и сумма. Переводы не считаются расходом. */
export interface StatTransaction {
  type: StatTransactionKind;
  amount: number;
}

/** Расход для разбивки по категориям. */
export interface CategorizedExpense {
  type: StatTransactionKind;
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
}

export interface CategorySpend {
  categoryId: string | null;
  categoryName: string | null;
  total: number;
  count: number;
}

/** Округление денег до копеек — убирает накопление ошибок плавающей точки. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Сумма расходов за период. Переводы между счетами не расход (ТЗ §3.2). */
export function sumSpent(transactions: readonly StatTransaction[]): number {
  return roundMoney(
    transactions
      .filter((transaction) => transaction.type === 'expense')
      .reduce((total, transaction) => total + transaction.amount, 0),
  );
}

/** Сумма доходов за период. */
export function sumEarned(transactions: readonly StatTransaction[]): number {
  return roundMoney(
    transactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((total, transaction) => total + transaction.amount, 0),
  );
}

/** Траты по категориям, по убыванию суммы (ТЗ §3.4, «траты по категориям»). */
export function groupSpentByCategory(
  transactions: readonly CategorizedExpense[],
): CategorySpend[] {
  const groups = new Map<string, CategorySpend>();

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
    .sort((left, right) => right.total - left.total);
}

/** Остаток бюджета: лимит минус потраченное; отрицательный — превышение. */
export function budgetRemaining(limit: number, spent: number): number {
  return roundMoney(limit - spent);
}

/* ----- Периоды отчётов и сравнение (ТЗ §3.4) ----- */

export type StatsPeriod = 'day' | 'week' | 'month' | 'year';

export interface PeriodRange {
  period: StatsPeriod;
  from: string;
  to: string;
}

export interface MoodCalendarDay {
  day: string;
  dayOfMonth: number;
  mood: number | null;
}

export interface PeriodTotals {
  spent: number;
  earned: number;
  avgMood: number | null;
  checkins: number;
}

export interface ComparisonMetric<T> {
  current: T;
  previous: T;
  change: number | null;
}

export interface PeriodComparison {
  spent: ComparisonMetric<number>;
  earned: ComparisonMetric<number>;
  avgMood: ComparisonMetric<number | null>;
  checkins: ComparisonMetric<number>;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDayKey(dayKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dayKey.split('-').map(Number);
  return { year, month: month ?? 1, day: day ?? 1 };
}

/** Число дней в месяце (1-based месяц). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Границы периода в часовом поясе пользователя (ТЗ §3.4).
 * День — один ключ, неделя — понедельник–воскресенье, месяц и год — календарные.
 */
export function periodRange(
  period: StatsPeriod,
  timezone: string,
  reference: Date = new Date(),
): PeriodRange {
  const dayKey = todayKeyInTimezone(timezone, reference);
  const { year, month, day } = parseDayKey(dayKey);

  if (period === 'day') {
    return { period, from: dayKey, to: dayKey };
  }

  if (period === 'month') {
    return {
      period,
      from: `${year}-${pad2(month)}-01`,
      to: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
    };
  }

  if (period === 'year') {
    return { period, from: `${year}-01-01`, to: `${year}-12-31` };
  }

  // Понедельник — первый день недели (0 = понедельник).
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  const from = addDays(dayKey, -weekday);
  return { period, from, to: addDays(from, 6) };
}

/** Предыдущий такой же период — для сравнения в процентах (ТЗ §3.4). */
export function previousPeriodRange(range: PeriodRange): PeriodRange {
  const { period, from, to } = range;

  if (period === 'day') {
    return { period, from: addDays(from, -1), to: addDays(to, -1) };
  }

  if (period === 'week') {
    return { period, from: addDays(from, -7), to: addDays(to, -7) };
  }

  if (period === 'month') {
    const { year, month } = parseDayKey(from);
    const previousYear = month === 1 ? year - 1 : year;
    const previousMonth = month === 1 ? 12 : month - 1;
    return {
      period,
      from: `${previousYear}-${pad2(previousMonth)}-01`,
      to: `${previousYear}-${pad2(previousMonth)}-${pad2(daysInMonth(previousYear, previousMonth))}`,
    };
  }

  const { year } = parseDayKey(from);
  return { period, from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
}

/**
 * Тепловая карта настроения за месяц (ТЗ §3.4): каждый день месяца со средним
 * значением; null — данных нет. Значения берутся по ключу дня.
 */
export function buildMoodCalendar(
  month: string,
  averages: Record<string, number | null>,
): MoodCalendarDay[] {
  const { year, month: monthNumber } = parseDayKey(`${month}-01`);
  const total = daysInMonth(year, monthNumber);
  const days: MoodCalendarDay[] = [];

  for (let dayOfMonth = 1; dayOfMonth <= total; dayOfMonth += 1) {
    const day = `${month}-${pad2(dayOfMonth)}`;
    days.push({ day, dayOfMonth, mood: averages[day] ?? null });
  }

  return days;
}

/** Сравнение текущего и предыдущего периода (ТЗ §3.4, «разница в процентах»). */
export function comparePeriods(current: PeriodTotals, previous: PeriodTotals): PeriodComparison {
  return {
    spent: {
      current: current.spent,
      previous: previous.spent,
      change: percentChange(current.spent, previous.spent),
    },
    earned: {
      current: current.earned,
      previous: previous.earned,
      change: percentChange(current.earned, previous.earned),
    },
    avgMood: {
      current: current.avgMood,
      previous: previous.avgMood,
      change:
        current.avgMood === null || previous.avgMood === null
          ? null
          : percentChange(current.avgMood, previous.avgMood),
    },
    checkins: {
      current: current.checkins,
      previous: previous.checkins,
      change: percentChange(current.checkins, previous.checkins),
    },
  };
}
