// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { Locale, PublicUser } from '@puls/shared';
import { authApi } from '@/lib/auth-client';
import { t } from '@/lib/i18n';

const NAV: Array<{ key: string; href: string | null }> = [
  { key: 'app.nav.home', href: '/app' },
  { key: 'app.nav.finance', href: null },
  { key: 'app.nav.add', href: null },
  { key: 'app.nav.stats', href: null },
  { key: 'app.nav.profile', href: null },
];

type Greeting = 'morning' | 'day' | 'evening' | 'night';

/** Каркас кабинета (ТЗ §8): нижняя навигация на мобильном, боковая на десктопе. */
export function AppShell({ user, children }: { user: PublicUser; children: ReactNode }) {
  const router = useRouter();
  const locale: Locale = user.locale === 'en' ? 'en' : 'ru';
  const [greeting, setGreeting] = useState<Greeting>('day');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'day' : 'evening');
  }, []);

  async function logout(): Promise<void> {
    setBusy(true);
    try {
      await authApi.logout();
    } finally {
      router.push('/login');
    }
  }

  const items = NAV.map((item) =>
    item.href ? (
      <Link
        key={item.key}
        href={item.href}
        className="rounded-[var(--radius-button)] px-4 py-3 text-center font-medium text-[var(--puls-primary)]"
      >
        {t(item.key, locale)}
      </Link>
    ) : (
      <span
        key={item.key}
        aria-disabled="true"
        title={t('app.nav.soon', locale)}
        className="rounded-[var(--radius-button)] px-4 py-3 text-center text-[var(--puls-ink-muted)]/60"
      >
        {t(item.key, locale)}
      </span>
    ),
  );

  return (
    <div className="min-h-screen md:flex">
      <nav aria-label={t('app.nav.home', locale)} className="hidden md:flex md:w-56 md:flex-col md:gap-1 md:p-5">
        {items}
      </nav>

      <div className="flex-1 pb-20 md:pb-0">
        <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-5 py-6">
          <div>
            <p className="text-sm text-[var(--puls-ink-muted)]">
              {t(`app.greeting.${greeting}`, locale)}
            </p>
            <p className="text-lg font-bold">@{user.nickname}</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={busy}
            className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {t('auth.logout', locale)}
          </button>
        </header>

        <main className="mx-auto w-full max-w-3xl px-5 pb-10">{children}</main>
      </div>

      <nav
        aria-label={t('app.nav.home', locale)}
        className="fixed inset-x-0 bottom-0 flex justify-between border-t border-[var(--puls-ink-muted)]/20 bg-[var(--puls-surface)] px-2 md:hidden"
      >
        {items}
      </nav>
    </div>
  );
}
