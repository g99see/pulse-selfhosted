// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FeedPage } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { PostCard } from '@/components/post-card';
import { Alert, Card, EmptyState, GhostButton, IconBubble } from '@/components/ui';
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
      <div className="flex items-center gap-3">
        <IconBubble name="feed" tone="primary" size={48} />
        <div>
          <h1 className="text-2xl font-extrabold">{t('feed.title')}</h1>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('feed.subtitle')}</p>
        </div>
      </div>

      {error ? <Alert>{t('feed.error')}</Alert> : null}

      {page === null ? (
        <div className="min-h-32 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-6 text-sm text-[var(--puls-ink-muted)] shadow-sm">
          {t('common.loading')}
        </div>
      ) : page.posts.length === 0 ? (
        <Card>
          <div data-testid="feed-empty">
            <EmptyState icon="feed" tone="primary" title={t('feed.empty')} />
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {page.posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      {page?.nextCursor ? (
        <GhostButton
          type="button"
          data-testid="feed-load-more"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="w-fit"
        >
          {t('feed.loadMore')}
        </GhostButton>
      ) : null}
    </div>
  );
}
