// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IdentitiesResponse, ProvidersResponse, TelegramAuthInput } from '@puls/shared';
import { Alert, Card, GhostButton } from '@/components/ui';
import { useT } from '@/components/locale-provider';
import { TelegramLoginButton, type TelegramWidgetUser } from '@/components/telegram-login-button';
import { AuthApiError, authApi, googleLinkUrl } from '@/lib/auth-client';

type ProviderId = 'google' | 'telegram';
const PROVIDERS: readonly ProviderId[] = ['google', 'telegram'];

/**
 * Секция «Способы входа» на /settings (ТЗ §3.1, §7): список привязок, привязка
 * Google и Telegram, отвязка. Отвязать единственный способ входа нельзя — API
 * вернёт last_login_method, и мы показываем объяснение. Аккаунту из Telegram
 * мягко предлагаем указать email.
 */
export function LinkedAccountsSection() {
  const { t } = useT();

  const [data, setData] = useState<IdentitiesResponse | null>(null);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ProviderId | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [identities, availability, me] = await Promise.all([
        authApi.identities(),
        authApi.providers(),
        authApi.me(),
      ]);
      setData(identities);
      setProviders(availability);
      setNeedsEmail(Boolean(me.needsEmail));
    } catch {
      setError(t('settings.accounts.loadError'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function unlink(provider: ProviderId): Promise<void> {
    if (
      !window.confirm(
        t('settings.accounts.unlinkConfirm', {
          provider: t(`settings.accounts.provider.${provider}`),
        }),
      )
    ) {
      return;
    }
    setBusy(provider);
    setError(null);
    try {
      await authApi.unlinkIdentity(provider);
      setData(await authApi.identities());
    } catch (caught) {
      setError(
        caught instanceof AuthApiError && caught.code === 'last_login_method'
          ? t('settings.accounts.lastMethod')
          : t('settings.accounts.saveError'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function linkTelegram(user: TelegramWidgetUser): Promise<void> {
    setBusy('telegram');
    setError(null);
    try {
      setData(await authApi.linkTelegram(user as unknown as TelegramAuthInput));
    } catch {
      setError(t('settings.accounts.saveError'));
    } finally {
      setBusy(null);
    }
  }

  const linked = new Set(data?.identities.map((identity) => identity.provider) ?? []);

  return (
    <Card>
      <div className="flex flex-col gap-4" data-testid="linked-accounts">
        <div>
          <h2 className="font-heading text-lg font-bold">{t('settings.accounts.title')}</h2>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('settings.accounts.hint')}</p>
        </div>

        {needsEmail ? <Alert tone="success">{t('settings.accounts.needsEmail')}</Alert> : null}
        {error ? <Alert>{error}</Alert> : null}

        {data ? (
          <ul className="flex flex-col gap-3">
            <li className="flex items-center justify-between gap-3">
              <span className="font-medium">{t('settings.accounts.password')}</span>
              <span data-testid="password-status" className="text-sm text-[var(--puls-ink-muted)]">
                {data.passwordSet
                  ? t('settings.accounts.passwordSet')
                  : t('settings.accounts.passwordMissing')}
              </span>
            </li>

            {PROVIDERS.map((provider) => {
              const isLinked = linked.has(provider);
              const enabled =
                provider === 'google' ? Boolean(providers?.google) : Boolean(providers?.telegram);
              if (!isLinked && !enabled) return null;

              return (
                <li
                  key={provider}
                  className="flex items-center justify-between gap-3"
                  data-testid={`identity-${provider}`}
                >
                  <span className="font-medium">{t(`settings.accounts.provider.${provider}`)}</span>

                  {isLinked ? (
                    <span className="flex items-center gap-3">
                      <span className="text-sm text-[var(--puls-ink-muted)]">
                        {t('settings.accounts.linked')}
                      </span>
                      <GhostButton
                        type="button"
                        data-testid={`unlink-${provider}`}
                        disabled={busy !== null}
                        onClick={() => void unlink(provider)}
                      >
                        {busy === provider
                          ? t('settings.accounts.unlinking')
                          : t('settings.accounts.unlink')}
                      </GhostButton>
                    </span>
                  ) : provider === 'google' ? (
                    <a
                      href={googleLinkUrl()}
                      data-testid="link-google"
                      className="flex h-12 items-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] px-6 font-semibold transition-opacity hover:opacity-80"
                    >
                      {t('settings.accounts.link')}
                    </a>
                  ) : providers?.telegramBotUsername ? (
                    <span className="flex items-center gap-3">
                      <span className="text-sm text-[var(--puls-ink-muted)]">
                        {t('settings.accounts.notLinked')}
                      </span>
                      <TelegramLoginButton
                        botUsername={providers.telegramBotUsername}
                        label={t('auth.providers.telegram')}
                        onAuth={(user) => {
                          if (busy === null) void linkTelegram(user);
                        }}
                      />
                    </span>
                  ) : (
                    <span className="text-sm text-[var(--puls-ink-muted)]">
                      {t('settings.accounts.notLinked')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('common.loading')}</p>
        )}
      </div>
    </Card>
  );
}
