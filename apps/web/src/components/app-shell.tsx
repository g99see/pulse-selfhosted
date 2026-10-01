// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { PublicUser } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { QuickAddSheet } from '@/components/quick-add-sheet';
import { authApi } from '@/lib/auth-client';
import { isLocale, localeFromCookieString } from '@/lib/locale';

const NAV: Array<{ key: string; href: string | null }> = [
  { key: 'app.nav.home', href: '/app' },
  { key: 'app.nav.finance', href: '/finance' },
  { key: 'app.nav.add', href: null },
  { key: 'app.nav.stats', href: '/stats' },
  { key: 'app.nav.profile', href: '/app/profile' },
];

type Greeting = 'morning' | 'day' | 'evening' | 'night';

/** Каркас кабинета (ТЗ §8): нижняя навигация на мобильном, боковая на десктопе. */
export function AppShell({ user, children }: { user: PublicUser; children: ReactNode }) {
  const { t, locale, setLocale } = useT();
  const router = useRouter();
  const [greeting, setGreeting] = useState<Greeting>('day');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'day' : 'evening');
  }, []);

  // Если язык ещё не выбран в браузере, берём его из профиля пользователя (ТЗ §6).
  useEffect(() => {
    if (localeFromCookieString(document.cookie)) return;
    if (isLocale(user.locale) && user.locale !== locale) setLocale(user.locale);
  }, [locale, setLocale, user.locale]);

  async function logout(): Promise<void> {
    setBusy(true);
    try {
      await authApi.logout();
    } finally {
      router.push('/login');
    }
  }

  const items = NAV.map((item) =>
    item.key === 'app.nav.add' ? (
      <button
        key={item.key}
        type="button"
        data-testid="quick-add-open"
        onClick={() => setAddOpen(true)}
        className="rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 py-3 text-center font-semibold text-white"
      >
        {t(item.key)}
      </button>
    ) : item.href ? (
      <Link
        key={item.key}
        href={item.href}
        aria-current={item.href === '/app' ? 'page' : undefined}
        className="rounded-[var(--radius-button)] px-4 py-3 text-center font-medium text-[var(--puls-primary-text)]"
      >
        {t(item.key)}
      </Link>
    ) : (
      <span
        key={item.key}
        aria-disabled="true"
        title={t('app.nav.soon')}
        className="rounded-[var(--radius-button)] px-4 py-3 text-center text-[var(--puls-ink-muted)]/60"
      >
        {t(item.key)}
      </span>
    ),
  );

  return (
    <div className="min-h-screen md:flex">
      <nav
        aria-label={t('app.nav.primary')}
        className="hidden md:flex md:w-56 md:flex-col md:gap-1 md:p-5"
      >
        {items}
      </nav>

      <div className="flex-1 pb-20 md:pb-0">
        <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-5 py-6">
          <div>
            <p className="text-sm text-[var(--puls-ink-muted)]">{t(`app.greeting.${greeting}`)}</p>
            <p className="text-lg font-bold">@{user.nickname}</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={busy}
            className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-4 py-2 text-sm font-medium transition-colors duration-150 hover:bg-[var(--puls-ink-muted)]/10 disabled:opacity-50"
          >
            {t('auth.logout')}
          </button>
        </header>

        <main id="content" className="mx-auto w-full max-w-3xl px-5 pb-10">
          {children}
        </main>
      </div>

      <nav
        aria-label={t('app.nav.primary')}
        className="fixed inset-x-0 bottom-0 flex justify-between border-t border-[var(--puls-ink-muted)]/20 bg-[var(--puls-surface)] px-2 md:hidden"
      >
        {items}
      </nav>

      <QuickAddSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
