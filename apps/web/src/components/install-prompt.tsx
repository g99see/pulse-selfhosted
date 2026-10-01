// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/components/locale-provider';

/** Событие установки PWA в Chromium (не входит в стандартные типы DOM). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Кнопка «Установить» (ТЗ §7, §9: установка на Android и iOS 16.4+).
 * В Chromium ловим `beforeinstallprompt` и показываем свою кнопку;
 * если браузер события не даёт (iOS Safari), показываем подсказку.
 */
export function InstallPrompt({ className = '' }: { className?: string }) {
  const { t } = useT();
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Свой баннер вместо браузерного: установку запускает кнопка ниже.
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  }, [prompt]);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {installed ? (
        <p role="status" className="text-sm text-[var(--puls-finance-text)]">
          {t('settings.installed')}
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void install()}
            disabled={!prompt}
            className="h-12 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)] transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
          >
            {t('settings.install')}
          </button>
          <p className="text-xs text-[var(--puls-ink-muted)]">
            {prompt ? t('settings.installHint') : t('settings.installUnavailable')}
          </p>
        </>
      )}
    </div>
  );
}
