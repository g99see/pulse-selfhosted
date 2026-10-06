// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DaySummaryLinkDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, GhostButton, PrimaryButton } from '@/components/ui';
import { daySummaryApi } from '@/lib/v2-client';

/**
 * Секция настроек «Итог дня по ссылке» (ТЗ v2 §7): создать или отозвать
 * приватную ссылку. Токен показывается один раз — после перезагрузки ссылку
 * можно только перевыпустить.
 */
export function DaySummarySection() {
  const { t } = useT();
  const [status, setStatus] = useState<DaySummaryLinkDto | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await daySummaryApi.status());
    } catch {
      setError(t('daySummary.error'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await daySummaryApi.create();
      setUrl(`${window.location.origin}${created.path}`);
      setStatus({ active: true, createdAt: created.createdAt });
    } catch {
      setError(t('daySummary.error'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await daySummaryApi.revoke();
      setUrl(null);
      setStatus({ active: false, createdAt: null });
    } catch {
      setError(t('daySummary.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="day-summary-settings">
      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{t('daySummary.settings.title')}</h2>
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('daySummary.settings.hint')}</p>
        {error ? <Alert>{error}</Alert> : null}
        {url ? (
          <div className="flex flex-col gap-1">
            <input
              readOnly
              value={url}
              aria-label={t('daySummary.settings.link')}
              data-testid="day-summary-url"
              onFocus={(event) => event.currentTarget.select()}
              className="h-11 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3 text-sm"
            />
            <p className="text-xs text-[var(--puls-ink-muted)]">{t('daySummary.settings.once')}</p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <PrimaryButton
            type="button"
            disabled={busy || status === null}
            onClick={() => void create()}
            data-testid="day-summary-create"
          >
            {status?.active ? t('daySummary.settings.reissue') : t('daySummary.settings.create')}
          </PrimaryButton>
          {status?.active ? (
            <GhostButton
              type="button"
              disabled={busy}
              onClick={() => void revoke()}
              data-testid="day-summary-revoke"
            >
              {t('daySummary.settings.revoke')}
            </GhostButton>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
