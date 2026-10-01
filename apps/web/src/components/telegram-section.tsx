// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import type { TelegramLinkCodeResponse, TelegramStatusResponse } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, GhostButton, PrimaryButton } from '@/components/ui';
import { telegramApi } from '@/lib/telegram-client';

/**
 * Секция «Telegram» в настройках (ТЗ §3.6, §4): привязка чата одноразовым
 * кодом и отвязка. Без токена на сервере секция честно сообщает, что бот
 * выключен. Живёт на странице /settings.
 */
export function TelegramSection() {
  const { t } = useT();

  const [status, setStatus] = useState<TelegramStatusResponse | null>(null);
  const [code, setCode] = useState<TelegramLinkCodeResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Первичная загрузка статуса привязки.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await telegramApi.status();
        if (active) setStatus(next);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function refresh(): Promise<void> {
    try {
      setStatus(await telegramApi.status());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  async function requestCode(): Promise<void> {
    setBusy(true);
    setCopied(false);
    try {
      setCode(await telegramApi.linkCode());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(): Promise<void> {
    setBusy(true);
    try {
      await telegramApi.unlink();
      setCode(null);
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function copyCode(): Promise<void> {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <div data-testid="telegram-section" className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-bold">{t('settings.telegram.title')}</h2>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('settings.telegram.hint')}</p>
        </div>

        {failed ? <Alert>{t('settings.telegram.error')}</Alert> : null}

        {status && !status.enabled ? (
          <p data-testid="telegram-disabled" className="text-sm text-[var(--puls-ink-muted)]">
            {t('settings.telegram.disabled')}
          </p>
        ) : null}

        {status?.enabled && status.linked ? (
          <div className="flex flex-col gap-3">
            <p data-testid="telegram-linked" className="text-sm">
              {t('settings.telegram.linked', {
                chat: status.chatUsername
                  ? `@${status.chatUsername}`
                  : t('settings.telegram.chatHidden'),
              })}
            </p>
            <GhostButton
              type="button"
              data-testid="telegram-unlink"
              disabled={busy}
              onClick={() => void unlink()}
            >
              {t('settings.telegram.unlink')}
            </GhostButton>
          </div>
        ) : null}

        {status?.enabled && !status.linked ? (
          <div className="flex flex-col gap-3">
            <p data-testid="telegram-unlinked" className="text-sm text-[var(--puls-ink-muted)]">
              {t('settings.telegram.unlinked')}
            </p>
            <div className="flex flex-wrap gap-3">
              <PrimaryButton
                type="button"
                data-testid="telegram-link"
                disabled={busy}
                onClick={() => void requestCode()}
              >
                {code ? t('settings.telegram.newCode') : t('settings.telegram.link')}
              </PrimaryButton>
              <GhostButton
                type="button"
                data-testid="telegram-refresh"
                disabled={busy}
                onClick={() => void refresh()}
              >
                {t('settings.telegram.refresh')}
              </GhostButton>
            </div>

            {code ? (
              <div className="flex flex-col gap-2 rounded-[20px] bg-[var(--puls-surface-2)] p-4">
                <p className="text-sm font-medium">{t('settings.telegram.codeTitle')}</p>
                <p
                  data-testid="telegram-code"
                  className="font-mono text-2xl font-bold tracking-wider"
                >
                  {code.code}
                </p>
                <p className="text-xs text-[var(--puls-ink-muted)]">
                  {t('settings.telegram.codeHint', { code: code.code })}
                </p>
                <p className="text-xs text-[var(--puls-ink-muted)]">
                  {t('settings.telegram.ttl', { minutes: Math.round(code.ttlSeconds / 60) })}
                </p>
                <GhostButton
                  type="button"
                  data-testid="telegram-copy"
                  onClick={() => void copyCode()}
                >
                  {copied ? t('settings.telegram.copied') : t('settings.telegram.copy')}
                </GhostButton>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
