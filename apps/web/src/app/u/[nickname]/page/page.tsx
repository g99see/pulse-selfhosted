// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Публичная HTML-страница профиля — отдельная вкладка (ТЗ §3.8):
 * короткий адрес `/@nickname/page`. Символ `@` зарезервирован Next за
 * parallel routes, поэтому адрес приходит сюда rewrite'ом из next.config.mjs
 * (`/@:nickname/page` → `/u/:nickname/page`) — рядом с публичным профилем
 * `/u/:nickname` (блок A).
 *
 * Страница показывает пользовательский HTML в изолированном iframe с домена
 * песочницы (`sandbox="allow-scripts"`, `referrerPolicy="no-referrer"`).
 */
import { notFound } from 'next/navigation';
import { NICKNAME_REGEX } from '@puls/shared';
import { PublicHtmlPage } from '@/components/public-html-page';
import { t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function PublicHtmlPageTab({
  params,
}: {
  params: Promise<{ nickname: string }>;
}) {
  const { nickname } = await params;
  const handle = nickname.replace(/^@/, '').toLowerCase();
  if (!NICKNAME_REGEX.test(handle)) notFound();

  return (
    <main className="puls-backdrop mx-auto min-h-screen w-full max-w-3xl px-5 py-8">
      <h1 className="mb-4 font-heading text-2xl font-extrabold">
        @{handle} · {t('htmlPage.viewer.title')}
      </h1>
      <PublicHtmlPage nickname={handle} />
    </main>
  );
}
