// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useBoundaryLocale } from '@/components/error-fallback';
import { t as translate } from '@/lib/i18n';

/**
 * Последняя граница ошибок (QA-2 D2): падение корневого layout. Заменяет
 * <html>/<body>, поэтому стили — инлайновые: CSS может не загрузиться.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useBoundaryLocale();
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(key, locale, params);

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          background: '#e9f0ea',
          color: '#0f2620',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div
          data-testid="global-error"
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>
            {t('error.boundary.title')}
          </h1>
          <p style={{ margin: 0, maxWidth: '28rem', fontSize: '1rem' }}>
            {t('error.boundary.text')}
          </p>
          {error.digest ? (
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#485d54' }}>
              {t('error.boundary.digest', { digest: error.digest })}
            </p>
          ) : null}
          <button
            type="button"
            data-testid="global-error-retry"
            onClick={reset}
            style={{
              minHeight: 48,
              padding: '0 1.5rem',
              borderRadius: 12,
              border: 'none',
              background: '#0d5c55',
              color: '#f4fbf8',
              fontWeight: 600,
              fontSize: '1rem',
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      </body>
    </html>
  );
}
