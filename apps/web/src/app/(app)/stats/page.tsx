// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MOOD_COLORS,
  monthKey,
  type Currency,
  type MoodCalendarDay,
  type MoodCalendarResponse,
  type StatsPeriod,
  type StatsReportResponse,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MASKED_AMOUNT } from '@/components/money';
import { Card } from '@/components/ui';
import { barLayout, heatLevel, summarizeSeries } from '@/lib/charts';
import { FINANCE_CHANGED_EVENT } from '@/lib/finance-client';
import { formatDate, formatMoneyLocale, formatNumber } from '@/lib/format';
import { statsApi } from '@/lib/stats-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

const PERIODS: StatsPeriod[] = ['day', 'week', 'month', 'year'];

/** Цвета тепловой карты: 0 — нет данных, 1–5 — шкала настроения (ТЗ §8). */
const HEAT_COLORS = [
  'var(--puls-ink-muted)',
  MOOD_COLORS[1],
  MOOD_COLORS[2],
  MOOD_COLORS[3],
  MOOD_COLORS[4],
  MOOD_COLORS[5],
];

const CHART_WIDTH = 320;
const CHART_HEIGHT = 120;

interface MetricProps {
  label: string;
  value: string;
  testId?: string;
}

function Metric({ label, value, testId }: MetricProps) {
  return (
    <div className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/20 p-3">
      <p className="text-xs text-[var(--puls-ink-muted)]">{label}</p>
      <p className="text-lg font-bold [font-variant-numeric:tabular-nums]" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

/**
 * Экран «Статистика» (ТЗ §3.4, §8 пункт 6): переключатель периода, графики на
 * простых SVG без тяжёлых библиотек, тепловая карта настроения, сравнение
 * периодов и текстовые описания графиков для скринридеров (WCAG 2.1 AA).
 */
export default function StatsPage() {
  const { t, locale } = useT();
  const quiet = useQuietMode();

  const [period, setPeriod] = useState<StatsPeriod>('week');
  const [report, setReport] = useState<StatsReportResponse | null>(null);
  const [calendar, setCalendar] = useState<MoodCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const month = useMemo(() => monthKey(new Date()), []);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [reportData, calendarData] = await Promise.all([
        statsApi.report(period),
        statsApi.moodCalendar(month),
      ]);
      setReport(reportData);
      setCalendar(calendarData);
      setError(null);
    } catch {
      setError(t('auth.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [month, period, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onChanged(): void {
      void reload();
    }
    window.addEventListener(FINANCE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(FINANCE_CHANGED_EVENT, onChanged);
  }, [reload]);

  const currency = (report?.currency ?? 'RUB') as Currency;
  const money = (value: number): string =>
    quiet ? MASKED_AMOUNT : formatMoneyLocale(value, locale, currency);
  const number = (value: number): string => formatNumber(value, locale, { maximumFractionDigits: 1 });

  const series = report?.series ?? [];
  const spendingBars = barLayout(
    series.map((point) => point.spent),
    CHART_WIDTH,
    CHART_HEIGHT,
  );
  const spendingSummary = summarizeSeries(series.map((point) => ({ day: point.day, value: point.spent })));
  const maxCategory = Math.max(...(report?.byCategory ?? []).map((entry) => entry.total), 0);

  const calendarDays = calendar?.days ?? [];
  const daysGrid = useMemo(() => {
    if (calendarDays.length === 0) return [];
    const firstDay = calendarDays[0]!.day;
    const weekday = (new Date(`${firstDay}T00:00:00.000Z`).getUTCDay() + 6) % 7;
    return [...Array<MoodCalendarDay | null>(weekday).fill(null), ...calendarDays];
  }, [calendarDays]);

  function changeText(change: number | null): string {
    if (change === null) return t('stats.comparison.noData');
    const sign = change > 0 ? '+' : '';
    return t('stats.comparison.change', { value: `${sign}${number(change)}` });
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl font-extrabold">{t('stats.title')}</h1>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('stats.period.label')}>
        {PERIODS.map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`stats-period-${value}`}
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
            className="rounded-[var(--radius-chip)] border border-[var(--puls-ink-muted)]/30 px-4 py-2 text-sm font-medium"
            style={
              period === value
                ? { backgroundColor: 'var(--puls-primary)', color: '#fff' }
                : undefined
            }
          >
            {t(`stats.period.${value}`)}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning)]">
          {error}
        </p>
      ) : null}

      {loading && !report ? (
        <p className="text-sm text-[var(--puls-ink-muted)]" role="status">
          {t('stats.loading')}
        </p>
      ) : null}

      {report ? (
        <>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-[var(--puls-ink-muted)]">
              {formatDate(report.from, locale, { dateStyle: 'medium' })} —{' '}
              {formatDate(report.to, locale, { dateStyle: 'medium' })}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric
                label={t('stats.total.spent')}
                value={money(report.spent)}
                testId="stats-spent"
              />
              <Metric label={t('stats.total.earned')} value={money(report.earned)} />
              <Metric label={t('stats.total.net')} value={money(report.net)} />
              <Metric
                label={t('stats.total.mood')}
                value={report.avgMood === null ? t('stats.heatmap.none') : number(report.avgMood)}
              />
              <Metric label={t('stats.total.checkins')} value={String(report.checkins)} />
            </div>
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">{t('stats.comparison.title')}</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {(
                [
                  ['stats.comparison.spent', report.comparison.spent],
                  ['stats.comparison.earned', report.comparison.earned],
                  ['stats.comparison.mood', report.comparison.avgMood],
                  ['stats.comparison.checkins', report.comparison.checkins],
                ] as const
              ).map(([labelKey, metric]) => (
                <li key={labelKey} className="flex items-center justify-between gap-3">
                  <span>{t(labelKey)}</span>
                  <span className="text-[var(--puls-ink-muted)] [font-variant-numeric:tabular-nums]">
                    {changeText(metric.change)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">{t('stats.chart.spending')}</h2>
            {series.length === 0 ? (
              <p className="text-sm text-[var(--puls-ink-muted)]">{t('stats.chart.empty')}</p>
            ) : (
              <figure className="flex flex-col gap-2" data-testid="stats-spending-chart">
                <svg
                  role="img"
                  aria-labelledby="stats-spending-title stats-spending-desc"
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                  className="h-32 w-full"
                  preserveAspectRatio="none"
                >
                  <title id="stats-spending-title">{t('stats.chart.spending')}</title>
                  <desc id="stats-spending-desc">
                    {t('stats.chart.summary', {
                      total: money(spendingSummary.total),
                      peak: money(spendingSummary.peakValue),
                      day: spendingSummary.peakDay
                        ? formatDate(spendingSummary.peakDay, locale, { day: '2-digit', month: 'short' })
                        : t('stats.heatmap.none'),
                      average: money(spendingSummary.average),
                    })}
                  </desc>
                  {spendingBars.map((bar, index) => (
                    <rect
                      key={series[index]?.day ?? index}
                      x={bar.x}
                      y={bar.y}
                      width={Math.max(bar.width, 0.5)}
                      height={Math.max(bar.height, 0.5)}
                      fill="var(--puls-primary)"
                      aria-hidden="true"
                    />
                  ))}
                </svg>
                <figcaption className="text-xs text-[var(--puls-ink-muted)]">
                  {t('stats.chart.summary', {
                    total: money(spendingSummary.total),
                    peak: money(spendingSummary.peakValue),
                    day: spendingSummary.peakDay
                      ? formatDate(spendingSummary.peakDay, locale, { day: '2-digit', month: 'short' })
                      : t('stats.heatmap.none'),
                    average: money(spendingSummary.average),
                  })}
                </figcaption>
              </figure>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">{t('stats.byCategory.title')}</h2>
            {(report.byCategory ?? []).length === 0 ? (
              <p className="text-sm text-[var(--puls-ink-muted)]" data-testid="stats-categories-empty">
                {t('stats.byCategory.empty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="stats-categories">
                {report.byCategory.map((entry) => (
                  <li key={entry.categoryId ?? 'none'} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        {entry.categoryName ?? t('stats.byCategory.other')}
                      </span>
                      <span className="[font-variant-numeric:tabular-nums]">{money(entry.total)}</span>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-[var(--radius-chip)] bg-[var(--puls-ink-muted)]/20"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={maxCategory}
                      aria-valuenow={entry.total}
                      aria-label={entry.categoryName ?? t('stats.byCategory.other')}
                    >
                      <div
                        className="h-full rounded-[var(--radius-chip)] bg-[var(--puls-finance)]"
                        style={{ width: `${maxCategory > 0 ? (entry.total / maxCategory) * 100 : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{t('stats.heatmap.title')}</h2>
        {calendarDays.length === 0 ? (
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('stats.heatmap.empty')}</p>
        ) : (
          <figure className="flex flex-col gap-2" data-testid="stats-heatmap">
            <svg
              role="img"
              aria-labelledby="stats-heat-title stats-heat-desc"
              viewBox={`0 0 ${7 * 19} ${Math.ceil(daysGrid.length / 7) * 19 + 16}`}
              className="w-full max-w-xs"
            >
              <title id="stats-heat-title">{t('stats.heatmap.title')}</title>
              <desc id="stats-heat-desc">
                {t('stats.heatmap.description', {
                  month: formatDate(`${month}-01`, locale, { month: 'long', year: 'numeric' }),
                  summary:
                    calendar?.average === null || calendar?.average === undefined
                      ? t('stats.heatmap.empty')
                      : t('stats.heatmap.average', { value: number(calendar.average) }),
                })}
              </desc>
              {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
                <text
                  key={weekday}
                  x={(weekday - 1) * 19 + 6}
                  y={10}
                  fontSize={9}
                  textAnchor="middle"
                  fill="var(--puls-ink-muted)"
                  aria-hidden="true"
                >
                  {t(`stats.weekday.${weekday}`)}
                </text>
              ))}
              {daysGrid.map((entry, index) =>
                entry ? (
                  <rect
                    key={entry.day}
                    x={(index % 7) * 19}
                    y={Math.floor(index / 7) * 19 + 16}
                    width={16}
                    height={16}
                    rx={4}
                    fill={HEAT_COLORS[heatLevel(entry.mood)]}
                    aria-hidden="true"
                  />
                ) : null,
              )}
            </svg>
            <figcaption className="flex flex-wrap gap-3 text-xs text-[var(--puls-ink-muted)]">
              {calendar?.average === null || calendar?.average === undefined ? null : (
                <span>{t('stats.heatmap.average', { value: number(calendar.average) })}</span>
              )}
              {calendar?.best ? (
                <span>
                  {t('stats.heatmap.best', {
                    day: formatDate(calendar.best.day, locale, { day: '2-digit', month: 'short' }),
                    value: number(calendar.best.mood),
                  })}
                </span>
              ) : null}
            </figcaption>
            {/* Текстовое описание для скринридеров (ТЗ §6: графики с описанием). */}
            <ul className="sr-only">
              {calendarDays.map((entry) => (
                <li key={entry.day}>
                  {formatDate(entry.day, locale, { day: 'numeric', month: 'long' })}:{' '}
                  {entry.mood === null ? t('stats.heatmap.none') : number(entry.mood)}
                </li>
              ))}
            </ul>
          </figure>
        )}
      </Card>
    </div>
  );
}
