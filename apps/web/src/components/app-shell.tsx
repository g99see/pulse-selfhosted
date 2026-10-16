// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  CHECKIN_DAY_END_HOUR,
  SLEEP_MORNING_END_HOUR,
  SLEEP_MORNING_START_HOUR,
  type PublicUser,
} from '@puls/shared';
import { Icon, Logo, type IconName } from '@/components/icons';
import { useT } from '@/components/locale-provider';
import { QuickAddSheet } from '@/components/quick-add-sheet';
import { QuietModeHotkey, QuietModeToggle } from '@/components/quiet-mode-toggle';
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
  /** Ключ i18n видимой пометки рядом с заголовком группы (Фаза 0, §5). */
  badgeKey?: string;
  items: NavItem[];
}

/**
 * Разделы кабинета по смыслу (Фаза 0, §5): «Самочувствие» — первая группа,
 * «Деньги» — внизу и с пометкой «TODO: переделать». Финансы не прячем и не
 * удаляем — только понижаем в иерархии.
 */
const GROUPS: NavGroup[] = [
  {
    key: 'app.nav.group.wellbeing',
    items: [
      { key: 'app.nav.checkin', href: '/checkin', icon: 'heart', testId: 'nav-checkin' },
      { key: 'app.nav.habits', href: '/habits', icon: 'check', testId: 'nav-habits' },
      {
        key: 'app.nav.achievements',
        href: '/achievements',
        icon: 'trophy',
        testId: 'nav-achievements',
      },
      { key: 'app.nav.insights', href: '/insights', icon: 'sparkle', testId: 'nav-insights' },
      { key: 'app.nav.capsules', href: '/capsules', icon: 'capsule', testId: 'nav-capsules' },
    ],
  },
  {
    key: 'app.nav.group.today',
    items: [
      { key: 'app.nav.home', href: '/app', icon: 'home', testId: 'nav-home' },
      { key: 'app.nav.ai', href: '/ai', icon: 'bot', testId: 'nav-ai' },
    ],
  },
  {
    key: 'app.nav.group.account',
    items: [
      { key: 'app.nav.profile', href: '/app/profile', icon: 'user', testId: 'nav-profile' },
      { key: 'app.nav.settingsItem', href: '/settings', icon: 'settings', testId: 'nav-settings' },
      { key: 'app.nav.adminAi', href: '/admin/ai', icon: 'bot', testId: 'nav-admin-ai' },
      {
        key: 'app.nav.adminMetrics',
        href: '/admin/metrics',
        icon: 'chart',
        testId: 'nav-admin-metrics',
      },
    ],
  },
  {
    key: 'app.nav.group.money',
    badgeKey: 'app.nav.todoFinance',
    items: [
      { key: 'app.nav.finance', href: '/finance', icon: 'wallet', testId: 'nav-finance' },
      { key: 'app.nav.goals', href: '/goals', icon: 'target', testId: 'nav-goals' },
      { key: 'app.nav.stats', href: '/stats', icon: 'chart', testId: 'nav-stats' },
    ],
  },
];

/** Событие «открыть быстрый ввод»: его шлют кнопки на экранах, шторкой владеет каркас. */
export const QUICK_ADD_EVENT = 'puls:quick-add';

const TAB_HOME: NavItem = { key: 'app.nav.home', href: '/app', icon: 'home' };
const TAB_CHECKIN: NavItem = { key: 'app.nav.checkin', href: '/checkin', icon: 'heart' };
const TAB_HABITS: NavItem = { key: 'app.nav.habits', href: '/habits', icon: 'check' };

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

  // Приветствие — по единым границам слотов: ночь <04, утро 04–12, день 12–18, вечер ≥18.
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(
      hour < SLEEP_MORNING_START_HOUR
        ? 'night'
        : hour < SLEEP_MORNING_END_HOUR
          ? 'morning'
          : hour < CHECKIN_DAY_END_HOUR
            ? 'day'
            : 'evening',
    );
  }, []);

  // Если язык ещё не выбран в браузере, берём его из профиля пользователя (ТЗ §6).
  useEffect(() => {
    if (localeFromCookieString(document.cookie)) return;
    if (isLocale(user.locale) && user.locale !== locale) setLocale(user.locale);
  }, [locale, setLocale, user.locale]);

  useEffect(() => {
    function onOpen(): void {
      setAddOpen(true);
    }
    window.addEventListener(QUICK_ADD_EVENT, onOpen);
    return () => window.removeEventListener(QUICK_ADD_EVENT, onOpen);
  }, []);

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

  // Админку AI и метрики видит только админ. Раздел «AI» виден всегда: без ключа там форма подключения.
  function visible(item: NavItem): boolean {
    if (item.key === 'app.nav.adminAi' || item.key === 'app.nav.adminMetrics')
      return user.role === 'admin';
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
        className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-button)] border-l-4 px-3 font-medium transition-colors duration-150 ${
          compact ? 'py-3' : 'py-2'
        } ${
          active
            ? 'border-[var(--puls-primary)] bg-[var(--puls-primary-soft)] font-semibold text-[var(--puls-primary-text)]'
            : 'border-transparent text-[var(--puls-ink-muted)] hover:bg-[var(--puls-surface)] hover:text-[var(--puls-ink)]'
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
        <p className="flex flex-wrap items-center gap-2 px-3 pt-4 pb-1 text-xs font-semibold text-[var(--puls-ink-muted)]">
          {t(group.key)}
          {/* Видимая пометка «TODO: переделать» у понижённого блока (Фаза 0, §5). */}
          {group.badgeKey ? (
            <span
              data-testid="nav-todo-finance"
              className="text-caption rounded-[var(--radius-chip)] border border-[var(--puls-line-strong)] px-2 py-0.5 font-semibold tracking-wide text-[var(--puls-ink-muted)]"
            >
              {t(group.badgeKey)}
            </span>
          ) : null}
        </p>
        {group.items.map((item) => renderLink(item, compact))}
      </div>
    ));

  const moreActive = ![TAB_HOME, TAB_CHECKIN, TAB_HABITS].some((item) =>
    isNavActive(item.href, pathname),
  );

  return (
    <div className="puls-backdrop min-h-dvh md:flex">
      {/* Десктоп: боковое меню с логотипом, «Добавить» и группами разделов. */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto md:px-4 md:py-5">
        {/* Логотип: тап-таргет не меньше 44px по высоте (QA-2 D9). */}
        <Link href="/app" className="mb-5 flex min-h-11 items-center gap-2.5 px-3">
          <Logo size={34} />
          <span className="font-display text-lg">{t('brand.name')}</span>
        </Link>
        <button
          type="button"
          data-testid="quick-add-open"
          onClick={() => setAddOpen(true)}
          className="flex items-center justify-center gap-2 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 py-3 font-semibold text-[var(--puls-on-primary)] puls-key"
        >
          <Icon name="plus" size={18} strokeWidth={2.4} />
          {t('app.nav.add')}
        </button>
        <nav aria-label={t('app.nav.primary')} className="mt-1 flex flex-col">
          {groupList(false)}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-4 pl-[max(1.25rem,env(safe-area-inset-left))] md:px-8 md:pt-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/app"
              className="flex h-11 w-11 shrink-0 items-center justify-center md:hidden"
              aria-label={t('brand.name')}
            >
              <Logo size={36} />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm text-[var(--puls-ink-muted)]">
                {t(`app.greeting.${greeting}`)}
              </p>
              <p className="truncate font-heading text-base font-bold">@{user.nickname}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <QuietModeToggle
              labelClassName="hidden sm:inline"
              className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-3.5 text-sm font-medium shadow-sm transition-colors duration-150 hover:bg-[var(--puls-primary-soft)]"
            />
            {/* Настройки всегда в шапке: на невысоких экранах пункт внизу бокового меню уходит за край. */}
            <Link
              href="/settings"
              data-testid="header-settings"
              aria-label={t('app.nav.settingsItem')}
              aria-current={isNavActive('/settings', pathname) ? 'page' : undefined}
              className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-3.5 text-sm font-medium shadow-sm transition-colors duration-150 hover:bg-[var(--puls-primary-soft)]"
            >
              <Icon name="settings" size={18} />
              <span className="hidden sm:inline">{t('app.nav.settingsItem')}</span>
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              disabled={busy}
              aria-label={t('auth.logout')}
              className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-3.5 text-sm font-medium shadow-sm transition-colors duration-150 hover:bg-[var(--puls-primary-soft)] disabled:opacity-50"
            >
              <Icon name="logout" size={18} />
              <span className="hidden sm:inline">{t('auth.logout')}</span>
            </button>
          </div>
        </header>

        <main
          id="content"
          className="mx-auto w-full max-w-5xl pb-12 pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))] md:px-8"
        >
          {children}
        </main>
      </div>

      {/* Телефон: пять кнопок внизу, остальные разделы — в листе «Ещё». */}
      <nav
        aria-label={t('app.nav.primary')}
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-end border-t-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface)] px-1 pt-1.5 md:hidden"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <MobileTab
          item={TAB_HOME}
          active={isNavActive(TAB_HOME.href, pathname)}
          label={t(TAB_HOME.key)}
        />
        <MobileTab
          item={TAB_CHECKIN}
          active={isNavActive(TAB_CHECKIN.href, pathname)}
          label={t(TAB_CHECKIN.key)}
        />
        <div className="flex justify-center">
          <button
            type="button"
            data-testid="quick-add-open"
            onClick={() => setAddOpen(true)}
            aria-label={t('app.nav.add')}
            className="puls-key -mt-5 flex h-14 w-14 items-center justify-center rounded-[16px_16px_16px_5px] bg-[var(--puls-primary)] text-[var(--puls-on-primary)]"
          >
            <Icon name="plus" size={24} strokeWidth={2.4} />
          </button>
        </div>
        <MobileTab
          item={TAB_HABITS}
          active={isNavActive(TAB_HABITS.href, pathname)}
          label={t(TAB_HABITS.key)}
        />
        <button
          type="button"
          data-testid="nav-more"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[14px] py-1 text-xs font-semibold ${
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
            className="puls-sheet-in absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[28px] border-t-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-bg)] px-4 pt-3 pb-[max(2rem,env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-[var(--puls-line-strong)]" />
            <div className="flex items-center justify-between px-3">
              <p className="font-heading text-lg font-extrabold">{t('app.nav.moreTitle')}</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label={t('app.nav.close')}
                className="flex h-11 w-10 items-center justify-center rounded-full bg-[var(--puls-surface)]"
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
      className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[14px] py-1 text-xs font-semibold ${
        active ? 'text-[var(--puls-primary-text)]' : 'text-[var(--puls-ink-muted)]'
      }`}
    >
      <Icon name={item.icon} size={22} />
      {label}
    </Link>
  );
}
