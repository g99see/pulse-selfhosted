// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IdentitiesResponse, ProvidersResponse } from '@puls/shared';
import { Alert, Card, GhostButton } from '@/components/ui';
import { useT } from '@/components/locale-provider';
import { AuthApiError, authApi, googleLinkUrl } from '@/lib/auth-client';

type ProviderId = 'google';

/**
 * Секция «Способы входа» на /settings (ТЗ §3.1, §7): пароль, привязка и отвязка
 * Google. Вход через Telegram удалён в v3 §7.3. Отвязать единственный способ
 * входа нельзя — API вернёт last_login_method, и мы показываем объяснение.
 */
export function LinkedAccountsSection() {
  const { t } = useT();

  const [data, setData] = useState<IdentitiesResponse | null>(null);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ProviderId | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [identities, availability] = await Promise.all([
        authApi.identities(),
        authApi.providers(),
      ]);
      setData(identities);
      setProviders(availability);
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

  const googleLinked = new Set(data?.identities.map((identity) => identity.provider) ?? []).has(
    'google',
  );

  return (
    <Card>
      <div className="flex flex-col gap-4" data-testid="linked-accounts">
        <div>
          <h2 className="font-heading text-lg font-bold">{t('settings.accounts.title')}</h2>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('settings.accounts.hint')}</p>
        </div>

        {error ? <Alert>{error}</Alert> : null}
        {data && !data.passwordSet ? (
          <Alert>{t('settings.accounts.setPasswordBanner')}</Alert>
        ) : null}

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

            {googleLinked || providers?.google ? (
              <li className="flex items-center justify-between gap-3" data-testid="identity-google">
                <span className="font-medium">{t('settings.accounts.provider.google')}</span>

                {googleLinked ? (
                  <span className="flex items-center gap-3">
                    <span className="text-sm text-[var(--puls-ink-muted)]">
                      {t('settings.accounts.linked')}
                    </span>
                    <GhostButton
                      type="button"
                      data-testid="unlink-google"
                      disabled={busy !== null}
                      onClick={() => void unlink('google')}
                    >
                      {busy === 'google'
                        ? t('settings.accounts.unlinking')
                        : t('settings.accounts.unlink')}
                    </GhostButton>
                  </span>
                ) : (
                  <a
                    href={googleLinkUrl()}
                    data-testid="link-google"
                    className="flex h-12 items-center rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] px-6 font-semibold transition-opacity hover:opacity-80"
                  >
                    {t('settings.accounts.link')}
                  </a>
                )}
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('common.loading')}</p>
        )}
      </div>
    </Card>
  );
}
