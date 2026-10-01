// SPDX-License-Identifier: AGPL-3.0-or-later
import Link from 'next/link';
import type { Metadata } from 'next';
import { t } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/locale-server';

export const metadata: Metadata = {
  title: 'Puls',
  robots: { index: false },
};

/** Офлайн-страница PWA (ТЗ §7): отдаётся сервис-воркером, когда сети нет. */
export default async function OfflinePage() {
  const locale = await getRequestLocale();

  return (
    <main
      id="content"
      className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-10 text-center"
    >
      <h1 className="text-2xl font-extrabold">{t('offline.title', locale)}</h1>
      <p className="text-[var(--puls-ink-muted)]">{t('offline.body', locale)}</p>
      <Link
        href="/app"
        className="rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 py-3 font-semibold text-[var(--puls-on-primary)] transition-opacity duration-150 hover:opacity-90"
      >
        {t('offline.home', locale)}
      </Link>
    </main>
  );
}
