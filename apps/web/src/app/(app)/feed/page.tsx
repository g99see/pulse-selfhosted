// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FeedPage } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { PostCard } from '@/components/post-card';
import { socialApi } from '@/lib/social-client';

/** Лента обновлений подписок (ТЗ §3.7): посты, реакции и комментарии. */
export default function FeedPage() {
  const { t } = useT();
  const [page, setPage] = useState<FeedPage | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setPage(await socialApi.feed());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore(): Promise<void> {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await socialApi.feed(page.nextCursor);
      setPage({ posts: [...page.posts, ...next.posts], nextCursor: next.nextCursor });
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="feed-page">
      <div>
        <h1 className="text-3xl font-extrabold">{t('feed.title')}</h1>
        <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('feed.subtitle')}</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
          {t('feed.error')}
        </p>
      ) : null}

      {page === null ? (
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('common.loading')}</p>
      ) : page.posts.length === 0 ? (
        <p className="text-sm text-[var(--puls-ink-muted)]" data-testid="feed-empty">
          {t('feed.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {page.posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      {page?.nextCursor ? (
        <button
          type="button"
          data-testid="feed-load-more"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="w-fit rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {t('feed.loadMore')}
        </button>
      ) : null}
    </div>
  );
}
