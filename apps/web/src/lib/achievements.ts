// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистые помощники экрана достижений (ТЗ §4): группировка бейджей, прогресс до
 * ближайшей награды и определение только что полученных бейджей для конфетти.
 */
import {
  ACHIEVEMENTS,
  type AchievementCode,
  type AchievementGroup,
  type AchievementStatusDto,
  type StreakDto,
} from '@puls/shared';

export const ACHIEVEMENT_GROUP_ORDER: readonly AchievementGroup[] = ['checkins', 'finance', 'goals'];

export interface AchievementGroupView {
  group: AchievementGroup;
  items: AchievementStatusDto[];
}

/** Дополняет отсутствующие статусы и группирует бейджи в порядке каталога. */
export function groupAchievements(statuses: readonly AchievementStatusDto[]): AchievementGroupView[] {
  const byCode = new Map(statuses.map((status) => [status.code, status]));

  return ACHIEVEMENT_GROUP_ORDER.map((group) => ({
    group,
    items: ACHIEVEMENTS.filter((definition) => definition.group === group).map(
      (definition) =>
        byCode.get(definition.code) ?? {
          code: definition.code,
          earned: false,
          earnedAt: null,
          progress: 0,
        },
    ),
  })).filter((view) => view.items.length > 0);
}

/** Прогресс до ближайшего порога стрика: 0..1; без порога — 1. */
export function streakProgress(streak: StreakDto): number {
  if (!streak.nextMilestone) return 1;
  const value = Math.max(streak.current, streak.longest);
  return Math.min(1, value / streak.nextMilestone.threshold);
}

/** Окно, в течение которого бейдж считается «только что полученным». */
export const CELEBRATION_WINDOW_MS = 15_000;

/** Допуск на расхождение часов клиента и сервера, мс. */
const CLOCK_SKEW_MS = 5_000;

/** Коды бейджей, полученных совсем недавно — для анимации конфетти. */
export function recentlyEarnedCodes(
  statuses: readonly AchievementStatusDto[],
  now: number,
  windowMs: number = CELEBRATION_WINDOW_MS,
): AchievementCode[] {
  return statuses
    .filter((status) => {
      if (!status.earned || !status.earnedAt) return false;
      const elapsed = now - Date.parse(status.earnedAt);
      return elapsed >= -CLOCK_SKEW_MS && elapsed <= windowMs;
    })
    .map((status) => status.code);
}
