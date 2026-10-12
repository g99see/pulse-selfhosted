// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { parseQuickTransaction } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Card } from '@/components/ui';
import { financeApi, notifyFinanceChanged } from '@/lib/finance-client';

/**
 * Страница `/quick` (ТЗ §4, docs/MONEY-INPUT.md): мобильный ввод траты одной
 * строкой через cookie-сессию — резерв к шорткату и цель «на домашний экран».
 * Крупные элементы (≥44px), шрифт ≥16px (iOS не зумит поле), учёт safe-area.
 */
export default function QuickPage() {
  const { t } = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  // Подсказка «на домашний экран» — только в Safari на iPhone вне standalone-режима.
  useEffect(() => {
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    const dismissed = window.localStorage.getItem('puls.quick.homeHint') === '1';
    setShowIosHint(isIos && !standalone && !dismissed);
  }, []);

  function dismissHint(): void {
    window.localStorage.setItem('puls.quick.homeHint', '1');
    setShowIosHint(false);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const value = text.trim();
    setError(null);
    setDone(null);
    setNotice(null);

    const parsed = parseQuickTransaction(value);
    if (!value || !parsed) {
      setError(t('quick.error'));
      return;
    }

    setBusy(true);
    try {
      await financeApi.quickTransaction(value);
      notifyFinanceChanged();
      setDone(value);
      setText('');
    } catch {
      setError(t('quick.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col gap-4"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div>
        <h1 className="font-heading text-2xl font-extrabold">{t('quick.title')}</h1>
        <p className="mt-1 text-base text-[var(--puls-ink-muted)]">{t('quick.hint')}</p>
      </div>

      {showIosHint ? (
        <Card className="flex flex-col gap-3">
          <p className="text-base font-semibold">{t('quick.addToHome')}</p>
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('quick.addToHomeHint')}</p>
          <button
            type="button"
            onClick={dismissHint}
            className="min-h-11 self-start rounded-[var(--radius-button)] bg-[var(--puls-surface-2)] px-4 text-sm font-medium"
          >
            {t('quick.addToHomeDismiss')}
          </button>
        </Card>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <label htmlFor="quick-input" className="flex flex-col gap-2">
          <span className="text-base font-medium">{t('quick.placeholder')}</span>
          <input
            id="quick-input"
            data-testid="quick-input"
            // 16px и выше: iOS Safari не приближает страницу при фокусе.
            className="min-h-14 rounded-[var(--radius-button)] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface)] px-4 text-lg outline-none focus:border-[var(--puls-primary)] focus:ring-4 focus:ring-[var(--puls-primary)]/20"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('quick.example')}
            autoComplete="off"
            autoFocus
            enterKeyHint="done"
            inputMode="text"
          />
        </label>

        <button
          type="submit"
          data-testid="quick-submit"
          disabled={busy || text.trim().length === 0}
          className="min-h-14 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 text-lg font-semibold text-[var(--puls-on-primary)] puls-key disabled:opacity-50"
        >
          {busy ? t('quick.saving') : t('quick.submit')}
        </button>
      </form>

      {done ? (
        <p
          role="status"
          data-testid="quick-done"
          className="rounded-[var(--radius-button)] bg-[var(--puls-finance-soft)] px-4 py-3 text-base text-[var(--puls-finance-text)]"
        >
          {t('quick.done', { text: done })}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-base text-[var(--puls-ink-muted)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          data-testid="quick-error"
          className="rounded-[var(--radius-button)] bg-[var(--puls-warning-soft)] px-4 py-3 text-base text-[var(--puls-warning-text)]"
        >
          {error}
        </p>
      ) : null}

      <p className="text-sm text-[var(--puls-ink-muted)]">
        <Link href="/shortcut-setup" className="underline">
          {t('shortcutSetup.title')}
        </Link>
      </p>
    </div>
  );
}
