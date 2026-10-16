// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@puls/shared';
import { IconBubble } from '@/components/ui';
import { DEFAULT_LOCALE, t as translate } from '@/lib/i18n';
import { localeFromCookieString, resolveLocale } from '@/lib/locale';

/**
 * Экраны ошибок (QA-2 D2). Вместо сырой страницы Next «Application error»
 * пользователь видит понятный текст, код ошибки для поддержки и кнопку повтора.
 *
 * Локаль берём напрямую из cookie/языка браузера: эти компоненты рисуются и
 * там, где провайдер локали недоступен (root-error, global-error).
 */
export function useBoundaryLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      setLocale(
        resolveLocale({
          cookie: localeFromCookieString(document.cookie),
          acceptLanguage: navigator.language,
        }),
      );
    } catch {
      // Остаёмся на языке по умолчанию — экран ошибки не должен падать сам.
    }
  }, []);

  return locale;
}

/** Границы ошибок сегментов: `app/error.tsx` и `(app)/error.tsx`. */
export function ErrorFallback({
  digest,
  reset,
  testId = 'error-boundary',
}: {
  digest?: string;
  reset: () => void;
  testId?: string;
}) {
  const locale = useBoundaryLocale();
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(key, locale, params);

  return (
    <div
      data-testid={testId}
      role="alert"
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 py-16 text-center"
    >
      <IconBubble name="heart" tone="warning" size={44} />
      <h1 className="font-heading text-2xl font-extrabold">{t('error.boundary.title')}</h1>
      <p className="max-w-md text-base text-[var(--puls-ink-muted)]">{t('error.boundary.text')}</p>
      {digest ? (
        <p className="text-sm text-[var(--puls-ink-muted)]">
          {t('error.boundary.digest', { digest })}
        </p>
      ) : null}
      <button
        type="button"
        data-testid={`${testId}-retry`}
        onClick={reset}
        className="h-12 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)]"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}

/**
 * API недоступен (QA-2 D2): серверный guard кабинета не смог получить
 * пользователя. Показываем это вместо исключения в рендере.
 */
export function ServiceUnavailable({ testId = 'api-unavailable' }: { testId?: string }) {
  const locale = useBoundaryLocale();
  const t = (key: string) => translate(key, locale);

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-16 text-center"
    >
      <IconBubble name="heart" tone="warning" size={44} />
      <h1 className="font-heading text-2xl font-extrabold">{t('error.unavailable.title')}</h1>
      <p className="max-w-md text-base text-[var(--puls-ink-muted)]">
        {t('error.unavailable.text')}
      </p>
      <button
        type="button"
        data-testid={`${testId}-retry`}
        onClick={() => window.location.reload()}
        className="h-12 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)]"
      >
        {t('error.unavailable.reload')}
      </button>
    </div>
  );
}
