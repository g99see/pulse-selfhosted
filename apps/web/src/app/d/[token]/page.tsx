// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Приватная страница «Итог дня» (ТЗ v2 §7): открывается по секретной ссылке
 * `/d/<токен>` без входа. Показывает только итоги сегодняшнего дня — траты,
 * доходы, среднее настроение и число чек-инов; не индексируется.
 */
import type { Metadata } from 'next';
import type { DaySummaryPublicDto } from '@puls/shared';
import { SERVER_API_URL } from '@/lib/api';
import { formatMoneyLocale } from '@/lib/format';
import { t } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/locale-server';

export const dynamic = 'force-dynamic';

async function fetchSummary(token: string): Promise<DaySummaryPublicDto | null> {
  const response = await fetch(
    `${SERVER_API_URL.replace(/\/+$/, '')}/api/public/day-summary/${encodeURIComponent(token)}`,
    { cache: 'no-store' },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`day_summary_request_failed:${response.status}`);
  return ((await response.json()) as { summary: DaySummaryPublicDto }).summary;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: t('daySummary.title', locale),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function DaySummaryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await getRequestLocale();
  const summary = await fetchSummary(token);

  if (!summary) {
    return (
      <main
        data-testid="day-summary-public"
        className="flex min-h-screen items-center justify-center p-4 text-center"
      >
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('daySummary.notFound', locale)}</p>
      </main>
    );
  }

  const money = (value: number) =>
    formatMoneyLocale(value, locale, summary.currency as Parameters<typeof formatMoneyLocale>[2]);
  const rows: [string, string][] = [
    [t('daySummary.spent', locale), money(summary.spent)],
    [t('daySummary.earned', locale), money(summary.earned)],
    [t('daySummary.mood', locale), summary.avgMood === null ? '—' : String(summary.avgMood)],
    [t('daySummary.checkins', locale), String(summary.checkins)],
  ];

  return (
    <main
      data-testid="day-summary-public"
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6"
    >
      <h1 className="text-2xl font-extrabold">
        {t('daySummary.heading', locale, { nickname: summary.nickname })}
      </h1>
      <p className="text-sm text-[var(--puls-ink-muted)]">{summary.day}</p>
      <dl className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-[var(--puls-ink-muted)]">{label}</dt>
            <dd className="font-heading text-lg font-bold">{value}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
