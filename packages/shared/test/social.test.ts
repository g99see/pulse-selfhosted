// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты социального слоя (ТЗ §3.7): схемы комментария и реакции, пагинация
// курсором, видимость контента и агрегация реакций.
import { describe, expect, it } from 'vitest';
import {
  COMMENT_MAX_LENGTH,
  CommentCreateSchema,
  FeedQuerySchema,
  REACTION_EMOJIS,
  ReactionCreateSchema,
  canView,
  effectiveVisibility,
  encodeFeedCursor,
  parseFeedCursor,
  summarizeReactions,
} from '../src/social';

describe('CommentCreateSchema', () => {
  it('принимает текст до 500 символов и обрезает пробелы', () => {
    const parsed = CommentCreateSchema.parse({ body: '  Молодец!  ' });
    expect(parsed.body).toBe('Молодец!');
  });

  it('отклоняет пустой комментарий', () => {
    expect(CommentCreateSchema.safeParse({ body: '   ' }).success).toBe(false);
  });

  it('отклоняет текст длиннее 500 символов', () => {
    const long = 'a'.repeat(COMMENT_MAX_LENGTH + 1);
    expect(CommentCreateSchema.safeParse({ body: long }).success).toBe(false);
    expect(CommentCreateSchema.safeParse({ body: 'a'.repeat(COMMENT_MAX_LENGTH) }).success).toBe(
      true,
    );
  });
});

describe('ReactionCreateSchema', () => {
  it('принимает только эмодзи из фиксированного набора', () => {
    expect(ReactionCreateSchema.parse({ emoji: '🔥' }).emoji).toBe('🔥');
    expect(ReactionCreateSchema.safeParse({ emoji: '🚀' }).success).toBe(false);
    expect(REACTION_EMOJIS.length).toBeGreaterThan(0);
  });
});

describe('FeedQuerySchema', () => {
  it('по умолчанию размер страницы 20, курсор не задан', () => {
    const parsed = FeedQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.cursor).toBeUndefined();
  });

  it('приводит limit из строки и ограничивает сверху 50', () => {
    expect(FeedQuerySchema.parse({ limit: '30' }).limit).toBe(30);
    expect(FeedQuerySchema.safeParse({ limit: '100' }).success).toBe(false);
  });
});

describe('курсор ленты', () => {
  it('кодирует и разбирает пару createdAt + id', () => {
    const at = new Date('2026-10-01T10:00:00.000Z');
    const cursor = encodeFeedCursor(at, 'post_1');
    const parsed = parseFeedCursor(cursor);
    expect(parsed?.id).toBe('post_1');
    expect(parsed?.createdAt.toISOString()).toBe(at.toISOString());
  });

  it('возвращает null на некорректном курсоре', () => {
    expect(parseFeedCursor('без-разделителя')).toBeNull();
    expect(parseFeedCursor('not-a-date_id')).toBeNull();
  });
});

describe('canView / effectiveVisibility', () => {
  it('владелец видит свой приватный пост', () => {
    expect(canView('private', true, false)).toBe(true);
  });

  it('private виден только владельцу', () => {
    expect(canView('private', false, true)).toBe(false);
  });

  it('subscribers виден подписчику, но не постороннему', () => {
    expect(canView('subscribers', false, true)).toBe(true);
    expect(canView('subscribers', false, false)).toBe(false);
  });

  it('public виден всем', () => {
    expect(canView('public', false, false)).toBe(true);
  });

  it('итоговая видимость — не шире приватности профиля', () => {
    expect(effectiveVisibility('public', 'subscribers')).toBe('subscribers');
    expect(effectiveVisibility('public', 'private')).toBe('private');
    expect(effectiveVisibility('private', 'public')).toBe('private');
    expect(effectiveVisibility('public', 'public')).toBe('public');
  });
});

describe('summarizeReactions', () => {
  const rows = [
    { emoji: '👍', userId: 'u1' },
    { emoji: '👍', userId: 'u2' },
    { emoji: '🔥', userId: 'u1' },
    { emoji: '🚀', userId: 'u3' },
  ];

  it('агрегирует по эмодзи и отбрасывает неизвестные', () => {
    const summary = summarizeReactions(rows, 'u1');
    expect(summary).toEqual([
      { emoji: '👍', count: 2, reactedByMe: true },
      { emoji: '🔥', count: 1, reactedByMe: true },
    ]);
  });

  it('без зрителя reactedByMe = false', () => {
    const summary = summarizeReactions([{ emoji: '🎉', userId: 'u2' }], null);
    expect(summary).toEqual([{ emoji: '🎉', count: 1, reactedByMe: false }]);
  });
});
