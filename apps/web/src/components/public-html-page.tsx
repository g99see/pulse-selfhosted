// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Публичная вкладка HTML-страницы профиля (ТЗ §3.8). Страница живёт на
 * отдельном домене песочницы и встраивается в iframe со строгим sandbox:
 * `allow-scripts` без `allow-same-origin` — скрипты работают, но браузер
 * считает фрейм чужим, поэтому cookie и данные основного сайта недоступны.
 * `referrerPolicy="no-referrer"` не отдаёт наружу адрес профиля.
 */
import { sandboxPageUrl } from '@/lib/html-page-client';
import { t } from '@/lib/i18n';

export interface PublicHtmlPageProps {
  /** Никнейм владельца: /@nickname/page и путь /sandbox/:nickname. */
  nickname: string;
  /** Абсолютный адрес из API (page.sandboxUrl); если нет — соберём из базы. */
  sandboxUrl?: string | null;
  className?: string;
}

/** Встроенный просмотр пользовательской HTML-страницы в изолированном iframe. */
export function PublicHtmlPage({ nickname, sandboxUrl, className }: PublicHtmlPageProps) {
  const source = sandboxPageUrl(sandboxUrl ?? `/sandbox/${nickname}`);

  return (
    <div className={className} data-testid="public-html-page">
      <iframe
        data-testid="public-html-frame"
        src={source}
        title={t('htmlPage.viewer.title')}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
        className="h-[70vh] w-full rounded-[var(--radius-card)] border border-[var(--puls-line)] bg-white shadow-sm"
      />
      <p className="mt-2 text-xs text-[var(--puls-ink-muted)]">
        <a
          href={source}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-[var(--puls-primary-text)] underline"
        >
          {t('htmlPage.viewer.open')}
        </a>
      </p>
    </div>
  );
}
