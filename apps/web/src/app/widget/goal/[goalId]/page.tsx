// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Публичный виджет цели (ТЗ §4, P3): минимальная страница для вставки через
 * iframe на блог или портфолио. Без AppShell и навигации кабинета; светлая и
 * тёмная темы следуют prefers-color-scheme (класс .dark ставит скрипт темы
 * из корневого layout). Данные берутся у публичного эндпоинта API: приватная
 * цель или закрытый профиль владельца отдают 404, и виджет показывает
 * заглушку. Аудио и лишние данные сюда не попадают — только проценты.
 */
import type { Metadata } from 'next';
import type { GoalWidgetDto, GoalWidgetResponse } from '@puls/shared';
import { SERVER_API_URL } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/locale-server';

export const dynamic = 'force-dynamic';

async function fetchWidget(goalId: string): Promise<GoalWidgetDto | null> {
  const response = await fetch(
    `${SERVER_API_URL.replace(/\/+$/, '')}/api/public/widgets/goal/${encodeURIComponent(goalId)}`,
    { cache: 'no-store' },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`widget_request_failed:${response.status}`);
  const body = (await response.json()) as GoalWidgetResponse;
  return body.widget;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ goalId: string }>;
}): Promise<Metadata> {
  await params;
  const locale = await getRequestLocale();
  // Виджет не индексируется: это встраиваемый фрагмент, а не страница профиля.
  return { title: t('widget.title', locale), robots: { index: false, follow: false } };
}

export default async function GoalWidgetPage({ params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params;
  const locale = await getRequestLocale();
  const widget = await fetchWidget(goalId);

  if (!widget) {
    return (
      <main
        data-testid="goal-widget"
        className="flex min-h-screen items-center justify-center p-4 text-center"
      >
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('widget.notFound', locale)}</p>
      </main>
    );
  }

  return (
    <main
      data-testid="goal-widget"
      className="flex min-h-screen flex-col justify-center gap-3 bg-[var(--puls-finance-soft)] p-4 text-[var(--puls-ink)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 font-bold">
          {widget.image ? (
            <span aria-hidden="true" className="text-lg leading-none">
              {widget.image}
            </span>
          ) : null}
          <span className="truncate">{widget.title}</span>
        </span>
        <span className="shrink-0 font-heading text-lg font-extrabold text-[var(--puls-finance-text)]">
          {t('widget.percent', locale, { percent: widget.percent })}
        </span>
      </div>

      <div
        role="progressbar"
        data-testid="goal-widget-bar"
        aria-valuenow={widget.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={widget.title}
        className="h-3.5 w-full overflow-hidden rounded-full bg-[var(--puls-surface)]"
      >
        <div
          className="h-full rounded-full bg-[var(--puls-finance)] transition-[width] duration-200"
          style={{ width: `${widget.percent}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--puls-ink-muted)]">
        <span>{t('widget.owner', locale, { nickname: widget.nickname })}</span>
        {widget.deadline ? (
          <span>
            {t('widget.deadline', locale, {
              date: formatDate(widget.deadline, locale, { dateStyle: 'medium' }),
            })}
          </span>
        ) : null}
      </div>

      {widget.milestones.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {widget.milestones.map((milestone) => (
            <span
              key={milestone}
              className="rounded-[var(--radius-chip)] bg-[var(--puls-surface)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--puls-finance-text)]"
            >
              {t('widget.milestone', locale, { percent: milestone })}
            </span>
          ))}
        </div>
      ) : null}
    </main>
  );
}
