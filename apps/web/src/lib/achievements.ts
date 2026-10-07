// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистые помощники экрана достижений (ТЗ v2 §4): группировка по группам каталога,
 * полные статусы по умолчанию, прогресс до следующего порога и определение
 * только что полученных наград для конфетти.
 */
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_LEVELS,
  type AchievementCode,
  type AchievementDefinition,
  type AchievementGroup,
  type AchievementLevel,
  type AchievementStatusDto,
  type StreakDto,
} from '@puls/shared';

/** Порядок показа групп: чек-ины → финансы → активность → особые. */
export const ACHIEVEMENT_GROUP_ORDER: readonly AchievementGroup[] = [
  'checkin',
  'finance',
  'activity',
  'special',
];

/** Уровни по возрастанию порога: бронза → серебро → золото. */
export const ACHIEVEMENT_LEVEL_ORDER: readonly AchievementLevel[] = ACHIEVEMENT_LEVELS;

export interface AchievementGroupView {
  group: AchievementGroup;
  items: AchievementStatusDto[];
}

/**
 * Полный статус по умолчанию из записи каталога — для достижений, которые API не
 * вернул. Экран ожидает все поля DTO (иконка, редкость, скрытость, уровни).
 */
export function defaultAchievementStatus(definition: AchievementDefinition): AchievementStatusDto {
  const first = definition.tiers[0] ?? null;
  return {
    code: definition.code,
    group: definition.group,
    icon: definition.icon,
    rarity: definition.rarity,
    hidden: definition.hidden,
    earned: false,
    earnedAt: null,
    level: null,
    value: 0,
    nextThreshold: first ? first.threshold : null,
    progress: 0,
    tiers: definition.tiers.map((tier) => ({
      level: tier.level,
      threshold: tier.threshold,
      earnedAt: null,
    })),
  };
}

/** Дополняет отсутствующие статусы и группирует достижения в порядке каталога. */
export function groupAchievements(
  statuses: readonly AchievementStatusDto[],
): AchievementGroupView[] {
  const byCode = new Map(statuses.map((status) => [status.code, status]));

  return ACHIEVEMENT_GROUP_ORDER.map((group) => ({
    group,
    items: ACHIEVEMENT_CATALOG.filter((definition) => definition.group === group).map(
      (definition) => byCode.get(definition.code) ?? defaultAchievementStatus(definition),
    ),
  })).filter((view) => view.items.length > 0);
}

/** Ключ i18n-подписи уровня («бронза», «серебро», «золото»). */
export function levelLabelKey(level: AchievementLevel): string {
  return `achievements.level.${level}`;
}

/**
 * Порог для подстановки {n} в описание: следующий непройденный уровень, иначе
 * порог высшего полученного, иначе порог последнего (золотого) уровня.
 */
export function descriptionThreshold(item: AchievementStatusDto): number {
  if (item.nextThreshold !== null) return item.nextThreshold;
  const earned = item.tiers.filter((tier) => tier.earnedAt !== null);
  const highest = earned[earned.length - 1];
  if (highest) return highest.threshold;
  return item.tiers[item.tiers.length - 1]?.threshold ?? 0;
}

/** Прогресс до ближайшего порога стрика: 0..1; без порога — 1. */
export function streakProgress(streak: StreakDto): number {
  if (!streak.nextMilestone) return 1;
  const value = Math.max(streak.current, streak.longest);
  return Math.min(1, value / streak.nextMilestone.threshold);
}

/** Окно, в течение которого достижение считается «только что полученным». */
export const CELEBRATION_WINDOW_MS = 15_000;

/** Допуск на расхождение часов клиента и сервера, мс. */
const CLOCK_SKEW_MS = 5_000;

/** Коды достижений, полученных совсем недавно — для анимации конфетти. */
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
