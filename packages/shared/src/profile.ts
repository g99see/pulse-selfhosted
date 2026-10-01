// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Публичный профиль (ТЗ §3.7): схемы, типы и чистые функции видимости карточек.
 * Общие для API и web. Суммы по умолчанию скрыты — карточки показывают проценты.
 * Приватность карточки: public (всем) | subscribers (подписчикам) | private
 * (только владельцу); private не отдаётся никому, кроме владельца.
 */
import { z } from 'zod';
import { ProfileVisibilitySchema, type ProfileVisibility } from './auth';

/** Типы карточек профиля (ТЗ §3.7): накопления, стрик, настроение, бейджи, цели, HTML. */
export const PROFILE_CARD_TYPES = [
  'savings',
  'checkin_streak',
  'avg_mood',
  'achievements',
  'goals',
  'html_page',
] as const;
export const ProfileCardTypeSchema = z.enum(PROFILE_CARD_TYPES);
export type ProfileCardType = z.infer<typeof ProfileCardTypeSchema>;

/** Режим отображения карточки: проценты (по умолчанию) или сумма. */
export const PROFILE_CARD_MODES = ['percent', 'amount'] as const;
export const ProfileCardModeSchema = z.enum(PROFILE_CARD_MODES);
export type ProfileCardMode = z.infer<typeof ProfileCardModeSchema>;

/** Типы карточек, где осмыслен режим «сумма» (остальные всегда проценты). */
export const AMOUNT_CARD_TYPES: readonly ProfileCardType[] = ['savings', 'goals'];

/** Поддерживает ли карточка показ суммы (ТЗ §3.7: суммы скрыты по умолчанию). */
export function cardTypeSupportsAmount(type: ProfileCardType): boolean {
  return AMOUNT_CARD_TYPES.includes(type);
}

/** Итоговый режим: невзначай переданный «amount» у неподдерживаемого типа → percent. */
export function resolveCardMode(type: ProfileCardType, mode: ProfileCardMode): ProfileCardMode {
  return cardTypeSupportsAmount(type) ? mode : 'percent';
}

/* ----- Чистая логика видимости (ТЗ §3.7) ----- */

/** Кто смотрит профиль: владелец и/или его подписчик. */
export interface CardViewer {
  isOwner?: boolean;
  /** Есть ли подписка смотрящего на владельца профиля (блок B, Follow). */
  isSubscriber?: boolean;
}

/** Видна ли карточка смотрящему. private — только владельцу. */
export function canViewCard(visibility: ProfileVisibility, viewer: CardViewer = {}): boolean {
  if (viewer.isOwner) return true;
  if (visibility === 'private') return false;
  if (visibility === 'public') return true;
  return viewer.isSubscriber === true;
}

/** Виден ли сам профиль смотрящему (по User.profileVisibility). */
export function canViewProfile(visibility: ProfileVisibility, viewer: CardViewer = {}): boolean {
  if (viewer.isOwner) return true;
  if (visibility === 'private') return false;
  if (visibility === 'public') return true;
  return viewer.isSubscriber === true;
}

/** Оставляет только карточки, видимые смотрящему. */
export function filterVisibleCards<T extends { visibility: ProfileVisibility }>(
  cards: readonly T[],
  viewer: CardViewer = {},
): T[] {
  return cards.filter((card) => canViewCard(card.visibility, viewer));
}

/* ----- Очистка HTML-карточки (ТЗ §3.8) ----- */

/** Максимальный размер HTML-страницы карточки. */
export const HTML_CARD_MAX = 20_000;

/**
 * Грубая очистка HTML (ТЗ §3.8): убирает скрипты, встраиваемые фреймы, стили,
 * мета-теги и обработчики on*, а также ссылки javascript:. Полноценная
 * санитизация — задача рендера; здесь отсекаем заведомо опасное на входе.
 */
export function sanitizeCardHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

/* ----- Схемы ввода ----- */

export const BIO_MAX = 280;

/** Ссылка на картинку профиля: пусто либо http(s) (файлы не загружаются). */
export const ProfileImageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^https?:\/\//i.test(value), {
    message: 'Ссылка должна начинаться с http(s)://',
  });

export const ProfileCardInputSchema = z.object({
  type: ProfileCardTypeSchema,
  /** По умолчанию карточка скрыта — приватность превыше всего (ТЗ §3.7). */
  visibility: ProfileVisibilitySchema.default('private'),
  mode: ProfileCardModeSchema.default('percent'),
  title: z.string().trim().max(80).optional(),
  html: z.string().max(HTML_CARD_MAX).optional(),
});
export type ProfileCardInput = z.infer<typeof ProfileCardInputSchema>;

/** PUT /api/profile: описание профиля и полный набор карточек. */
export const ProfileUpdateSchema = z.object({
  bio: z.string().trim().max(BIO_MAX).nullable().optional(),
  avatarUrl: ProfileImageUrlSchema.nullable().optional(),
  coverUrl: ProfileImageUrlSchema.nullable().optional(),
  cards: z.array(ProfileCardInputSchema).max(PROFILE_CARD_TYPES.length).optional(),
});
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

/* ----- Контракты ответов API ----- */

export type ProfileCardData =
  | { kind: 'savings'; percent: number; amount: number | null; currency: string }
  | { kind: 'checkin_streak'; current: number; longest: number }
  | { kind: 'avg_mood'; average: number | null }
  | { kind: 'achievements'; earned: number; total: number }
  | {
      kind: 'goals';
      goals: Array<{ id: string; title: string; percent: number; amount: number | null }>;
    }
  | { kind: 'html_page'; html: string };

export interface ProfileCardDto {
  type: ProfileCardType;
  visibility: ProfileVisibility;
  mode: ProfileCardMode;
  title: string | null;
  data: ProfileCardData;
}

/** Свой профиль (GET /api/profile): приватные карточки владельцу тоже видны. */
export interface OwnProfileDto {
  nickname: string;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  profileVisibility: ProfileVisibility;
  cards: ProfileCardDto[];
}

/** Публичный профиль (GET /api/public/profiles/:nickname). */
export interface PublicProfileDto {
  nickname: string;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  cards: ProfileCardDto[];
}

export interface PublicProfileResponse {
  profile: PublicProfileDto;
}
