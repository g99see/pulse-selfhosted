// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ProvidersResponse, TelegramAuthInput } from '@puls/shared';
import { Alert } from '@/components/ui';
import { useT } from '@/components/locale-provider';
import { TelegramLoginButton, type TelegramWidgetUser } from '@/components/telegram-login-button';
import { authApi, googleLoginUrl } from '@/lib/auth-client';

/**
 * Кнопки внешнего входа на /login и /register (ТЗ §3.1, §7). Показываются только
 * те провайдеры, которых владелец включил ключами; иначе блок не рендерится.
 */
export function ProviderButtons() {
  const { t } = useT();
  const router = useRouter();
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    authApi
      .providers()
      .then((value) => active && setProviders(value))
      .catch(
        () => active && setProviders({ google: false, telegram: false, telegramBotUsername: null }),
      );
    return () => {
      active = false;
    };
  }, []);

  if (!providers || (!providers.google && !providers.telegram)) return null;

  async function telegramAuth(user: TelegramWidgetUser): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await authApi.telegram(user as unknown as TelegramAuthInput);
      const me = await authApi.me();
      router.push(me.onboardingCompleted ? '/app' : '/onboarding');
    } catch {
      setError(t('auth.providers.error', { provider: t('settings.accounts.provider.telegram') }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="provider-buttons">
      <p className="text-center text-xs uppercase tracking-wide text-[var(--puls-ink-muted)]">
        {t('auth.providers.divider')}
      </p>

      {providers.google ? (
        <a
          href={googleLoginUrl()}
          data-testid="google-login"
          className="flex h-12 items-center justify-center rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] px-6 font-semibold transition-opacity hover:opacity-80"
        >
          {t('auth.providers.google')}
        </a>
      ) : null}

      {providers.telegram && providers.telegramBotUsername ? (
        <div className="flex justify-center">
          <TelegramLoginButton
            botUsername={providers.telegramBotUsername}
            label={t('auth.providers.telegram')}
            onAuth={(user) => {
              if (!busy) void telegramAuth(user);
            }}
          />
        </div>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
