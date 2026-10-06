// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Цель чек-инов: «N чек-инов в неделю» и прогресс по текущей ISO-неделе
 * (понедельник — воскресенье) в часовом поясе пользователя.
 */
import { z } from 'zod';
import { addDays } from './stats';

export const CHECKIN_GOAL_MIN = 1;
export const CHECKIN_GOAL_MAX = 21;

export const CheckinGoalInputSchema = z.object({
  /** Чек-инов в неделю; null снимает цель. */
  perWeek: z.number().int().min(CHECKIN_GOAL_MIN).max(CHECKIN_GOAL_MAX).nullable(),
});
export type CheckinGoalInput = z.infer<typeof CheckinGoalInputSchema>;

export interface CheckinGoalDto {
  perWeek: number | null;
  /** Понедельник текущей недели, YYYY-MM-DD. */
  weekStart: string;
  count: number;
  /** 0..100; null, если цель не задана. */
  percent: number | null;
  reached: boolean;
}

/** Понедельник недели, в которую попадает день YYYY-MM-DD. */
export function weekStartKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return addDays(dayKey, -((weekday + 6) % 7));
}

/** Прогресс цели по числу чек-инов за неделю. */
export function checkinGoalProgress(
  perWeek: number | null,
  count: number,
  weekStart: string,
): CheckinGoalDto {
  if (perWeek === null) {
    return { perWeek: null, weekStart, count, percent: null, reached: false };
  }
  return {
    perWeek,
    weekStart,
    count,
    percent: Math.min(100, Math.round((count / perWeek) * 100)),
    reached: count >= perWeek,
  };
}
