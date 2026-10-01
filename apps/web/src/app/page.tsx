// SPDX-License-Identifier: AGPL-3.0-or-later
import { moodAverage } from '@puls/shared';
import Link from 'next/link';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { API_BASE_URL, healthUrl } from '@/lib/api';
import { budgetLevel } from '@/lib/budget';
import { formatMoneyLocale } from '@/lib/format';
import { t } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/locale-server';

const DEMO = {
  spent: 41_500,
  budget: 50_000,
  incomes: [3, 4, 4, 5, 2, 3, 4],
  savingsGoal: 120_000,
  savingsSaved: 60_000,
};

export default async function LandingPage() {
  const locale = await getRequestLocale();
  const budget = budgetLevel(DEMO.budget, DEMO.spent);
  const mood = moodAverage(DEMO.incomes);
  const goalPercent = Math.round((DEMO.savingsSaved / DEMO.savingsGoal) * 100);
  const money = (amount: number) => formatMoneyLocale(amount, locale);

  return (
    <main id="content" className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-semibold tracking-wide text-[var(--puls-primary-text)] uppercase">
          {t('landing.badge', locale)}
        </p>
        <h1 className="text-4xl font-extrabold sm:text-5xl">{t('landing.title', locale)}</h1>
        <p className="max-w-2xl text-lg text-[var(--puls-ink-muted)]">{t('landing.lead', locale)}</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/register"
            className="rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 py-3 font-semibold text-[var(--puls-on-primary)] transition-opacity duration-150 hover:opacity-90"
          >
            {t('landing.cta.start', locale)}
          </Link>
          <Link
            href="/login"
            className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-6 py-3 font-semibold transition-colors duration-150 hover:bg-[var(--puls-ink-muted)]/10"
          >
            {t('landing.cta.login', locale)}
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
          <h2 className="text-sm text-[var(--puls-ink-muted)]">
            {t('landing.demo.budgetTitle', locale)}
          </h2>
          <p className="mt-2 text-2xl font-bold">{money(DEMO.spent)}</p>
          <p className="text-sm text-[var(--puls-ink-muted)]">
            {t('landing.demo.budgetShare', locale, {
              percent: budget.percent,
              total: money(DEMO.budget),
            })}
          </p>
        </article>

        <article className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
          <h2 className="text-sm text-[var(--puls-ink-muted)]">
            {t('landing.demo.moodTitle', locale)}
          </h2>
          <p className="mt-2 text-2xl font-bold text-[var(--puls-wellbeing-text)]">
            {mood ?? '—'} / 5
          </p>
          <p className="text-sm text-[var(--puls-ink-muted)]">
            {t('landing.demo.moodCheckins', locale, { count: DEMO.incomes.length })}
          </p>
        </article>

        <article className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
          <h2 className="text-sm text-[var(--puls-ink-muted)]">
            {t('landing.demo.goalTitle', locale)}
          </h2>
          <p className="mt-2 text-2xl font-bold text-[var(--puls-finance-text)]">{goalPercent}%</p>
          <p className="text-sm text-[var(--puls-ink-muted)]">
            {t('landing.demo.goalProgress', locale, {
              saved: money(DEMO.savingsSaved),
              target: money(DEMO.savingsGoal),
            })}
          </p>
        </article>
      </section>

      <section id="start" className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-6">
        <h2 className="text-xl font-bold">{t('landing.phase.title', locale)}</h2>
        <p className="mt-2 text-[var(--puls-ink-muted)]">
          {t('landing.phase.body', locale)}{' '}
          <code className="rounded bg-[var(--puls-ink-muted)]/10 px-2 py-1 text-sm text-[var(--puls-ink)]">
            {healthUrl()}
          </code>
        </p>
        <p className="mt-2 text-sm text-[var(--puls-ink-muted)]">
          {t('landing.phase.apiBase', locale, { base: API_BASE_URL })}
        </p>
      </section>

      <section
        aria-labelledby="appearance-heading"
        className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-6"
      >
        <h2 id="appearance-heading" className="text-xl font-bold">
          {t('settings.appearance', locale)}
        </h2>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:gap-10">
          <ThemeToggle />
          <LocaleSwitcher reloadOnChange />
        </div>
      </section>

      <footer className="text-sm text-[var(--puls-ink-muted)]">
        {t('landing.footer', locale, { year: new Date().getFullYear() })}
      </footer>
    </main>
  );
}
