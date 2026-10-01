// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Челленджи (ТЗ §4, приоритет P2): «30 дней без доставки», «Неделя без
 * импульсных покупок» и другие испытания. Можно позвать друзей по коду или из
 * подписок и видеть общий рейтинг: только никнеймы и счёт (дни выдержки) —
 * приватные данные участников не раскрываются.
 *
 * Здесь схемы (Zod), типы DTO и чистые функции прогресса/рейтинга, общие для
 * API и web. Отметка «держусь» ставится раз в день (ChallengeCheck); для
 * kind = streak_checkin прогресс считается автоматически по чек-инам — как и
 * для остальных видов, счёт идёт по ok-дням внутри окна челленджа.
 */
import { z } from 'zod';

/** Виды челленджа (ТЗ §4). */
export const CHALLENGE_KINDS = ['no_spend_category', 'streak_checkin', 'custom'] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

/** Видимость челленджа (ТЗ §4): private | friends | public. */
export const CHALLENGE_VISIBILITIES = ['private', 'friends', 'public'] as const;
export type ChallengeVisibility = (typeof CHALLENGE_VISIBILITIES)[number];
export const ChallengeVisibilitySchema = z.enum(CHALLENGE_VISIBILITIES);

/** Границы длительности: от одного дня до года. */
export const CHALLENGE_DURATION_MIN = 1;
export const CHALLENGE_DURATION_MAX = 365;
export const CHALLENGE_TITLE_MAX = 80;
export const CHALLENGE_MAX_PARTICIPANTS = 50;

/**
 * Готовые шаблоны (ТЗ §4): «30 дней без доставки», «Неделя без импульсных
 * покупок», «7 дней чек-инов». `title` — значение по умолчанию (web показывает
 * локализованный текст по `key`), `kind` и `durationDays` подставляются в форму.
 */
export const CHALLENGE_TEMPLATES = [
  {
    key: 'no_delivery_30',
    title: '30 дней без доставки',
    kind: 'no_spend_category',
    durationDays: 30,
  },
  {
    key: 'no_impulse_week',
    title: 'Неделя без импульсных покупок',
    kind: 'no_spend_category',
    durationDays: 7,
  },
  {
    key: 'streak_checkin_7',
    title: '7 дней чек-инов',
    kind: 'streak_checkin',
    durationDays: 7,
  },
] as const satisfies ReadonlyArray<{
  key: string;
  title: string;
  kind: ChallengeKind;
  durationDays: number;
}>;

export type ChallengeTemplate = (typeof CHALLENGE_TEMPLATES)[number];

const titleSchema = z
  .string()
  .trim()
  .min(1, { message: 'Введите название' })
  .max(CHALLENGE_TITLE_MAX);

/** Дата в формате YYYY-MM-DD или ISO-строке. */
const dateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Некорректная дата' });

export const ChallengeCreateSchema = z.object({
  title: titleSchema,
  kind: z.enum(CHALLENGE_KINDS).default('custom'),
  durationDays: z
    .number()
    .int()
    .min(CHALLENGE_DURATION_MIN)
    .max(CHALLENGE_DURATION_MAX)
    .default(30),
  startDate: dateSchema.optional(),
  visibility: ChallengeVisibilitySchema.default('private'),
});
export type ChallengeCreateInput = z.infer<typeof ChallengeCreateSchema>;
export type ChallengeCreateValues = z.input<typeof ChallengeCreateSchema>;

export const ChallengeUpdateSchema = z.object({
  title: titleSchema.optional(),
  visibility: ChallengeVisibilitySchema.optional(),
});
export type ChallengeUpdateInput = z.infer<typeof ChallengeUpdateSchema>;

export const ChallengeJoinSchema = z.object({
  code: z.string().trim().min(4, { message: 'Введите код' }).max(64),
});
export type ChallengeJoinInput = z.infer<typeof ChallengeJoinSchema>;

export const ChallengeCheckSchema = z.object({
  date: dateSchema.optional(),
  ok: z.boolean().default(true),
});
export type ChallengeCheckInput = z.infer<typeof ChallengeCheckSchema>;

export const ChallengeInviteSchema = z.object({
  nickname: z.string().trim().min(1).max(32),
});
export type ChallengeInviteInput = z.infer<typeof ChallengeInviteSchema>;

/* ----- Чистые функции расчётов (ТЗ §4) ----- */

const DAY_MS = 86_400_000;

/** UTC-полночь календарного дня (колонка @db.Date). */
export function toUtcDay(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Сдвиг даты на целое число календарных дней. */
export function addChallengeDays(date: Date | string, days: number): Date {
  const base = toUtcDay(date);
  return new Date(base.getTime() + days * DAY_MS);
}

/** Последний день челленджа включительно: старт + (длительность − 1) дней. */
export function challengeEndDate(startDate: Date | string, durationDays: number): Date {
  const duration = Math.max(1, Math.floor(durationDays));
  return addChallengeDays(startDate, duration - 1);
}

/** Попадает ли день в окно челленджа [старт, конец] включительно. */
export function isDayInChallenge(
  startDate: Date | string,
  durationDays: number,
  day: Date | string,
): boolean {
  const start = toUtcDay(startDate).getTime();
  const end = challengeEndDate(startDate, durationDays).getTime();
  const value = toUtcDay(day).getTime();
  return value >= start && value <= end;
}

/**
 * Номер дня челленджа (1..durationDays) для даты `from`; null, если дата вне
 * окна челленджа.
 */
export function challengeDayNumber(
  startDate: Date | string,
  durationDays: number,
  from: Date = new Date(),
): number | null {
  const start = toUtcDay(startDate).getTime();
  const value = toUtcDay(from).getTime();
  const diff = Math.round((value - start) / DAY_MS);
  if (diff < 0 || diff >= durationDays) return null;
  return diff + 1;
}

/** Дни выдержки: количество ok-отметок внутри окна челленджа. */
export function challengeHeldDays(
  startDate: Date | string,
  durationDays: number,
  checks: ReadonlyArray<{ date: Date | string; ok: boolean }>,
): number {
  const start = toUtcDay(startDate).getTime();
  const end = challengeEndDate(startDate, durationDays).getTime();
  const okDays = new Set<number>();
  for (const check of checks) {
    if (!check.ok) continue;
    const value = toUtcDay(check.date).getTime();
    if (value < start || value > end) continue;
    okDays.add(value);
  }
  return okDays.size;
}

/**
 * Текущая серия ok-дней, заканчивающаяся сегодня (или вчера, если сегодня
 * отметки нет). Автоматический прогресс для kind = streak_checkin (ТЗ §4).
 */
export function challengeCurrentStreak(
  checks: ReadonlyArray<{ date: Date | string; ok: boolean }>,
  from: Date = new Date(),
): number {
  const okDays = new Set<number>();
  for (const check of checks) {
    if (check.ok) okDays.add(toUtcDay(check.date).getTime());
  }
  let cursor = toUtcDay(from).getTime();
  if (!okDays.has(cursor)) cursor -= DAY_MS;
  let streak = 0;
  while (okDays.has(cursor)) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

/** Прогресс челленджа в процентах 0..100 по дням выдержки. */
export function challengeProgressPercent(heldDays: number, durationDays: number): number {
  if (!Number.isFinite(heldDays) || !Number.isFinite(durationDays) || durationDays <= 0) return 0;
  const percent = Math.round((heldDays / durationDays) * 100);
  return Math.min(100, Math.max(0, percent));
}

/** Отметка «держусь» есть сегодня. */
export function challengeCheckedToday(
  checks: ReadonlyArray<{ date: Date | string; ok: boolean }>,
  from: Date = new Date(),
): boolean {
  const today = toUtcDay(from).getTime();
  return checks.some((check) => check.ok && toUtcDay(check.date).getTime() === today);
}

/** Строка участника для расчёта рейтинга. */
export interface ChallengeRankInput {
  userId: string;
  nickname: string;
  joinedAt: Date | string;
  checks: ReadonlyArray<{ date: Date | string; ok: boolean }>;
}

export interface ChallengeLeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  /** Счёт рейтинга = дни выдержки (число ok-дней). */
  score: number;
  currentStreak: number;
}

/**
 * Рейтинг участников (ТЗ §4): только никнейм и счёт, приватные данные не
 * раскрываются. Порядок — по дням выдержки, затем по текущей серии, затем по
 * никнейму; места 1..N без пропусков.
 */
export function challengeLeaderboard(
  participants: ReadonlyArray<ChallengeRankInput>,
  startDate: Date | string,
  durationDays: number,
  from: Date = new Date(),
): ChallengeLeaderboardEntry[] {
  const rows = participants.map((participant) => ({
    userId: participant.userId,
    nickname: participant.nickname,
    score: challengeHeldDays(startDate, durationDays, participant.checks),
    currentStreak: challengeCurrentStreak(participant.checks, from),
  }));

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
    return a.nickname.localeCompare(b.nickname);
  });

  return rows.map((row, index) => ({ rank: index + 1, ...row }));
}

/**
 * Видимость челленджа зрителю: участник видит всегда, private — только он,
 * friends — подписчики владельца, public — все авторизованные (ТЗ §4).
 */
export function canViewChallenge(
  visibility: ChallengeVisibility,
  isParticipant: boolean,
  isFollower: boolean,
): boolean {
  if (isParticipant) return true;
  if (visibility === 'public') return true;
  if (visibility === 'friends') return isFollower;
  return false;
}

/* ----- DTO ответов API (общие для web и api) ----- */

/** Участник челленджа: только никнейм — приватные данные не раскрываем. */
export interface ChallengeParticipantDto {
  userId: string;
  nickname: string;
  joinedAt: string;
}

export interface ChallengeDto {
  id: string;
  title: string;
  kind: ChallengeKind;
  durationDays: number;
  startDate: string;
  /** Последний день включительно. */
  endDate: string;
  visibility: ChallengeVisibility;
  /** Код приглашения — виден участникам челленджа. */
  inviteCode: string;
  ownerId: string;
  ownerNickname: string;
  isOwner: boolean;
  isParticipating: boolean;
  participantsCount: number;
  /** Дни выдержки текущего пользователя. */
  heldDays: number;
  /** Текущая серия ok-дней текущего пользователя. */
  currentStreak: number;
  /** Прогресс текущего пользователя в процентах. */
  percent: number;
  /** Номер текущего дня челленджа (null — вне окна). */
  dayNumber: number | null;
  checkedToday: boolean;
  /** Все участники (никнеймы), для отображения состава. */
  participants: ChallengeParticipantDto[];
  createdAt: string;
}

export interface ChallengeLeaderboardEntryDto {
  rank: number;
  userId: string;
  nickname: string;
  score: number;
  currentStreak: number;
}

export interface ChallengeLeaderboardDto {
  challengeId: string;
  entries: ChallengeLeaderboardEntryDto[];
}

export interface ChallengesListResponse {
  challenges: ChallengeDto[];
}

/** Кандидат на приглашение из подписок (ТЗ §4). */
export interface ChallengeInviteCandidateDto {
  userId: string;
  nickname: string;
}
