// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Цели накоплений (ТЗ §3.2, §5 сценарий 2): схемы, типы и чистые функции.
 * Прогресс в процентах, нужный взнос в месяц, прогноз даты достижения по
 * фактическому темпу и вехи 25/50/75/100%. Общие для API и web.
 * Суммы — числа в API, Decimal(14,2) в БД; картинка — эмодзи-пресет или URL
 * (загрузка файлов не поддерживается).
 */
import { z } from 'zod';
import { ProfileVisibilitySchema, type ProfileVisibility } from './auth';

/** Приватность цели (ТЗ §3.7, §7): от неё зависит показ карточки в профиле. */
export const GoalVisibilitySchema = ProfileVisibilitySchema;
export type GoalVisibility = ProfileVisibility;

/** Вехи прогресса цели (ТЗ сценарий 2: на 50% выдаётся достижение). */
export const GOAL_MILESTONES = [25, 50, 75, 100] as const;
export type GoalMilestone = (typeof GOAL_MILESTONES)[number];

/** Готовые эмодзи-пресеты для цели — без загрузки файлов (ТЗ §3.2). */
export const GOAL_EMOJI_PRESETS = ['🎯', '💻', '✈️', '🚗', '🏠', '🎁', '📱', '🎓', '💍', '🏖️'] as const;

/** Ссылка на картинку цели: только http(s), файлы не загружаются. */
export function isGoalImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Картинка цели: эмодзи-пресет (короткий текст) или ссылка http(s). */
export const GoalImageSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => value.length === 0 || isGoalImageUrl(value) || Array.from(value).length <= 8, {
    message: 'Картинка: эмодзи или ссылка http(s)',
  });

/** Сумма цели: положительная, до 1 млрд. */
const amountSchema = z.number().finite().positive().max(1_000_000_000);
const nonNegativeSchema = z.number().finite().min(0).max(1_000_000_000);

/** Дата цели: YYYY-MM-DD или ISO-строка. */
const dateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Некорректная дата' });

export const GoalCreateSchema = z.object({
  title: z.string().trim().min(1, { message: 'Введите название' }).max(80),
  targetAmount: amountSchema,
  savedAmount: nonNegativeSchema.default(0),
  deadline: dateSchema.optional(),
  image: GoalImageSchema.optional(),
  visibility: GoalVisibilitySchema.default('private'),
  accountId: z.string().min(1).optional(),
});
export type GoalCreateInput = z.infer<typeof GoalCreateSchema>;
export type GoalCreateValues = z.input<typeof GoalCreateSchema>;

export const GoalUpdateSchema = z.object({
  title: z.string().trim().min(1, { message: 'Введите название' }).max(80).optional(),
  targetAmount: amountSchema.optional(),
  savedAmount: nonNegativeSchema.optional(),
  deadline: dateSchema.nullable().optional(),
  image: GoalImageSchema.nullable().optional(),
  visibility: GoalVisibilitySchema.optional(),
  accountId: z.string().min(1).nullable().optional(),
});
export type GoalUpdateInput = z.infer<typeof GoalUpdateSchema>;

export const GoalDepositSchema = z.object({
  amount: amountSchema,
  accountId: z.string().min(1).optional(),
  date: dateSchema.optional(),
});
export type GoalDepositInput = z.infer<typeof GoalDepositSchema>;

/* ----- Чистые функции расчётов (ТЗ §3.2) ----- */

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.4375;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  return value instanceof Date ? value : new Date(value);
}

/** Прогресс в процентах: 0..100, не делит на ноль и не превышает 100. */
export function goalProgress(savedAmount: number, targetAmount: number): number {
  if (!Number.isFinite(savedAmount) || !Number.isFinite(targetAmount) || targetAmount <= 0) return 0;
  const percent = Math.round((savedAmount / targetAmount) * 100);
  return Math.min(100, Math.max(0, percent));
}

/** Достигнутые вехи 25/50/75/100% для текущего прогресса. */
export function reachedMilestones(percent: number): GoalMilestone[] {
  return GOAL_MILESTONES.filter((milestone) => percent >= milestone);
}

/** Вехи, пересечённые ростом прогресса (для события milestone в ответе API). */
export function crossedMilestones(previousPercent: number, nextPercent: number): GoalMilestone[] {
  return GOAL_MILESTONES.filter(
    (milestone) => previousPercent < milestone && nextPercent >= milestone,
  );
}

/** Целых (или частичных) месяцев до срока; 0 — срок уже наступил. */
function monthsUntil(from: Date, deadline: Date): number {
  if (deadline.getTime() <= from.getTime()) return 0;
  const months =
    (deadline.getUTCFullYear() * 12 + deadline.getUTCMonth()) -
    (from.getUTCFullYear() * 12 + from.getUTCMonth());
  const dayOverflow = deadline.getUTCDate() > from.getUTCDate() ? 1 : 0;
  return Math.max(1, months + dayOverflow);
}

/**
 * Нужный взнос в месяц, чтобы успеть к сроку (сценарий 2:
 * «120 000 ₽ к 1 марта → 24 000 ₽/мес»).
 * @returns сумму в месяц, 0 если цель уже достигнута, null если срока нет.
 */
export function requiredMonthlyContribution(
  targetAmount: number,
  savedAmount: number,
  deadline: Date | string | null | undefined,
  from: Date = new Date(),
): number | null {
  const remaining = Math.max(0, targetAmount - Math.max(0, savedAmount));
  if (remaining <= 0) return 0;

  const due = asDate(deadline);
  if (!due) return null;

  const months = monthsUntil(from, due);
  if (months <= 0) return round2(remaining);
  return round2(remaining / months);
}

/** Среднемесячный темп накоплений по фактическим пополнениям. */
export function goalPacePerMonth(
  deposits: ReadonlyArray<{ amount: number; date: Date | string }>,
  from: Date = new Date(),
): number {
  const valid = deposits.filter((deposit) => Number.isFinite(deposit.amount) && deposit.amount > 0);
  if (valid.length === 0) return 0;

  const total = valid.reduce((sum, deposit) => sum + deposit.amount, 0);
  const earliest = valid
    .map((deposit) => asDate(deposit.date))
    .filter((date): date is Date => date !== null)
    .reduce((min, date) => (date.getTime() < min.getTime() ? date : min), from);

  const days = Math.max(0, (from.getTime() - earliest.getTime()) / DAY_MS);
  const months = Math.max(1, days / MONTH_DAYS);
  return round2(total / months);
}

/**
 * Прогноз даты достижения по фактическому темпу (ТЗ §3.2).
 * @returns дату, текущую дату если цель достигнута, null если темпа нет.
 */
export function forecastGoalDate(
  savedAmount: number,
  targetAmount: number,
  pacePerMonth: number,
  from: Date = new Date(),
): Date | null {
  const remaining = Math.max(0, targetAmount - Math.max(0, savedAmount));
  const start = new Date(from.getTime());
  if (remaining <= 0) return start;
  if (!Number.isFinite(pacePerMonth) || pacePerMonth <= 0) return null;

  const months = Math.ceil(remaining / pacePerMonth);
  start.setUTCMonth(start.getUTCMonth() + months);
  return start;
}

/* ----- Контракты ответов API (общие для web и api) ----- */

/** Событие вехи (ТЗ сценарий 2): какие пороги достигнуты и общий прогресс. */
export interface GoalMilestoneEvent {
  percent: number;
  reached: GoalMilestone[];
}

export interface GoalDto {
  id: string;
  title: string;
  targetAmount: number;
  savedAmount: number;
  remaining: number;
  percent: number;
  deadline: string | null;
  image: string | null;
  visibility: GoalVisibility;
  accountId: string | null;
  currency: string;
  /** Нужный взнос в месяц до срока (null — срока нет). */
  requiredMonthly: number | null;
  /** Прогноз даты достижения по фактическому темпу (null — темпа нет). */
  forecastDate: string | null;
  /** Достигнутые вехи: 25/50/75/100%. */
  milestones: GoalMilestone[];
  createdAt: string;
}

export interface GoalDepositDto {
  id: string;
  amount: number;
  date: string;
  accountId: string | null;
  createdAt: string;
}

export interface GoalDepositResult {
  goal: GoalDto;
  deposit: GoalDepositDto;
  /** Событие milestone: вехи, пересечённые этим пополнением. */
  milestone: GoalMilestoneEvent;
}

export interface GoalsListResponse {
  goals: GoalDto[];
}

/* ----- Публичный виджет цели (ТЗ §4, P3) ----- */

/**
 * Виджет прогресса цели для блога или портфолио. Публичный и анонимный:
 * суммы по умолчанию скрыты, показываются только проценты и вехи.
 */
export interface GoalWidgetDto {
  id: string;
  title: string;
  percent: number;
  image: string | null;
  milestones: GoalMilestone[];
  deadline: string | null;
  /** Никнейм владельца — подпись виджета. */
  nickname: string;
}

export interface GoalWidgetResponse {
  widget: GoalWidgetDto;
}
