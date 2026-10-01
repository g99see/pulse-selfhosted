// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import type { Locale } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { LOCALE_NAMES } from '@/lib/locale';

const LOCALES: Locale[] = ['ru', 'en'];

/** Переключатель языка (ТЗ §6): радиогруппа доступна с клавиатуры. */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, t } = useT();

  return (
    <fieldset className={`flex flex-col gap-2 ${className}`}>
      <legend className="text-sm font-medium text-[var(--puls-ink-muted)]">
        {t('settings.language')}
      </legend>
      <div className="flex gap-1 rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 p-1">
        {LOCALES.map((item) => (
          <label
            key={item}
            className={`flex-1 cursor-pointer rounded-[8px] px-3 py-2 text-center text-sm transition-colors duration-150 focus-within:ring-2 focus-within:ring-[var(--puls-primary)]/50 ${
              locale === item
                ? 'bg-[var(--puls-primary)] font-semibold text-[var(--puls-on-primary)]'
                : 'hover:bg-[var(--puls-ink-muted)]/10'
            }`}
          >
            <input
              type="radio"
              name="puls-locale"
              value={item}
              checked={locale === item}
              onChange={() => setLocale(item)}
              className="sr-only"
            />
            {LOCALE_NAMES[item]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
