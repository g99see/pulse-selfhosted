// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useT } from '@/components/locale-provider';
import { useTheme } from '@/components/theme-provider';
import { THEME_MODES, type ThemeMode } from '@/lib/theme';

export const THEME_LABEL_KEYS: Record<ThemeMode, string> = {
  light: 'settings.theme.light',
  dark: 'settings.theme.dark',
  system: 'settings.theme.system',
};

/** Переключатель темы (ТЗ §8): радиогруппа, доступная с клавиатуры. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { t } = useT();
  const { mode, setMode } = useTheme();

  return (
    <fieldset className={`flex flex-col gap-2 ${className}`}>
      <legend className="text-sm font-medium text-[var(--puls-ink-muted)]">
        {t('settings.theme')}
      </legend>
      <div className="flex gap-1 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] p-1">
        {THEME_MODES.map((item) => (
          <label
            key={item}
            className={`flex-1 cursor-pointer rounded-[8px] px-3 py-2 text-center text-sm transition-colors duration-150 focus-within:ring-2 focus-within:ring-[var(--puls-primary)]/50 ${
              mode === item
                ? 'bg-[var(--puls-primary)] font-semibold text-[var(--puls-on-primary)]'
                : 'hover:bg-[var(--puls-ink-muted)]/10'
            }`}
          >
            <input
              type="radio"
              name="puls-theme"
              value={item}
              checked={mode === item}
              onChange={() => setMode(item)}
              className="sr-only"
            />
            {t(THEME_LABEL_KEYS[item])}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
