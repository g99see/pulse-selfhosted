// SPDX-License-Identifier: AGPL-3.0-or-later
import { moodAverage } from '@puls/shared';
import Link from 'next/link';
import { Icon, Logo, type IconName } from '@/components/icons';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { SetupGuard } from '@/components/setup-guard';
import { ThemeToggle } from '@/components/theme-toggle';
import { IconBubble, ProgressBar, StatTile, type Tone } from '@/components/ui';
import { budgetLevel } from '@/lib/budget';
import { formatMoneyLocale } from '@/lib/format';
import { t } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/locale-server';

/**
 * Пример на лендинге — в евро для обоих языков: валюта нейтральная для
 * международной аудитории (раньше англоязычный гость видел «RUB 41,500»).
 * Формат числа и знака валюты всё равно зависит от локали.
 */
const DEMO_EXAMPLE = {
  currency: 'EUR',
  spent: 415,
  budget: 500,
  savingsGoal: 1_200,
  savingsSaved: 600,
} as const;
const DEMO_BY_LOCALE = { ru: DEMO_EXAMPLE, en: DEMO_EXAMPLE } as const;
const DEMO_MOODS = [3, 4, 4, 5, 2, 3, 4];

const FEATURES: Array<{ key: string; icon: IconName; tone: Exclude<Tone, 'neutral'> }> = [
  { key: 'money', icon: 'wallet', tone: 'finance' },
  { key: 'checkin', icon: 'heart', tone: 'wellbeing' },
  { key: 'goals', icon: 'target', tone: 'primary' },
  { key: 'privacy', icon: 'shield', tone: 'finance' },
];

/** Лендинг (docs/REDESIGN.md): герой, превью «Сегодня» на демо-данных, возможности, оформление. */
export default async function LandingPage() {
  const locale = await getRequestLocale();
  const DEMO = DEMO_BY_LOCALE[locale];
  const budget = budgetLevel(DEMO.budget, DEMO.spent);
  const mood = moodAverage(DEMO_MOODS);
  const goalPercent = Math.round((DEMO.savingsSaved / DEMO.savingsGoal) * 100);
  const money = (amount: number) => formatMoneyLocale(amount, locale, DEMO.currency);

  return (
    <main id="content" className="puls-backdrop min-h-screen">
      <SetupGuard />
      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-5 py-8 sm:px-8 sm:py-10">
        <nav className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={36} />
            <span className="font-heading text-xl font-extrabold">
              {t('landing.brand', locale)}
            </span>
          </Link>
          <Link
            href="/login"
            className="rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-4 py-2 text-sm font-semibold shadow-sm"
          >
            {t('landing.cta.login', locale)}
          </Link>
        </nav>

        <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
          <header className="flex flex-col gap-5">
            <span className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-chip)] bg-[var(--puls-wellbeing-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--puls-wellbeing-text)]">
              <Icon name="pulse" size={16} />
              {t('landing.hero.eyebrow', locale)}
            </span>
            <h1 className="text-4xl leading-[1.08] font-extrabold sm:text-6xl">
              {t('landing.title', locale)}
            </h1>
            <p className="max-w-xl text-lg text-[var(--puls-ink-muted)]">
              {t('landing.lead', locale)}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 font-semibold text-[var(--puls-on-primary)] shadow-[0_10px_22px_-12px_var(--puls-primary)] transition-opacity duration-150 hover:opacity-95"
              >
                {t('landing.cta.start', locale)}
                <Icon name="arrowRight" size={18} />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface)] px-6 font-semibold transition-colors duration-150 hover:bg-[var(--puls-surface-2)]"
              >
                {t('landing.cta.login', locale)}
              </Link>
            </div>
            <p className="text-sm text-[var(--puls-ink-muted)]">{t('landing.badge', locale)}</p>
          </header>

          <section
            aria-label={t('landing.preview.label', locale)}
            className="flex flex-col gap-3 rounded-[32px] bg-[var(--puls-surface)] p-5 shadow-[var(--puls-shadow-lift)] sm:p-6"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <StatTile
                tone="wellbeing"
                icon="heart"
                label={t('landing.demo.moodTitle', locale)}
                value={`${mood ?? '—'} / 5`}
                hint={t('landing.demo.moodCheckins', locale, { count: DEMO_MOODS.length })}
              />
              <StatTile
                tone="finance"
                icon="target"
                label={t('landing.demo.goalTitle', locale)}
                value={`${goalPercent}%`}
                hint={t('landing.demo.goalProgress', locale, {
                  saved: money(DEMO.savingsSaved),
                  target: money(DEMO.savingsGoal),
                })}
              />
            </div>
            <div className="flex flex-col gap-3 rounded-[20px] bg-[var(--puls-surface-2)] p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Icon name="wallet" size={16} />
                  {t('landing.demo.budgetTitle', locale)}
                </h2>
                <span className="font-heading text-xl font-extrabold">{money(DEMO.spent)}</span>
              </div>
              <ProgressBar
                tone={
                  budget.percent >= 100 ? 'warning' : budget.percent >= 80 ? 'wellbeing' : 'finance'
                }
                value={Math.min(DEMO.spent, DEMO.budget)}
                max={DEMO.budget}
                label={t('landing.demo.budgetShare', locale, {
                  percent: budget.percent,
                  total: money(DEMO.budget),
                })}
              />
            </div>
          </section>
        </section>

        <section aria-labelledby="features-heading" className="flex flex-col gap-6">
          <h2 id="features-heading" className="max-w-2xl text-2xl font-extrabold sm:text-3xl">
            {t('landing.features.title', locale)}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <article
                key={feature.key}
                className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-6 shadow-sm"
              >
                <IconBubble name={feature.icon} tone={feature.tone} size={44} />
                <h3 className="text-lg font-bold">
                  {t(`landing.feature.${feature.key}.title`, locale)}
                </h3>
                <p className="text-sm text-[var(--puls-ink-muted)]">
                  {t(`landing.feature.${feature.key}.text`, locale)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <footer className="flex flex-col gap-6 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <section aria-labelledby="appearance-heading" className="flex flex-col gap-4">
            <h2 id="appearance-heading" className="text-lg font-bold">
              {t('settings.appearance', locale)}
            </h2>
            <div className="flex flex-col gap-5 sm:flex-row sm:gap-8">
              <ThemeToggle />
              <LocaleSwitcher reloadOnChange />
            </div>
          </section>
          <p className="text-sm text-[var(--puls-ink-muted)]">
            {t('landing.footer', locale, { year: new Date().getFullYear() })}
          </p>
        </footer>
      </div>
    </main>
  );
}
