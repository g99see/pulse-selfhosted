// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Капсула времени (ТЗ §4, P2): письмо себе, которое открывается через месяц
 * или год. Здесь только чистые функции и контракты — пресеты дат открытия,
 * проверка доступности капсулы и сборка снимка статистики за период
 * [created_at, open_at]. Тело письма шифруется отдельно (SecretBox) и в этот
 * модуль не попадает.
 */
import { z } from 'zod';
import { goalProgress } from './goals';
import { isMood, moodAverage } from './mood';
import { roundMoney, sumEarned, sumSpent, type StatTransaction } from './stats';

/* ----- Пресеты и границы даты открытия ----- */

export const CAPSULE_PRESETS = ['month', 'year'] as const;
export type CapsulePreset = (typeof CAPSULE_PRESETS)[number];
export const CapsulePresetSchema = z.enum(CAPSULE_PRESETS);

/** Минимальный срок: капсулу нельзя открыть раньше, чем через сутки. */
export const CAPSULE_MIN_OPEN_MS = 24 * 60 * 60 * 1000;
/** Максимальный срок: не позднее десяти лет (ТЗ §4). */
export const CAPSULE_MAX_OPEN_YEARS = 10;

export const CAPSULE_TITLE_MAX_LENGTH = 120;
export const CAPSULE_BODY_MAX_LENGTH = 20_000;

/** Прибавляет месяцы по календарю, зажимая день (31 января + 1 месяц → 28/29 февраля). */
export function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTarget = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, daysInTarget));
  return result;
}

/** Прибавляет годы по календарю (29 февраля + год → 28 февраля). */
export function addYearsClamped(date: Date, years: number): Date {
  return addMonthsClamped(date, years * 12);
}

/** Дата открытия для пресета «через месяц» / «через год» от момента создания. */
export function capsulePresetOpenAt(preset: CapsulePreset, createdAt: Date): Date {
  return preset === 'month' ? addMonthsClamped(createdAt, 1) : addYearsClamped(createdAt, 1);
}

/** Допустимые границы даты открытия для капсулы, созданной в `createdAt`. */
export function capsuleOpenBounds(createdAt: Date): { min: Date; max: Date } {
  return {
    min: new Date(createdAt.getTime() + CAPSULE_MIN_OPEN_MS),
    max: addYearsClamped(createdAt, CAPSULE_MAX_OPEN_YEARS),
  };
}

export type CapsuleOpenAtError = 'too_soon' | 'too_far';

/** Проверяет срок открытия; null — срок корректен (ТЗ §4). */
export function capsuleOpenAtError(openAt: Date, createdAt: Date): CapsuleOpenAtError | null {
  const { min, max } = capsuleOpenBounds(createdAt);
  if (openAt.getTime() < min.getTime()) return 'too_soon';
  if (openAt.getTime() > max.getTime()) return 'too_far';
  return null;
}

/** Наступил ли момент открытия: капсула открыта, когда now >= open_at. */
export function isCapsuleOpen(openAt: Date, now: Date): boolean {
  return now.getTime() >= openAt.getTime();
}

/** Сколько миллисекунд осталось до открытия; 0 — уже открыта. */
export function capsuleRemainingMs(openAt: Date, now: Date): number {
  return Math.max(0, openAt.getTime() - now.getTime());
}

/* ----- Снимок статистики за период [created_at, open_at] ----- */

export interface CapsuleGoalSnapshot {
  title: string;
  targetAmount: number;
  savedAmount: number;
  percent: number;
}

export interface CapsuleSnapshot {
  /** Начало периода — момент создания капсулы (ISO). */
  from: string;
  /** Конец периода — момент открытия (ISO). */
  to: string;
  spent: number;
  earned: number;
  net: number;
  avgMood: number | null;
  checkins: number;
  goals: CapsuleGoalSnapshot[];
}

export interface CapsuleSnapshotGoalInput {
  title: string;
  targetAmount: number;
  savedAmount: number;
}

export interface CapsuleSnapshotInput {
  from: string;
  to: string;
  transactions: readonly StatTransaction[];
  moods: readonly number[];
  goals: readonly CapsuleSnapshotGoalInput[];
}

/**
 * Собирает снимок статистики капсулы из «сырых» строк: суммы трат и доходов,
 * среднее настроение, число чек-инов и состояние целей на момент открытия.
 * Без обращений к БД и сети — пригодно для unit-тестов.
 */
export function buildCapsuleSnapshot(input: CapsuleSnapshotInput): CapsuleSnapshot {
  const spent = sumSpent(input.transactions);
  const earned = sumEarned(input.transactions);

  return {
    from: input.from,
    to: input.to,
    spent,
    earned,
    net: roundMoney(earned - spent),
    avgMood: moodAverage(input.moods),
    checkins: input.moods.filter(isMood).length,
    goals: input.goals.map((goal) => ({
      title: goal.title,
      targetAmount: roundMoney(goal.targetAmount),
      savedAmount: roundMoney(goal.savedAmount),
      percent: goalProgress(goal.savedAmount, goal.targetAmount),
    })),
  };
}

/* ----- Контракты API ----- */

export const CapsuleCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(CAPSULE_TITLE_MAX_LENGTH),
    body: z.string().min(1).max(CAPSULE_BODY_MAX_LENGTH),
    /** Точная дата открытия (ISO с offset); взаимоисключающа с preset. */
    openAt: z.string().datetime({ offset: true }).optional(),
    /** Пресет «через месяц» / «через год»; взаимоисключающ с openAt. */
    preset: CapsulePresetSchema.optional(),
  })
  .refine((value) => Boolean(value.openAt) !== Boolean(value.preset), {
    message: 'Укажите либо preset, либо openAt',
  });
export type CapsuleCreateInput = z.infer<typeof CapsuleCreateSchema>;

/** Метаданные капсулы: тело и статистика сюда не входят, пока она закрыта. */
export interface CapsuleSummaryDto {
  id: string;
  title: string;
  createdAt: string;
  openAt: string;
  openedAt: string | null;
  /** Открыта ли капсула на момент ответа. */
  open: boolean;
}

/** Полная капсула: тело письма и снимок статистики есть только после открытия. */
export interface CapsuleDetailDto extends CapsuleSummaryDto {
  body: string | null;
  snapshot: CapsuleSnapshot | null;
}

export interface CapsulesListResponse {
  capsules: CapsuleSummaryDto[];
}
