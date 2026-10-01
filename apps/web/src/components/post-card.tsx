// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useState } from 'react';
import {
  REACTION_EMOJIS,
  achievementByCode,
  type AchievementCode,
  type CommentDto,
  type PostDto,
  type ReactionSummary,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Card } from '@/components/ui';
import { socialApi } from '@/lib/social-client';

interface PostPayload {
  code?: string;
  title?: string;
  percent?: number;
}

/** Заголовок карточки поста: достижение, цель или веха (ТЗ §3.7). */
function postTitle(post: PostDto, t: ReturnType<typeof useT>['t']): string {
  const payload = (post.payload ?? {}) as PostPayload;
  if (post.type === 'achievement') {
    const definition = payload.code
      ? achievementByCode(payload.code as AchievementCode)
      : undefined;
    return t('feed.post.achievement', { title: t(definition?.titleKey ?? 'achievements.title') });
  }
  if (post.type === 'goal') {
    return t('feed.post.goal', { title: payload.title ?? '' });
  }
  return t('feed.post.milestone', {
    title: payload.title ?? '',
    percent: Math.round(payload.percent ?? 0),
  });
}

/**
 * Карточка поста в ленте (ТЗ §3.7): заголовок, реакции-эмодзи и комментарии.
 * Реакция переключается повторным нажатием, комментарии грузятся по запросу.
 */
export function PostCard({ post }: { post: PostDto }) {
  const { t } = useT();
  const [reactions, setReactions] = useState<ReactionSummary[]>(post.reactions);
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [commentsCount, setCommentsCount] = useState(post.commentsCount);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(false);

  function reactionFor(emoji: string): ReactionSummary | undefined {
    return reactions.find((item) => item.emoji === emoji);
  }

  async function toggleReaction(emoji: string): Promise<void> {
    const mine = reactionFor(emoji)?.reactedByMe ?? false;
    try {
      if (mine) {
        await socialApi.unreact(post.id, emoji);
        setReactions((prev) =>
          prev
            .map((item) =>
              item.emoji === emoji ? { ...item, count: item.count - 1, reactedByMe: false } : item,
            )
            .filter((item) => item.count > 0),
        );
      } else {
        setReactions(await socialApi.react(post.id, emoji));
      }
    } catch {
      setError(true);
    }
  }

  async function toggleComments(): Promise<void> {
    if (!open && comments === null) {
      try {
        setComments(await socialApi.comments(post.id));
      } catch {
        setError(true);
      }
    }
    setOpen((value) => !value);
  }

  async function submitComment(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    try {
      const created = await socialApi.addComment(post.id, body);
      setComments((prev) => [...(prev ?? []), created]);
      setCommentsCount((count) => count + 1);
      setText('');
      setError(false);
    } catch {
      setError(true);
    }
  }

  async function removeComment(id: string): Promise<void> {
    try {
      await socialApi.deleteComment(id);
      setComments((prev) => (prev ?? []).filter((item) => item.id !== id));
      setCommentsCount((count) => Math.max(0, count - 1));
    } catch {
      setError(true);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div data-testid="post-card" data-post-id={post.id} className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--puls-primary-soft)] font-heading text-base font-extrabold text-[var(--puls-primary-text)]"
        >
          {post.author.nickname.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="text-xs text-[var(--puls-ink-muted)]">
            {t('feed.post.author', { nickname: post.author.nickname })}
          </p>
          <p className="font-heading text-base font-bold">{postTitle(post, t)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label={t('feed.reactions.label')}>
        {REACTION_EMOJIS.map((emoji) => {
          const summary = reactionFor(emoji);
          return (
            <button
              key={emoji}
              type="button"
              data-testid={`reaction-${emoji}`}
              data-reacted={summary?.reactedByMe ?? false}
              onClick={() => void toggleReaction(emoji)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors duration-150 ${
                summary?.reactedByMe
                  ? 'border-[var(--puls-primary)] bg-[var(--puls-primary-soft)] text-[var(--puls-primary-text)]'
                  : 'border-transparent bg-[var(--puls-surface-2)] hover:bg-[var(--puls-primary-soft)]'
              }`}
            >
              <span aria-hidden="true">{emoji}</span>
              {summary && summary.count > 0 ? (
                <span className="ml-1 text-xs text-[var(--puls-ink-muted)]">{summary.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          data-testid="comments-toggle"
          onClick={() => void toggleComments()}
          className="w-fit text-sm font-medium text-[var(--puls-primary-text)]"
        >
          {t('feed.comments.title')} ({commentsCount})
        </button>

        {open ? (
          <div className="flex flex-col gap-2" data-testid="comments-list">
            {comments === null || comments.length === 0 ? (
              <p className="text-xs text-[var(--puls-ink-muted)]">{t('feed.comments.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {comments.map((comment) => (
                  <li
                    key={comment.id}
                    data-testid={`comment-${comment.id}`}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">@{comment.author.nickname}</span>{' '}
                      <span>{comment.body}</span>
                    </span>
                    {comment.canDelete ? (
                      <button
                        type="button"
                        data-testid={`comment-delete-${comment.id}`}
                        onClick={() => void removeComment(comment.id)}
                        className="text-xs text-[var(--puls-warning-text)]"
                      >
                        {t('feed.comments.delete')}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <form
              onSubmit={(event) => void submitComment(event)}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                data-testid="comment-input"
                value={text}
                maxLength={500}
                onChange={(event) => setText(event.target.value)}
                placeholder={t('feed.comments.placeholder')}
                className="h-10 flex-1 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3 text-sm"
              />
              <button
                type="submit"
                data-testid="comment-submit"
                className="h-10 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)]"
              >
                {t('feed.comments.submit')}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-[var(--puls-warning-text)]">
          {t('feed.comments.error')}
        </p>
      ) : null}
    </Card>
  );
}
