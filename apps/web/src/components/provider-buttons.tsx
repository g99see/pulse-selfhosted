// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import type { ProvidersResponse } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { authApi, googleLoginUrl } from '@/lib/auth-client';

/**
 * Кнопки внешнего входа на /login и /register (ТЗ §3.1, §7). Вход через Telegram
 * удалён в v3 §7.3, остаётся Google. Показываем только включённые владельцем
 * провайдеры; иначе блок не рендерится.
 */
export function ProviderButtons() {
  const { t } = useT();
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);

  useEffect(() => {
    let active = true;
    authApi
      .providers()
      .then((value) => {
        if (active) setProviders(value);
      })
      .catch(() => {
        if (active) setProviders({ google: false });
      });
    return () => {
      active = false;
    };
  }, []);

  if (!providers?.google) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="provider-buttons">
      <p className="text-center text-xs uppercase tracking-wide text-[var(--puls-ink-muted)]">
        {t('auth.providers.divider')}
      </p>

      <a
        href={googleLoginUrl()}
        data-testid="google-login"
        className="flex h-12 items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] px-6 font-semibold transition-opacity hover:opacity-80"
      >
        {t('auth.providers.google')}
      </a>
    </div>
  );
}
