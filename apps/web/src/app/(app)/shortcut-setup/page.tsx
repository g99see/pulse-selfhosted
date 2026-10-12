// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/components/locale-provider';
import { Card, GhostButton } from '@/components/ui';

/**
 * `/shortcut-setup` (ТЗ §4, docs/SHORTCUTS-IPHONE.md): показывает базовый URL
 * пользователя и копируемые имена заголовков для действия «Get Contents of URL».
 * Секретов нет — токен пользователь подставляет сам.
 */
export default function ShortcutSetupPage() {
  const { t } = useT();
  const [baseUrl, setBaseUrl] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  const url = `${baseUrl}/api/v1/transactions/quick`;
  const rows: Array<[string, string]> = [
    [t('shortcutSetup.url'), url],
    ['Method', 'POST'],
    ['Content-Type', 'application/json'],
    ['Authorization', `Bearer ${t('settings.apiAccess.headersToken')}`],
    ['Idempotency-Key', '<UUID>'],
  ];

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-extrabold">{t('shortcutSetup.title')}</h1>
        <p className="mt-1 text-base text-[var(--puls-ink-muted)]">{t('shortcutSetup.hint')}</p>
      </div>

      <Card className="flex flex-col gap-3">
        {rows.map(([name, value]) => (
          <div key={name} className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-[var(--puls-ink-muted)]">
              {name}
            </span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[var(--radius-tile)] bg-[var(--puls-surface-2)] px-3 py-2 font-mono text-sm">
                {value}
              </code>
              <GhostButton
                type="button"
                className="min-h-11"
                onClick={() => void copy(value)}
                aria-label={`${t('settings.apiAccess.copy')}: ${name}`}
              >
                {copied === value ? t('settings.apiAccess.copied') : t('settings.apiAccess.copy')}
              </GhostButton>
            </div>
          </div>
        ))}
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('shortcutSetup.guide')}</p>
      </Card>
    </div>
  );
}
