// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Социальный слой (ТЗ §3.7): подписки, лента постов, реакции и комментарии.
 * Чистые схемы, типы и функции без побочных эффектов — общие для API и web.
 * Приватность: видимость контента задаётся уровнем public | subscribers |
 * private и проверяется против факта подписки зрителя (canView).
 */
import { z } from 'zod';
import { ProfileVisibilitySchema, type ProfileVisibility } from './auth';

/* ----- Посты (ТЗ §3.7: посты о достижениях и целях) ----- */

/** Тип поста: достижение, новая цель или пройденная веха цели. */
export const PostTypeSchema = z.enum(['achievement', 'goal', 'milestone']);
export type PostType = z.infer<typeof PostTypeSchema>;

/** Приватность поста совпадает с приватностью карточек профиля (ТЗ §3.7). */
export const PostVisibilitySchema = ProfileVisibilitySchema;
export type PostVisibility = ProfileVisibility;

/* ----- Реакции (ТЗ §3.7) ----- */

/** Разрешённый набор эмодзи-реакций: фиксирован, чтобы UI собирался из него. */
export const REACTION_EMOJIS = ['👍', '🔥', '🎉', '💪', '❤️'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
export const ReactionEmojiSchema = z.enum(REACTION_EMOJIS);

export const ReactionCreateSchema = z.object({
  emoji: ReactionEmojiSchema,
});
export type ReactionCreateInput = z.infer<typeof ReactionCreateSchema>;

/* ----- Комментарии (ТЗ §3.7): не длиннее 500 символов ----- */

export const COMMENT_MAX_LENGTH = 500;

export const CommentCreateSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { message: 'Комментарий не может быть пустым' })
    .max(COMMENT_MAX_LENGTH, { message: `Комментарий не длиннее ${COMMENT_MAX_LENGTH} символов` }),
});
export type CommentCreateInput = z.infer<typeof CommentCreateSchema>;

/* ----- Лента: пагинация курсором (ТЗ §3.7) ----- */

export const FEED_PAGE_SIZE_DEFAULT = 20;
export const FEED_PAGE_SIZE_MAX = 50;

export const FeedQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(FEED_PAGE_SIZE_MAX).default(FEED_PAGE_SIZE_DEFAULT),
});
export type FeedQueryInput = z.infer<typeof FeedQuerySchema>;

/**
 * Курсор ленты: пара «момент создания + id», чтобы порядок был устойчив при
 * одинаковых createdAt. Возвращает строку для передачи клиенту.
 */
export function encodeFeedCursor(createdAt: Date | string, id: string): string {
  const iso = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();
  return `${iso}_${id}`;
}

/** Разбирает курсор ленты; null — если формат некорректен. */
export function parseFeedCursor(cursor: string): { createdAt: Date; id: string } | null {
  // ISO-время не содержит «_», поэтому первый разделитель отделяет его от id
  // (в самом id подчёркивания допустимы).
  const separator = cursor.indexOf('_');
  if (separator <= 0) return null;
  const iso = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (!id) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

/* ----- DTO ----- */

/** Краткая ссылка на пользователя в ленте и списках подписок. */
export interface SocialUserRef {
  id: string;
  nickname: string;
}

export interface ReactionSummary {
  emoji: ReactionEmoji;
  count: number;
  /** Поставил ли реакцию сам зритель. */
  reactedByMe: boolean;
}

export interface CommentDto {
  id: string;
  postId: string;
  userId: string;
  author: SocialUserRef;
  body: string;
  createdAt: string;
  /** Может ли зритель удалить комментарий (автор комментария или владелец поста). */
  canDelete: boolean;
}

export interface PostDto {
  id: string;
  userId: string;
  author: SocialUserRef;
  type: PostType;
  /** Данные поста: код достижения, цель или веха. Без сумм — только проценты. */
  payload: Record<string, unknown>;
  visibility: PostVisibility;
  createdAt: string;
  reactions: ReactionSummary[];
  reactionCount: number;
  commentsCount: number;
}

export interface FeedPage {
  posts: PostDto[];
  /** Курсор следующей страницы или null, если лента закончилась. */
  nextCursor: string | null;
}

export interface FollowStateDto {
  following: boolean;
  followersCount: number;
  followingCount: number;
}

export interface FollowListDto {
  users: SocialUserRef[];
}

/* ----- Чистые функции ----- */

/**
 * Видимость контента зрителю (ТЗ §3.7): владелец видит всё; public — все;
 * subscribers — только подписчики; private — только владелец.
 */
export function canView(
  visibility: PostVisibility,
  isOwner: boolean,
  isFollower: boolean,
): boolean {
  if (isOwner) return true;
  if (visibility === 'public') return true;
  if (visibility === 'subscribers') return isFollower;
  return false;
}

/**
 * Сводка реакций по посту: агрегирует по эмодзи в порядке REACTION_EMOJIS и
 * отмечает реакцию зрителя. Пустые эмодзи отбрасываются.
 */
export function summarizeReactions(
  rows: readonly { emoji: string; userId: string }[],
  viewerId: string | null,
): ReactionSummary[] {
  const counts = new Map<ReactionEmoji, number>();
  const mine = new Set<ReactionEmoji>();

  for (const row of rows) {
    if (!(REACTION_EMOJIS as readonly string[]).includes(row.emoji)) continue;
    const emoji = row.emoji as ReactionEmoji;
    counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    if (viewerId && row.userId === viewerId) mine.add(emoji);
  }

  return REACTION_EMOJIS.filter((emoji) => (counts.get(emoji) ?? 0) > 0).map((emoji) => ({
    emoji,
    count: counts.get(emoji) ?? 0,
    reactedByMe: mine.has(emoji),
  }));
}

/**
 * Видимость контента с учётом приватности профиля владельца: пост не может
 * быть виден шире, чем профиль. Итоговый уровень — минимум из двух.
 */
export function effectiveVisibility(
  postVisibility: PostVisibility,
  profileVisibility: PostVisibility,
): PostVisibility {
  const rank: Record<PostVisibility, number> = { public: 0, subscribers: 1, private: 2 };
  return rank[postVisibility] >= rank[profileVisibility] ? postVisibility : profileVisibility;
}
