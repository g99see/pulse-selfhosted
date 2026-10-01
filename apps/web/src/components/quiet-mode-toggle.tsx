// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

/**
 * Переключатель режима «Тишина» и его горячая клавиша (ТЗ §4, P1).
 * Кнопка — с aria-pressed; при монтировании в каркасе регистрируется Alt+Q,
 * а смена состояния объявляется скринридеру через вежливый live-region.
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale-provider';
import { toggleQuietMode, useQuietMode } from '@/lib/use-quiet-mode';

export interface QuietModeToggleProps {
  className?: string;
  testId?: string;
}

/** Кнопка «Тишина»: скрывает или возвращает суммы. */
export function QuietModeToggle({ className, testId = 'quiet-toggle' }: QuietModeToggleProps) {
  const { t } = useT();
  const quiet = useQuietMode();

  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={quiet}
      aria-label={t('quiet.toggle')}
      title={t('quiet.toggle')}
      onClick={() => toggleQuietMode()}
      className={
        className ??
        'rounded-[var(--radius-button)] border px-3 py-2 text-sm font-medium transition-colors duration-150'
      }
    >
      <Icon name={quiet ? 'eyeOff' : 'eye'} size={18} />{' '}
      <span className={quiet ? 'font-semibold text-[var(--puls-primary-text)]' : undefined}>
        {t('quiet.label')}
      </span>
    </button>
  );
}

/**
 * Горячая клавиша Alt+Q и объявление смены состояния. Монтируется один раз в
 * каркасе кабинета; сама ничего не рисует, кроме скрытого live-region.
 */
export function QuietModeHotkey() {
  const { t } = useT();
  const quiet = useQuietMode();
  const [announce, setAnnounce] = useState('');

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.repeat || !event.altKey) return;
    if (event.code !== 'KeyQ') return;
    event.preventDefault();
    toggleQuietMode();
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    setAnnounce(quiet ? t('quiet.announceOn') : t('quiet.announceOff'));
  }, [quiet, t]);

  return (
    <p aria-live="polite" role="status" className="sr-only" data-testid="quiet-announcement">
      {announce}
    </p>
  );
}
