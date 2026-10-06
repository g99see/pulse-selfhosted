// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Стрики чек-инов и контракты API достижений (ТЗ §2, §4): чистые функции без
 * побочных эффектов — подсчёт стриков по дням в часовом поясе пользователя
 * (пропуск дня сбрасывает, сегодняшний день ещё не засчитан не ломает).
 * Сам каталог достижений — в achievement-catalog.ts.
 */
import type {
  AchievementCode,
  AchievementGroup,
  AchievementLevel,
  AchievementRarity,
} from './achievement-catalog';
import { addDays, dayKeyInTimezone, todayKeyInTimezone } from './stats';

/** Пороги стриков чек-инов (дней) для плашки серии — 7/30/100. */
export const STREAK_THRESHOLDS = [7, 30, 100] as const;

/* ----- Стрики чек-инов (ТЗ §4) ----- */

export interface StreakResult {
  /** Текущий стрик в днях. */
  current: number;
  /** Самый длинный стрик за всё время, в днях. */
  longest: number;
  /** Последний день с чек-ином (YYYY-MM-DD) или null. */
  lastDayKey: string | null;
  /** Был ли чек-ин сегодня. */
  checkedToday: boolean;
  /** Сегодняшний день пользователя (YYYY-MM-DD). */
  todayKey: string;
}

/**
 * Стрик по уникальным ключам дней. Пропуск дня сбрасывает серию.
 * Если сегодня чек-ина нет, но вчера был — стрик продолжается: сегодняшний
 * день ещё не засчитан и не должен обнулять серию.
 */
export function computeStreak(dayKeys: readonly string[], todayKey: string): StreakResult {
  const unique = [...new Set(dayKeys.filter((day) => Boolean(day)))].sort();
  const present = new Set(unique);
  const yesterdayKey = addDays(todayKey, -1);

  let anchor: string | null = null;
  if (present.has(todayKey)) anchor = todayKey;
  else if (present.has(yesterdayKey)) anchor = yesterdayKey;

  let current = 0;
  if (anchor) {
    let cursor = anchor;
    while (present.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }

  let longest = current;
  let run = 0;
  let previous: string | null = null;
  for (const day of unique) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }

  return {
    current,
    longest,
    lastDayKey: unique.length > 0 ? unique[unique.length - 1]! : null,
    checkedToday: present.has(todayKey),
    todayKey,
  };
}

/**
 * Стрик по моментам чек-инов: дни определяются в часовом поясе пользователя,
 * поэтому границы суток и переходы на летнее время не разрывают серию.
 */
export function streakFromInstants(
  instants: readonly Date[],
  timezone: string,
  now: Date = new Date(),
): StreakResult {
  const todayKey = todayKeyInTimezone(timezone, now);
  const dayKeys = instants.map((instant) => dayKeyInTimezone(instant, timezone));
  return computeStreak(dayKeys, todayKey);
}

/** Ближайший непройденный порог стрика (для плашки серии). */
export function nextStreakMilestone(streak: number): {
  code: string;
  threshold: number;
} | null {
  const threshold = STREAK_THRESHOLDS.find((value) => streak < value);
  return threshold === undefined ? null : { code: 'checkin_streak', threshold };
}

/* ----- Условия бейджей ----- */

/**
 * «Закрытый месяц без превышения» (ТЗ §4): месяц уже прошёл и суммарные траты
 * не превысили лимит бюджета. Сравнение месяцев — по ключу YYYY-MM.
 */
export function isBudgetMonthClosedWithinLimit(
  limit: number,
  spent: number,
  monthKey: string,
  currentMonthKey: string,
): boolean {
  return monthKey < currentMonthKey && spent <= limit;
}

/* ----- Контракты API ----- */

/** Уровень, полученный пользователем, с датой. */
export interface AchievementTierStatusDto {
  level: AchievementLevel;
  threshold: number;
  earnedAt: string | null;
}

export interface AchievementStatusDto {
  code: AchievementCode;
  group: AchievementGroup;
  icon: string;
  rarity: AchievementRarity;
  hidden: boolean;
  /** Хотя бы один уровень получен. */
  earned: boolean;
  /** Дата получения первого уровня (для конфетти и совместимости). */
  earnedAt: string | null;
  /** Высший полученный уровень. */
  level: AchievementLevel | null;
  /** Текущее значение метрики. */
  value: number;
  /** Порог следующего уровня; null — все уровни получены. */
  nextThreshold: number | null;
  /** Прогресс до следующего порога: 0..1; 1 — все уровни получены. */
  progress: number;
  tiers: AchievementTierStatusDto[];
}

export interface StreakDto {
  current: number;
  longest: number;
  checkedToday: boolean;
  todayKey: string;
  lastDayKey: string | null;
  nextMilestone: { code: string; threshold: number } | null;
}

export interface AchievementsResponse {
  achievements: AchievementStatusDto[];
  streak: StreakDto;
}
