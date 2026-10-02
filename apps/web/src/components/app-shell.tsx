// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { canModerate, type PublicUser } from '@puls/shared';
import { Icon, Logo, type IconName } from '@/components/icons';
import { useT } from '@/components/locale-provider';
import { QuickAddSheet } from '@/components/quick-add-sheet';
import { QuietModeHotkey, QuietModeToggle } from '@/components/quiet-mode-toggle';
import { aiApi } from '@/lib/ai-client';
import { authApi } from '@/lib/auth-client';
import { isLocale, localeFromCookieString } from '@/lib/locale';

interface NavItem {
  key: string;
  href: string;
  icon: IconName;
  testId?: string;
}

interface NavGroup {
  key: string;
  items: NavItem[];
}

/** Разделы кабинета по смыслу (docs/REDESIGN.md): день, деньги, самочувствие, люди, аккаунт. */
const GROUPS: NavGroup[] = [
  {
    key: 'app.nav.group.today',
    items: [
      { key: 'app.nav.home', href: '/app', icon: 'home' },
      { key: 'app.nav.insights', href: '/insights', icon: 'sparkle' },
      { key: 'app.nav.ai', href: '/ai', icon: 'bot', testId: 'nav-ai' },
    ],
  },
  {
    key: 'app.nav.group.money',
    items: [
      { key: 'app.nav.finance', href: '/finance', icon: 'wallet' },
      { key: 'app.nav.goals', href: '/goals', icon: 'target' },
      { key: 'app.nav.stats', href: '/stats', icon: 'chart' },
    ],
  },
  {
    key: 'app.nav.group.wellbeing',
    items: [
      { key: 'app.nav.checkin', href: '/checkin', icon: 'heart' },
      { key: 'app.nav.habits', href: '/habits', icon: 'check' },
      { key: 'app.nav.achievements', href: '/achievements', icon: 'trophy' },
      { key: 'app.nav.capsules', href: '/capsules', icon: 'capsule', testId: 'nav-capsules' },
    ],
  },
  {
    key: 'app.nav.group.community',
    items: [
      { key: 'app.nav.feed', href: '/feed', icon: 'feed' },
      { key: 'app.nav.challenges', href: '/challenges', icon: 'flag', testId: 'nav-challenges' },
      { key: 'app.nav.family', href: '/family', icon: 'users' },
    ],
  },
  {
    key: 'app.nav.group.account',
    items: [
      { key: 'app.nav.profile', href: '/app/profile', icon: 'user' },
      { key: 'app.nav.page', href: '/page-editor', icon: 'page' },
      { key: 'app.nav.settingsItem', href: '/settings', icon: 'settings' },
      { key: 'app.nav.moderation', href: '/moderation', icon: 'shield' },
      { key: 'app.nav.adminAi', href: '/admin/ai', icon: 'bot', testId: 'nav-admin-ai' },
    ],
  },
];

const TAB_HOME: NavItem = { key: 'app.nav.home', href: '/app', icon: 'home' };
const TAB_FINANCE: NavItem = { key: 'app.nav.finance', href: '/finance', icon: 'wallet' };
const TAB_CHECKIN: NavItem = { key: 'app.nav.checkin', href: '/checkin', icon: 'heart' };

/** Активен ли пункт для текущего пути: точное совпадение или вложенный маршрут. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(`${href}/`);
}

type Greeting = 'morning' | 'day' | 'evening' | 'night';

/** Каркас кабинета (ТЗ §8): боковое меню с группами на десктопе, нижняя панель + лист «Ещё» на телефоне. */
export function AppShell({ user, children }: { user: PublicUser; children: ReactNode }) {
  const { t, locale, setLocale } = useT();
  const router = useRouter();
  const pathname = usePathname() ?? '/app';
  const [greeting, setGreeting] = useState<Greeting>('day');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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

  // Лист «Ещё» закрывается при переходе и по Escape.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setMoreOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

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
  function visible(item: NavItem): boolean {
    if (item.key === 'app.nav.moderation') return canModerate(user.role);
    if (item.key === 'app.nav.ai') return aiEnabled;
    if (item.key === 'app.nav.adminAi') return user.role === 'admin';
    return true;
  }

  const groups = GROUPS.map((group) => ({ ...group, items: group.items.filter(visible) })).filter(
    (group) => group.items.length > 0,
  );

  function renderLink(item: NavItem, compact: boolean) {
    const active = isNavActive(item.href, pathname);
    return (
      <Link
        key={item.key}
        href={item.href}
        data-testid={item.testId}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 rounded-[var(--radius-button)] px-3 font-medium transition-colors duration-150 ${
          compact ? 'py-3' : 'py-2'
        } ${
          active
            ? 'bg-[var(--puls-primary-soft)] text-[var(--puls-primary-text)]'
            : 'text-[var(--puls-ink-muted)] hover:bg-[var(--puls-surface)] hover:text-[var(--puls-ink)]'
        }`}
      >
        <Icon name={item.icon} size={20} />
        <span>{t(item.key)}</span>
      </Link>
    );
  }

  const groupList = (compact: boolean) =>
    groups.map((group) => (
      <div key={group.key} className="flex flex-col gap-0.5">
        <p className="px-3 pt-3.5 pb-1 text-[11px] font-semibold tracking-wider text-[var(--puls-ink-muted)] uppercase">
          {t(group.key)}
        </p>
        {group.items.map((item) => renderLink(item, compact))}
      </div>
    ));

  const moreActive = ![TAB_HOME, TAB_FINANCE, TAB_CHECKIN].some((item) =>
    isNavActive(item.href, pathname),
  );

  return (
    <div className="puls-backdrop min-h-screen md:flex">
      {/* Десктоп: боковое меню с логотипом, «Добавить» и группами разделов. */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto md:px-4 md:py-5">
        <Link href="/app" className="mb-5 flex items-center gap-2.5 px-3">
          <Logo size={34} />
          <span className="font-heading text-xl font-extrabold">{t('brand.name')}</span>
        </Link>
        <button
          type="button"
          data-testid="quick-add-open"
          onClick={() => setAddOpen(true)}
          className="flex items-center justify-center gap-2 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 py-3 font-semibold text-[var(--puls-on-primary)] shadow-[0_10px_22px_-12px_var(--puls-primary)] transition-transform duration-150 active:translate-y-px"
        >
          <Icon name="plus" size={18} strokeWidth={2.4} />
          {t('app.nav.add')}
        </button>
        <nav aria-label={t('app.nav.primary')} className="mt-1 flex flex-col">
          {groupList(false)}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 pb-28 md:pb-0">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-5 pt-6 pb-4 md:px-8">
          <div className="flex items-center gap-3">
            <Link href="/app" className="md:hidden" aria-label={t('brand.name')}>
              <Logo size={36} />
            </Link>
            <div>
              <p className="text-sm text-[var(--puls-ink-muted)]">
                {t(`app.greeting.${greeting}`)}
              </p>
              <p className="font-heading text-lg font-extrabold">@{user.nickname}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <QuietModeToggle className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-3.5 text-sm font-medium shadow-sm transition-colors duration-150 hover:bg-[var(--puls-surface-2)]" />
            {/* Настройки всегда в шапке: на невысоких экранах пункт внизу бокового меню уходит за край. */}
            <Link
              href="/settings"
              data-testid="header-settings"
              aria-label={t('app.nav.settingsItem')}
              aria-current={isNavActive('/settings', pathname) ? 'page' : undefined}
              className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-3.5 text-sm font-medium shadow-sm transition-colors duration-150 hover:bg-[var(--puls-surface-2)]"
            >
              <Icon name="settings" size={18} />
              <span className="hidden sm:inline">{t('app.nav.settingsItem')}</span>
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              disabled={busy}
              aria-label={t('auth.logout')}
              className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-3.5 text-sm font-medium shadow-sm transition-colors duration-150 hover:bg-[var(--puls-surface-2)] disabled:opacity-50"
            >
              <Icon name="logout" size={18} />
              <span className="hidden sm:inline">{t('auth.logout')}</span>
            </button>
          </div>
        </header>

        <main id="content" className="mx-auto w-full max-w-5xl px-5 pb-12 md:px-8">
          {children}
        </main>
      </div>

      {/* Телефон: пять кнопок внизу, остальные разделы — в листе «Ещё». */}
      <nav
        aria-label={t('app.nav.primary')}
        className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 items-center rounded-[22px] bg-[var(--puls-surface)] px-1 py-1.5 shadow-[var(--puls-shadow-lift)] md:hidden"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <MobileTab
          item={TAB_HOME}
          active={isNavActive(TAB_HOME.href, pathname)}
          label={t(TAB_HOME.key)}
        />
        <MobileTab
          item={TAB_FINANCE}
          active={isNavActive(TAB_FINANCE.href, pathname)}
          label={t(TAB_FINANCE.key)}
        />
        <div className="flex justify-center">
          <button
            type="button"
            data-testid="quick-add-open"
            onClick={() => setAddOpen(true)}
            aria-label={t('app.nav.add')}
            className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[var(--puls-primary)] text-[var(--puls-on-primary)] shadow-[0_10px_22px_-10px_var(--puls-primary)]"
          >
            <Icon name="plus" size={24} strokeWidth={2.4} />
          </button>
        </div>
        <MobileTab
          item={TAB_CHECKIN}
          active={isNavActive(TAB_CHECKIN.href, pathname)}
          label={t(TAB_CHECKIN.key)}
        />
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          className={`flex flex-col items-center gap-0.5 rounded-[14px] py-1.5 text-[11px] font-semibold ${
            moreActive ? 'text-[var(--puls-primary-text)]' : 'text-[var(--puls-ink-muted)]'
          }`}
        >
          <Icon name="more" size={22} strokeWidth={3} />
          {t('app.nav.more')}
        </button>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label={t('app.nav.close')}
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('app.nav.moreTitle')}
            className="puls-sheet-in absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-[28px] bg-[var(--puls-bg)] px-4 pt-3 pb-8"
          >
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-[var(--puls-line-strong)]" />
            <div className="flex items-center justify-between px-3">
              <p className="font-heading text-lg font-extrabold">{t('app.nav.moreTitle')}</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label={t('app.nav.close')}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--puls-surface)]"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <nav aria-label={t('app.nav.moreTitle')}>{groupList(true)}</nav>
          </div>
        </div>
      ) : null}

      <QuickAddSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <QuietModeHotkey />
    </div>
  );
}

function MobileTab({ item, active, label }: { item: NavItem; active: boolean; label: string }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-col items-center gap-0.5 rounded-[14px] py-1.5 text-[11px] font-semibold ${
        active ? 'text-[var(--puls-primary-text)]' : 'text-[var(--puls-ink-muted)]'
      }`}
    >
      <Icon name={item.icon} size={22} />
      {label}
    </Link>
  );
}
