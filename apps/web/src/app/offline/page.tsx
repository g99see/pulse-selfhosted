// SPDX-License-Identifier: AGPL-3.0-or-later
import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';
import { Card, EmptyState } from '@/components/ui';
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
    <AuthShell brand={t('landing.brand', locale)}>
      <Card>
        <EmptyState
          icon="pulse"
          tone="primary"
          as="h1"
          title={<span className="text-2xl font-extrabold">{t('offline.title', locale)}</span>}
          text={t('offline.body', locale)}
          action={
            <Link
              href="/app"
              className="inline-flex h-12 items-center rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)] shadow-[0_8px_18px_-10px_var(--puls-primary)] transition-opacity duration-150 hover:opacity-95"
            >
              {t('offline.home', locale)}
            </Link>
          }
        />
      </Card>
    </AuthShell>
  );
}
