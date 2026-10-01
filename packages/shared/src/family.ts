// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Семейный режим (ТЗ §4): общие счета и цели семьи на одном домашнем сервере,
 * у каждого участника — свой приватный дневник. Здесь только общие сущности
 * семьи; личные Account/Goal/CheckIn/Transaction семья не видит.
 *
 * Схемы (Zod) и типы DTO общие для API и web. Расчёты по семейным целям
 * переиспользуют чистые функции целей (прогресс, взнос, прогноз, вехи).
 */
import { z } from 'zod';
import {
  GoalImageSchema,
  forecastGoalDate,
  goalPacePerMonth,
  goalProgress,
  reachedMilestones,
  requiredMonthlyContribution,
  type GoalMilestone,
} from './goals';

/** Роли участника семьи (ТЗ §4): владелец управляет составом, участник — нет. */
export const FAMILY_ROLES = ['owner', 'member'] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];

/** Типы семейного счёта: как у личных счетов. */
export const FAMILY_ACCOUNT_TYPES = ['card', 'cash', 'savings'] as const;
export type FamilyAccountType = (typeof FAMILY_ACCOUNT_TYPES)[number];

/** Виды операции по семейному счёту (ТЗ §4): доход или расход. */
export const FAMILY_TRANSACTION_KINDS = ['income', 'expense'] as const;
export type FamilyTransactionKind = (typeof FAMILY_TRANSACTION_KINDS)[number];

/** Предел участников одной семьи — защита от абуза общего сервера. */
export const FAMILY_MAX_MEMBERS = 12;

/** Срок жизни кода-приглашения: по умолчанию 7 суток, максимум 30. */
export const FAMILY_INVITE_HOURS_DEFAULT = 168;
export const FAMILY_INVITE_HOURS_MAX = 720;

const amountSchema = z.number().finite().positive().max(1_000_000_000);
const nonNegativeSchema = z.number().finite().min(0).max(1_000_000_000);
const nameSchema = z.string().trim().min(1, { message: 'Введите название' }).max(80);
const currencySchema = z.string().trim().length(3).toUpperCase();

/** Дата операции/взноса: YYYY-MM-DD или ISO-строка. */
const dateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Некорректная дата' });

export const FamilyCreateSchema = z.object({
  name: nameSchema,
});
export type FamilyCreateInput = z.infer<typeof FamilyCreateSchema>;
export type FamilyCreateValues = z.input<typeof FamilyCreateSchema>;

export const FamilyJoinSchema = z.object({
  code: z.string().trim().min(4, { message: 'Введите код' }).max(64),
});
export type FamilyJoinInput = z.infer<typeof FamilyJoinSchema>;

export const FamilyInviteCreateSchema = z.object({
  expiresInHours: z.number().int().min(1).max(FAMILY_INVITE_HOURS_MAX).default(FAMILY_INVITE_HOURS_DEFAULT),
});
export type FamilyInviteCreateInput = z.infer<typeof FamilyInviteCreateSchema>;
export type FamilyInviteCreateValues = z.input<typeof FamilyInviteCreateSchema>;

export const FamilyAccountCreateSchema = z.object({
  name: nameSchema,
  type: z.enum(FAMILY_ACCOUNT_TYPES).default('card'),
  balance: nonNegativeSchema.default(0),
  currency: currencySchema.optional(),
});
export type FamilyAccountCreateInput = z.infer<typeof FamilyAccountCreateSchema>;
export type FamilyAccountCreateValues = z.input<typeof FamilyAccountCreateSchema>;

export const FamilyAccountUpdateSchema = z.object({
  name: nameSchema.optional(),
  type: z.enum(FAMILY_ACCOUNT_TYPES).optional(),
  balance: nonNegativeSchema.optional(),
  currency: currencySchema.optional(),
});
export type FamilyAccountUpdateInput = z.infer<typeof FamilyAccountUpdateSchema>;

export const FamilyTransactionCreateSchema = z.object({
  kind: z.enum(FAMILY_TRANSACTION_KINDS),
  amount: amountSchema,
  note: z.string().trim().max(200).optional(),
  date: dateSchema.optional(),
});
export type FamilyTransactionCreateInput = z.infer<typeof FamilyTransactionCreateSchema>;
export type FamilyTransactionCreateValues = z.input<typeof FamilyTransactionCreateSchema>;

export const FamilyGoalCreateSchema = z.object({
  title: z.string().trim().min(1, { message: 'Введите название' }).max(80),
  targetAmount: amountSchema,
  savedAmount: nonNegativeSchema.default(0),
  deadline: dateSchema.optional(),
  image: GoalImageSchema.optional(),
});
export type FamilyGoalCreateInput = z.infer<typeof FamilyGoalCreateSchema>;
export type FamilyGoalCreateValues = z.input<typeof FamilyGoalCreateSchema>;

export const FamilyGoalUpdateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  targetAmount: amountSchema.optional(),
  deadline: dateSchema.nullable().optional(),
  image: GoalImageSchema.nullable().optional(),
});
export type FamilyGoalUpdateInput = z.infer<typeof FamilyGoalUpdateSchema>;

export const FamilyGoalDepositSchema = z.object({
  amount: amountSchema,
  date: dateSchema.optional(),
});
export type FamilyGoalDepositInput = z.infer<typeof FamilyGoalDepositSchema>;

/* ----- Чистые функции (ТЗ §4) ----- */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Приращение баланса по операции: доход «+», расход «−». */
export function familyBalanceDelta(kind: FamilyTransactionKind, amount: number): number {
  const value = Number.isFinite(amount) ? Math.abs(amount) : 0;
  return kind === 'income' ? round2(value) : round2(-value);
}

/** Новый баланс счёта после операции (не уходит в минус сильнее, чем есть). */
export function applyFamilyTransaction(
  balance: number,
  kind: FamilyTransactionKind,
  amount: number,
): number {
  return round2(balance + familyBalanceDelta(kind, amount));
}

/** Активен ли код-приглашение: не использован и не истёк. */
export function isFamilyInviteActive(
  invite: { expiresAt: Date | string; usedAt: Date | string | null | undefined },
  now: Date = new Date(),
): boolean {
  if (invite.usedAt) return false;
  const expires = invite.expiresAt instanceof Date ? invite.expiresAt : new Date(invite.expiresAt);
  return expires.getTime() > now.getTime();
}

/** Сводка по семейной цели — переиспользует расчёты личных целей (ТЗ §4). */
export interface FamilyGoalSummary {
  remaining: number;
  percent: number;
  requiredMonthly: number | null;
  forecastDate: string | null;
  milestones: GoalMilestone[];
}

export function familyGoalSummary(
  savedAmount: number,
  targetAmount: number,
  deadline: Date | string | null | undefined,
  deposits: ReadonlyArray<{ amount: number; date: Date | string }>,
  from: Date = new Date(),
): FamilyGoalSummary {
  const percent = goalProgress(savedAmount, targetAmount);
  const pace = goalPacePerMonth(deposits, from);
  const forecast = forecastGoalDate(savedAmount, targetAmount, pace, from);
  return {
    remaining: round2(Math.max(0, targetAmount - Math.max(0, savedAmount))),
    percent,
    requiredMonthly: requiredMonthlyContribution(targetAmount, savedAmount, deadline, from),
    forecastDate: forecast ? forecast.toISOString() : null,
    milestones: reachedMilestones(percent),
  };
}

/* ----- DTO ответов API (общие для web и api) ----- */

export interface FamilyMemberDto {
  userId: string;
  nickname: string;
  role: FamilyRole;
  joinedAt: string;
}

export interface FamilyDto {
  id: string;
  name: string;
  ownerId: string;
  /** Роль текущего пользователя в этой семье. */
  role: FamilyRole;
  members: FamilyMemberDto[];
  createdAt: string;
}

export interface FamilyInviteDto {
  code: string;
  familyId: string;
  expiresAt: string;
}

export interface FamilyAccountDto {
  id: string;
  name: string;
  type: FamilyAccountType;
  balance: number;
  currency: string;
}

export interface FamilyAccountsResponse {
  accounts: FamilyAccountDto[];
  totalBalance: number;
  currency: string;
}

export interface FamilyTransactionDto {
  id: string;
  accountId: string;
  userId: string;
  nickname: string | null;
  kind: FamilyTransactionKind;
  amount: number;
  note: string | null;
  date: string;
  createdAt: string;
}

export interface FamilyTransactionResult {
  account: FamilyAccountDto;
  transaction: FamilyTransactionDto;
}

export interface FamilyGoalDepositDto {
  id: string;
  goalId: string;
  userId: string;
  nickname: string | null;
  amount: number;
  date: string;
  createdAt: string;
}

export interface FamilyGoalDto {
  id: string;
  title: string;
  targetAmount: number;
  savedAmount: number;
  remaining: number;
  percent: number;
  deadline: string | null;
  image: string | null;
  currency: string;
  requiredMonthly: number | null;
  forecastDate: string | null;
  milestones: GoalMilestone[];
  deposits: FamilyGoalDepositDto[];
  createdAt: string;
}

export interface FamilyGoalDepositResult {
  goal: FamilyGoalDto;
  deposit: FamilyGoalDepositDto;
}
