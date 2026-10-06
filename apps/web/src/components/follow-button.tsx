// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useState } from 'react';
import type { FollowStateDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { socialApi } from '@/lib/social-client';

/**
 * Кнопка подписки (ТЗ §3.7). Подключается на публичном профиле (блок A):
 * принимает никнейм и начальное состояние, переключает подписку по API.
 */
export function FollowButton({
  nickname,
  initialFollowing = false,
  onChanged,
}: {
  nickname: string;
  initialFollowing?: boolean;
  onChanged?: (state: FollowStateDto) => void;
}) {
  const { t } = useT();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function toggle(): Promise<void> {
    setBusy(true);
    setError(false);
    try {
      if (following) {
        await socialApi.unfollow(nickname);
        setFollowing(false);
      } else {
        const state = await socialApi.follow(nickname);
        setFollowing(state.following);
        onChanged?.(state);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid="follow-button"
        data-following={following}
        onClick={() => void toggle()}
        disabled={busy}
        className={`rounded-[var(--radius-button)] px-4 py-2 text-sm font-semibold transition-colors duration-150 disabled:opacity-50 ${
          following
            ? 'border-[1.5px] border-[var(--puls-line-strong)] text-[var(--puls-primary-text)]'
            : 'bg-[var(--puls-primary)] text-[var(--puls-on-primary)]'
        }`}
      >
        {following ? t('follow.following') : t('follow.follow')}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-[var(--puls-warning-text)]">
          {t('follow.error')}
        </span>
      ) : null}
    </div>
  );
}
