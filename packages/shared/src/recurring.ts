// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Регулярные платежи (ТЗ §3.2): аренда, подписки и другие периодические
 * списания. Здесь только чистые расчёты — следующая дата платежа с учётом
 * конца месяца (31-е → 30/28/29), високосного года, часового пояса
 * пользователя и переходов DST, — плюс схемы и контракты API. Без побочных
 * эффектов: пригодно для unit-тестов и переиспользования в API и web.
 */
import { z } from 'zod';
import { localParts } from './notifications';
import { daysInMonth } from './stats';

/* ----- Периодичность ----- */

export const RECURRENCE_FREQUENCIES = ['weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
export const RecurrenceFrequencySchema = z.enum(RECURRENCE_FREQUENCIES);

/** Тип платежа: списание (расход) или поступление (доход). */
export const RecurringPaymentTypeSchema = z.enum(['expense', 'income']);
export type RecurringPaymentType = z.infer<typeof RecurringPaymentTypeSchema>;

/** Время суток, когда создаётся транзакция, по умолчанию (локально). */
export const DEFAULT_RECURRING_TIME = '10:00';

/** Дни недели 1–7, как в ISO: 1 — понедельник, 7 — воскресенье. */
export const WEEKDAY_MIN = 1;
export const WEEKDAY_MAX = 7;
export const DAY_OF_MONTH_MIN = 1;
export const DAY_OF_MONTH_MAX = 31;
export const MONTH_MIN = 1;
export const MONTH_MAX = 12;

/** Правило периодичности: еженедельно, ежемесячно или ежегодно + день. */
export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** weekly: 1–7 (Пн–Вс); monthly и yearly: 1–31. */
  day: number;
  /** Только для yearly: 1–12. */
  month?: number;
}

/* ----- Календарь ----- */

export interface DateOnly {
  year: number;
  month: number;
  day: number;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** День платежа, прижатый к длине месяца: 31-е → 30/28/29 (ТЗ §3.2). */
export function clampDayToMonth(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

function toUtcDate(date: DateOnly): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function fromUtcDate(date: Date): DateOnly {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Сдвигает дату на календарные дни. */
export function addDaysToDate(date: DateOnly, days: number): DateOnly {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return fromUtcDate(shifted);
}

/** Момент месяца со сдвигом на offset месяцев (месяц в диапазоне 1–12). */
function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + offset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** ISO-день недели: 1 (Пн) – 7 (Вс). */
export function isoWeekday(date: DateOnly): number {
  const weekday = toUtcDate(date).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function compareDate(a: DateOnly, b: DateOnly): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/** Дата — плановая для правила? Учитывает прижатие к концу месяца. */
export function isOccurrenceDate(date: DateOnly, rule: RecurrenceRule): boolean {
  switch (rule.frequency) {
    case 'weekly':
      return isoWeekday(date) === rule.day;
    case 'monthly':
      return date.day === clampDayToMonth(date.year, date.month, rule.day);
    case 'yearly':
      return (
        rule.month !== undefined &&
        date.month === rule.month &&
        date.day === clampDayToMonth(date.year, rule.month, rule.day)
      );
  }
}

/** Ближайшая плановая дата строго после `after`. */
export function nextOccurrenceDate(after: DateOnly, rule: RecurrenceRule): DateOnly {
  switch (rule.frequency) {
    case 'weekly': {
      let candidate = addDaysToDate(after, 1);
      for (let step = 0; step < WEEKDAY_MAX; step += 1) {
        if (isoWeekday(candidate) === rule.day) return candidate;
        candidate = addDaysToDate(candidate, 1);
      }
      return candidate;
    }
    case 'monthly': {
      for (let offset = 0; offset < 24; offset += 1) {
        const { year, month } = addMonths(after.year, after.month, offset);
        const candidate = { year, month, day: clampDayToMonth(year, month, rule.day) };
        if (compareDate(candidate, after) > 0) return candidate;
      }
      return after;
    }
    case 'yearly': {
      const month = rule.month ?? 1;
      for (let offset = 0; offset < 8; offset += 1) {
        const year = after.year + offset;
        const candidate = { year, month, day: clampDayToMonth(year, month, rule.day) };
        if (compareDate(candidate, after) > 0) return candidate;
      }
      return after;
    }
  }
}

/* ----- Часовой пояс и DST ----- */

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Перевод «настенного» времени зоны в конкретный момент UTC. Два прохода по
 * смещению корректно обрабатывают переходы DST (смещение проверяется в найденном
 * моменте, а не в предположительном).
 */
export function wallTimeToInstant(
  date: DateOnly,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0);
  const firstOffset = zoneOffsetMs(new Date(utcGuess), timeZone);
  const instant = utcGuess - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(instant), timeZone);
  return new Date(utcGuess - secondOffset);
}

/** Локальная календарная дата момента в часовом поясе. */
export function localDateOf(instant: Date, timeZone: string): DateOnly {
  const parts = localParts(instant, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

/** Разбирает «HH:MM» в часы и минуты. */
function parseClock(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return { hour: 10, minute: 0 };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return { hour: 10, minute: 0 };
  return { hour, minute };
}

/** Дата в формате YYYY-MM-DD — для колонки @db.Date транзакции. */
export function formatDateOnly(date: DateOnly): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/* ----- Расписание платежа ----- */

export interface RecurringSchedule {
  rule: RecurrenceRule;
  /** Время списания «HH:MM» в зоне пользователя. */
  timeOfDay: string;
  timezone: string;
}

export interface Occurrence {
  /** Локальная дата списания в зоне пользователя. */
  date: DateOnly;
  /** Момент списания в UTC. */
  instant: Date;
}

function instantFor(schedule: RecurringSchedule, date: DateOnly): Date {
  const { hour, minute } = parseClock(schedule.timeOfDay);
  return wallTimeToInstant(date, hour, minute, schedule.timezone);
}

/** Ближайшее списание строго после `after`. */
export function nextOccurrence(schedule: RecurringSchedule, after: Date): Occurrence {
  const today = localDateOf(after, schedule.timezone);
  let date = isOccurrenceDate(today, schedule.rule)
    ? today
    : nextOccurrenceDate(today, schedule.rule);

  if (instantFor(schedule, date).getTime() <= after.getTime()) {
    date = nextOccurrenceDate(date, schedule.rule);
  }

  return { date, instant: instantFor(schedule, date) };
}

/** Следующее списание после уже запланированной даты `current`. */
export function advanceOccurrence(schedule: RecurringSchedule, current: DateOnly): Occurrence {
  const date = nextOccurrenceDate(current, schedule.rule);
  return { date, instant: instantFor(schedule, date) };
}

/** Ближайшие списания, начиная строго после `after`. */
export function upcomingOccurrences(
  schedule: RecurringSchedule,
  after: Date,
  count: number,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  let current = nextOccurrence(schedule, after);
  for (let step = 0; step < count; step += 1) {
    occurrences.push(current);
    current = advanceOccurrence(schedule, current.date);
  }
  return occurrences;
}

/* ----- Валидация правила ----- */

/** Проверяет правило и возвращает текст ошибки либо null. */
export function ruleError(rule: RecurrenceRule): string | null {
  if (rule.frequency === 'weekly') {
    if (rule.day < WEEKDAY_MIN || rule.day > WEEKDAY_MAX) {
      return 'Для еженедельного платежа день недели — от 1 (Пн) до 7 (Вс)';
    }
    return null;
  }
  if (rule.day < DAY_OF_MONTH_MIN || rule.day > DAY_OF_MONTH_MAX) {
    return 'День месяца — от 1 до 31';
  }
  if (rule.frequency === 'yearly') {
    if (rule.month === undefined) return 'Для ежегодного платежа нужен месяц';
    if (rule.month < MONTH_MIN || rule.month > MONTH_MAX) return 'Месяц — от 1 до 12';
  }
  return null;
}

/* ----- Схемы API ----- */

const amountSchema = z.number().finite().positive().max(1_000_000_000);

const nameSchema = z.string().trim().min(1, { message: 'Введите название' }).max(120);
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Время в формате HH:MM' });
const daySchema = z.number().int().min(DAY_OF_MONTH_MIN).max(DAY_OF_MONTH_MAX);
const monthSchema = z.number().int().min(MONTH_MIN).max(MONTH_MAX);
const timezoneSchema = z.string().trim().min(1).max(64);

function refineRule(
  value: { frequency?: RecurrenceFrequency; day?: number; month?: number },
  ctx: z.RefinementCtx,
): void {
  if (value.frequency === undefined || value.day === undefined) return;
  const error = ruleError({
    frequency: value.frequency,
    day: value.day,
    month: value.month,
  });
  if (error)
    ctx.addIssue({
      code: 'custom',
      path: [value.frequency === 'yearly' ? 'month' : 'day'],
      message: error,
    });
}

export const RecurringPaymentCreateSchema = z
  .object({
    name: nameSchema,
    amount: amountSchema,
    type: RecurringPaymentTypeSchema.default('expense'),
    accountId: z.string().min(1),
    categoryId: z.string().min(1).optional(),
    frequency: RecurrenceFrequencySchema,
    day: daySchema,
    month: monthSchema.optional(),
    timeOfDay: timeOfDaySchema.default(DEFAULT_RECURRING_TIME),
    timezone: timezoneSchema.optional(),
    active: z.boolean().default(true),
  })
  .superRefine(refineRule);
export type RecurringPaymentCreateInput = z.infer<typeof RecurringPaymentCreateSchema>;
export type RecurringPaymentCreateValues = z.input<typeof RecurringPaymentCreateSchema>;

/** Правка платежа: любое подмножество полей (пауза/возобновление — active). */
export const RecurringPaymentUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    amount: amountSchema.optional(),
    type: RecurringPaymentTypeSchema.optional(),
    accountId: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    frequency: RecurrenceFrequencySchema.optional(),
    day: daySchema.optional(),
    month: monthSchema.optional(),
    timeOfDay: timeOfDaySchema.optional(),
    timezone: timezoneSchema.optional(),
    active: z.boolean().optional(),
  })
  .superRefine(refineRule);
export type RecurringPaymentUpdateInput = z.infer<typeof RecurringPaymentUpdateSchema>;

export const RecurringPaymentActiveSchema = z.object({
  active: z.boolean(),
});
export type RecurringPaymentActiveInput = z.infer<typeof RecurringPaymentActiveSchema>;

/* ----- Контракты ответов API ----- */

export interface RecurringPaymentDto {
  id: string;
  name: string;
  amount: number;
  type: RecurringPaymentType;
  currency: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  frequency: RecurrenceFrequency;
  day: number;
  month: number | null;
  timeOfDay: string;
  timezone: string;
  nextRunAt: string;
  active: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

export interface RecurringPaymentListResponse {
  payments: RecurringPaymentDto[];
}

export interface RecurringUpcomingItem {
  paymentId: string;
  name: string;
  amount: number;
  currency: string;
  type: RecurringPaymentType;
  date: string;
  amountLabel: string;
}

export interface RecurringUpcomingResponse {
  upcoming: RecurringUpcomingItem[];
}
