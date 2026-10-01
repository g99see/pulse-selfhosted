// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Публичная вкладка HTML-страницы (ТЗ §3.8): короткий адрес
 * `/<домен>/@nickname/page`. Next.js резервирует `@` за parallel routes,
 * поэтому литеральный `@` в дереве маршрутов выразить нельзя — браузерный
 * адрес `/@nickname/page` приходит сюда через rewrite в next.config.mjs.
 *
 * Страница показывает пользовательский HTML в изолированном iframe с домена
 * песочницы (`sandbox="allow-scripts"`, `referrerPolicy="no-referrer"`).
 */
import { notFound } from 'next/navigation';
import { NICKNAME_REGEX } from '@puls/shared';
import { t } from '@/lib/i18n';
import { PublicHtmlPage } from '@/components/public-html-page';

export const dynamic = 'force-dynamic';

export default async function PublicHtmlPageRoute({
  params,
}: {
  params: Promise<{ nickname: string }>;
}) {
  const { nickname } = await params;
  const handle = nickname.replace(/^@/, '').toLowerCase();
  if (!NICKNAME_REGEX.test(handle)) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <h1 className="mb-4 text-2xl font-extrabold">
        @{handle} · {t('htmlPage.viewer.title')}
      </h1>
      <PublicHtmlPage nickname={handle} />
    </main>
  );
}
