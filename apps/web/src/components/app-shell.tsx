// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { canModerate, type PublicUser } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { QuickAddSheet } from '@/components/quick-add-sheet';
import { QuietModeHotkey, QuietModeToggle } from '@/components/quiet-mode-toggle';
import { aiApi } from '@/lib/ai-client';
import { authApi } from '@/lib/auth-client';
import { isLocale, localeFromCookieString } from '@/lib/locale';

const NAV: Array<{ key: string; href: string | null; testId?: string }> = [
  { key: 'app.nav.home', href: '/app' },
  { key: 'app.nav.finance', href: '/finance' },
  { key: 'app.nav.add', href: null },
  { key: 'app.nav.stats', href: '/stats' },
  { key: 'app.nav.habits', href: '/habits' },
  { key: 'app.nav.insights', href: '/insights' },
  { key: 'app.nav.achievements', href: '/achievements' },
  { key: 'app.nav.feed', href: '/feed' },
  { key: 'app.nav.family', href: '/family' },
  { key: 'app.nav.challenges', href: '/challenges', testId: 'nav-challenges' },
  { key: 'app.nav.ai', href: '/ai', testId: 'nav-ai' },
  { key: 'app.nav.moderation', href: '/moderation' },
  { key: 'app.nav.adminAi', href: '/admin/ai', testId: 'nav-admin-ai' },
  { key: 'app.nav.profile', href: '/app/profile' },
  { key: 'app.nav.page', href: '/page-editor' },
];

type Greeting = 'morning' | 'day' | 'evening' | 'night';

/** Каркас кабинета (ТЗ §8): нижняя навигация на мобильном, боковая на десктопе. */
export function AppShell({ user, children }: { user: PublicUser; children: ReactNode }) {
  const { t, locale, setLocale } = useT();
  const router = useRouter();
  const [greeting, setGreeting] = useState<Greeting>('day');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // AI-функции видны только при подключённом ключе (ТЗ §3.9): лёгкий запрос
  // статуса при загрузке кабинета; при ошибке считаем AI выключенным.
  const [aiEnabled, setAiEnabled] = useState(false);

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'day' : 'evening');
  }, []);

  useEffect(() => {
    void aiApi
      .status()
      .then((response) => setAiEnabled(response.status.enabled))
      .catch(() => setAiEnabled(false));
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

  // Ссылку на модерацию видят только модератор и администратор (ТЗ §2, §3.8);
  // AI — только при подключённом ключе (ТЗ §3.9), админку AI — только админ.
  const items = NAV.filter((item) => {
    if (item.key === 'app.nav.moderation') return canModerate(user.role);
    if (item.key === 'app.nav.ai') return aiEnabled;
    if (item.key === 'app.nav.adminAi') return user.role === 'admin';
    return true;
  }).map((item) =>
    item.key === 'app.nav.add' ? (
      <button
        key={item.key}
        type="button"
        data-testid="quick-add-open"
        onClick={() => setAddOpen(true)}
        className="rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 py-3 text-center font-semibold text-[var(--puls-on-primary)]"
      >
        {t(item.key)}
      </button>
    ) : item.href ? (
      <Link
        key={item.key}
        href={item.href}
        data-testid={item.testId}
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
          <div className="flex items-center gap-2">
            <QuietModeToggle className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-[var(--puls-ink-muted)]/10" />
            <button
              type="button"
              onClick={() => void logout()}
              disabled={busy}
              className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-4 py-2 text-sm font-medium transition-colors duration-150 hover:bg-[var(--puls-ink-muted)]/10 disabled:opacity-50"
            >
              {t('auth.logout')}
            </button>
          </div>
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
      <QuietModeHotkey />
    </div>
  );
}
