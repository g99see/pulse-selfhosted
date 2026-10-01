// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Достижения и стрики чек-инов (ТЗ §2, §4, P1): чистые функции без побочных
 * эффектов — подсчёт стриков по дням в часовом поясе пользователя (пропуск дня
 * сбрасывает, сегодняшний день ещё не засчитан не ломает) и проверка условий
 * бейджей. Используются и API, и web.
 */
import { addDays, dayKeyInTimezone, todayKeyInTimezone } from './stats';

/* ----- Каталог бейджей (ТЗ §4) ----- */

export const ACHIEVEMENT_CODES = [
  'first_checkin',
  'checkin_streak_7',
  'checkin_streak_30',
  'checkin_streak_100',
  'first_transaction',
  'first_budget_closed',
  'first_goal',
  'goal_half',
  'goal_complete',
] as const;

export type AchievementCode = (typeof ACHIEVEMENT_CODES)[number];

/** Пороги стриков чек-инов (дней) — 7/30/100. */
export const STREAK_THRESHOLDS = [7, 30, 100] as const;

/** Группа бейджа: для группировки в сетке достижений. */
export type AchievementGroup = 'checkins' | 'finance' | 'goals';

/** Статическое описание бейджа: ключи перевода, группа и порядок показа. */
export interface AchievementDefinition {
  code: AchievementCode;
  titleKey: string;
  descriptionKey: string;
  group: AchievementGroup;
  position: number;
  /** Порог (дней/процентов) для прогресса, если применимо. */
  threshold?: number;
}

/** Каталог бейджей в порядке отображения (ТЗ §4). */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    code: 'first_checkin',
    titleKey: 'achievements.first_checkin.title',
    descriptionKey: 'achievements.first_checkin.description',
    group: 'checkins',
    position: 1,
  },
  {
    code: 'checkin_streak_7',
    titleKey: 'achievements.streak_7.title',
    descriptionKey: 'achievements.streak_7.description',
    group: 'checkins',
    position: 2,
    threshold: 7,
  },
  {
    code: 'checkin_streak_30',
    titleKey: 'achievements.streak_30.title',
    descriptionKey: 'achievements.streak_30.description',
    group: 'checkins',
    position: 3,
    threshold: 30,
  },
  {
    code: 'checkin_streak_100',
    titleKey: 'achievements.streak_100.title',
    descriptionKey: 'achievements.streak_100.description',
    group: 'checkins',
    position: 4,
    threshold: 100,
  },
  {
    code: 'first_transaction',
    titleKey: 'achievements.first_transaction.title',
    descriptionKey: 'achievements.first_transaction.description',
    group: 'finance',
    position: 5,
  },
  {
    code: 'first_budget_closed',
    titleKey: 'achievements.first_budget_closed.title',
    descriptionKey: 'achievements.first_budget_closed.description',
    group: 'finance',
    position: 6,
  },
  {
    code: 'first_goal',
    titleKey: 'achievements.first_goal.title',
    descriptionKey: 'achievements.first_goal.description',
    group: 'goals',
    position: 7,
  },
  {
    code: 'goal_half',
    titleKey: 'achievements.goal_half.title',
    descriptionKey: 'achievements.goal_half.description',
    group: 'goals',
    position: 8,
    threshold: 50,
  },
  {
    code: 'goal_complete',
    titleKey: 'achievements.goal_complete.title',
    descriptionKey: 'achievements.goal_complete.description',
    group: 'goals',
    position: 9,
    threshold: 100,
  },
];

/** Описание бейджа по коду. */
export function achievementByCode(code: AchievementCode): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((item) => item.code === code);
}

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

/** Ближайший непройденный порог стрика (для прогресс-бара). */
export function nextStreakMilestone(streak: number): {
  code: AchievementCode;
  threshold: number;
} | null {
  const badges: Array<{ code: AchievementCode; threshold: number }> = [
    { code: 'checkin_streak_7', threshold: 7 },
    { code: 'checkin_streak_30', threshold: 30 },
    { code: 'checkin_streak_100', threshold: 100 },
  ];
  return badges.find((badge) => streak < badge.threshold) ?? null;
}

/* ----- Условия бейджей (ТЗ §4) ----- */

/** Контекст, по которому проверяются условия бейджей. */
export interface AchievementContext {
  checkinsCount: number;
  transactionsCount: number;
  /** Текущий стрик чек-инов, дней. */
  currentStreak: number;
  /** Самый длинный стрик чек-инов, дней. */
  longestStreak: number;
  /** Число прошедших месяцев с бюджетом и без превышения. */
  closedBudgetsCount: number;
}

/**
 * Возвращает коды бейджей, условия которых выполнены. Бейджи за цели
 * (`first_goal`, `goal_half`, `goal_complete`) вручаются модулем целей через
 * AchievementsService.award — здесь не вычисляются.
 */
export function evaluateAchievements(context: AchievementContext): AchievementCode[] {
  const codes: AchievementCode[] = [];
  const streak = Math.max(context.currentStreak, context.longestStreak);

  if (context.checkinsCount >= 1) codes.push('first_checkin');
  if (streak >= 7) codes.push('checkin_streak_7');
  if (streak >= 30) codes.push('checkin_streak_30');
  if (streak >= 100) codes.push('checkin_streak_100');
  if (context.transactionsCount >= 1) codes.push('first_transaction');
  if (context.closedBudgetsCount >= 1) codes.push('first_budget_closed');

  return codes;
}

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

export interface AchievementStatusDto {
  code: AchievementCode;
  earned: boolean;
  earnedAt: string | null;
  /** Прогресс до следующего порога: 0..1. Для не-пороговых — 1 при получении. */
  progress: number;
}

export interface StreakDto {
  current: number;
  longest: number;
  checkedToday: boolean;
  todayKey: string;
  lastDayKey: string | null;
  nextMilestone: { code: AchievementCode; threshold: number } | null;
}

export interface AchievementsResponse {
  achievements: AchievementStatusDto[];
  streak: StreakDto;
}
