// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Трекер привычек (ТЗ §4, P2): вода, спорт, чтение — с отметками в чек-ине.
 * Схемы, типы и чистые функции серии дней и процента выполнения. Общие для
 * API и web. Отметки хранятся по одному дню на (habit, date), поэтому запись
 * идемпотентна: повторная отметка за ту же дату не создаёт дубликат.
 */
import { z } from 'zod';
import { dayBoundsInTimeZone } from './checkin';

/** Готовые иконки-эмодзи для привычки (без загрузки файлов, ТЗ §4). */
export const HABIT_ICON_PRESETS = [
  '💧',
  '🏃',
  '📚',
  '🧘',
  '🥗',
  '😴',
  '🚶',
  '☀️',
  '🎯',
  '🦷',
] as const;

/** Частота привычки: каждый день или несколько раз в неделю (ТЗ §4). */
export const HABIT_CADENCES = ['daily', 'weekly'] as const;
export const HabitCadenceSchema = z.enum(HABIT_CADENCES);
export type HabitCadence = z.infer<typeof HabitCadenceSchema>;

/** Цель в неделю для weekly: 1–7 раз; у daily цель — каждый день. */
export const HABIT_PER_WEEK_MIN = 1;
export const HABIT_PER_WEEK_MAX = 7;

/** Горизонты процента выполнения (ТЗ §4: 7 и 30 дней). */
export const HABIT_RATE_WINDOWS = [7, 30] as const;

/** Дата отметки: YYYY-MM-DD или ISO-строка. */
const dateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Некорректная дата' });

export const HabitCreateSchema = z.object({
  name: z.string().trim().min(1, { message: 'Введите название' }).max(60),
  icon: z.string().trim().min(1).max(8).default(HABIT_ICON_PRESETS[0]),
  cadence: HabitCadenceSchema.default('daily'),
  perWeek: z.number().int().min(HABIT_PER_WEEK_MIN).max(HABIT_PER_WEEK_MAX).default(1),
});
export type HabitCreateInput = z.infer<typeof HabitCreateSchema>;
export type HabitCreateValues = z.input<typeof HabitCreateSchema>;

export const HabitUpdateSchema = z.object({
  name: z.string().trim().min(1, { message: 'Введите название' }).max(60).optional(),
  icon: z.string().trim().min(1).max(8).optional(),
  cadence: HabitCadenceSchema.optional(),
  perWeek: z.number().int().min(HABIT_PER_WEEK_MIN).max(HABIT_PER_WEEK_MAX).optional(),
  archived: z.boolean().optional(),
});
export type HabitUpdateInput = z.infer<typeof HabitUpdateSchema>;

/** Отметка привычки за дату: по умолчанию сегодня; done=false снимает отметку. */
export const HabitLogSchema = z.object({
  date: dateSchema.optional(),
  done: z.boolean().default(true),
});
export type HabitLogInput = z.infer<typeof HabitLogSchema>;
export type HabitLogValues = z.input<typeof HabitLogSchema>;

/* ----- Чистые функции серии и процента (ТЗ §4) ----- */

const DAY_MS = 86_400_000;

function dayKeyFromUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Календарный день YYYY-MM-DD в часовом поясе пользователя. */
export function habitDayKey(date: Date, timeZone: string): string {
  return dayBoundsInTimeZone(date, timeZone).dayKey;
}

/** Сдвиг ключа дня на delta суток (ключ остаётся календарным). */
export function shiftDayKey(dayKey: string, delta: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  return dayKeyFromUtcDate(new Date(Date.UTC(year, month - 1, day) + delta * DAY_MS));
}

/** UTC-полночь календарного дня — формат колонки `@db.Date`. */
export function habitDayToDate(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Ключ дня из колонки `@db.Date` (хранится как UTC-полночь локального дня). */
export function habitDateToDayKey(date: Date): string {
  return dayKeyFromUtcDate(date);
}

/**
 * Серия дней подряд с отметкой. Если сегодня ещё не отмечено — серия не
 * считается прерванной до конца дня: отсчёт идёт от вчера.
 */
export function habitStreak(doneDayKeys: readonly string[], todayKey: string): number {
  const done = new Set(doneDayKeys);
  let cursor = todayKey;
  if (!done.has(cursor)) {
    cursor = shiftDayKey(cursor, -1);
    if (!done.has(cursor)) return 0;
  }
  let streak = 0;
  while (done.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
}

/** Ожидаемое число отметок за окно: у daily — каждый день, у weekly — доля недели. */
export function habitExpectedCompletions(
  cadence: HabitCadence,
  perWeek: number,
  windowDays: number,
): number {
  if (windowDays <= 0) return 0;
  if (cadence === 'daily') return windowDays;
  return Math.max(1, Math.ceil(perWeek * (windowDays / 7)));
}

/** Процент выполнения за последние windowDays дней, 0..100. */
export function habitCompletionRate(
  doneDayKeys: readonly string[],
  todayKey: string,
  windowDays: number,
  cadence: HabitCadence,
  perWeek: number,
): number {
  const expected = habitExpectedCompletions(cadence, perWeek, windowDays);
  if (expected <= 0) return 0;

  const done = new Set(doneDayKeys);
  let count = 0;
  for (let offset = 0; offset < windowDays; offset += 1) {
    if (done.has(shiftDayKey(todayKey, -offset))) count += 1;
  }
  return Math.min(100, Math.round((count / expected) * 100));
}

/* ----- Контракты ответов API (общие для web и api) ----- */

export interface HabitDto {
  id: string;
  name: string;
  icon: string;
  cadence: HabitCadence;
  perWeek: number;
  archived: boolean;
  createdAt: string;
}

export interface HabitStatsDto {
  /** Серия дней подряд с отметкой. */
  streak: number;
  /** Процент за последние 7 дней, 0..100. */
  rate7: number;
  /** Процент за последние 30 дней, 0..100. */
  rate30: number;
  /** Всего отметок (все дни). */
  totalDone: number;
}

export interface HabitLogDto {
  id: string;
  habitId: string;
  /** Календарный день отметки в формате YYYY-MM-DD. */
  date: string;
  done: boolean;
  createdAt: string;
}

/** Привычка в контексте дня: отмечена ли сегодня + серия и проценты. */
export interface HabitTodayItemDto extends HabitDto, HabitStatsDto {
  done: boolean;
}

export interface HabitTodayResponse {
  dayKey: string;
  habits: HabitTodayItemDto[];
}

export interface HabitStatsItemDto extends HabitDto, HabitStatsDto {}

export interface HabitStatsResponse {
  dayKey: string;
  habits: HabitStatsItemDto[];
}

export interface HabitStatsListResponse {
  habits: HabitDto[];
}

/** Результат отметки: привычка, сама отметка (null при снятии) и свежая статика. */
export interface HabitLogResult {
  habit: HabitDto;
  log: HabitLogDto | null;
  done: boolean;
  stats: HabitStatsDto;
}

/** Собирает статистику привычки из календарных дней с отметкой. */
export function habitStatsFromDayKeys(
  doneDayKeys: readonly string[],
  todayKey: string,
  cadence: HabitCadence,
  perWeek: number,
): HabitStatsDto {
  const [rate7, rate30] = HABIT_RATE_WINDOWS.map((windowDays) =>
    habitCompletionRate(doneDayKeys, todayKey, windowDays, cadence, perWeek),
  );
  return {
    streak: habitStreak(doneDayKeys, todayKey),
    rate7,
    rate30,
    totalDone: new Set(doneDayKeys).size,
  };
}
