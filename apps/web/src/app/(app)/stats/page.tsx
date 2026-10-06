// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
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
import { categoryLabel } from '@/lib/category-label';
import { MASKED_AMOUNT } from '@/components/money';
import { Card, EmptyState, Segmented, StatTile, type Tone } from '@/components/ui';
import { barLayout, heatLevel, summarizeSeries } from '@/lib/charts';
import { FINANCE_CHANGED_EVENT } from '@/lib/finance-client';
import { formatDate, formatMoneyLocale, formatNumber } from '@/lib/format';
import { statsApi } from '@/lib/stats-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

const PERIODS: StatsPeriod[] = ['day', 'week', 'month', 'year'];

/** Цвета тепловой карты: 0 — нет данных (пустая ячейка с обводкой), 1–5 — шкала настроения (ТЗ §8). */
const HEAT_COLORS = [
  'var(--puls-surface-2)',
  MOOD_COLORS[1],
  MOOD_COLORS[2],
  MOOD_COLORS[3],
  MOOD_COLORS[4],
  MOOD_COLORS[5],
];

const CHART_WIDTH = 320;
const CHART_HEIGHT = 100;

const CATEGORY_TONES: Array<Exclude<Tone, 'neutral'>> = [
  'finance',
  'primary',
  'wellbeing',
  'warning',
];

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
  const number = (value: number): string =>
    formatNumber(value, locale, { maximumFractionDigits: 1 });

  const series = report?.series ?? [];
  const spendingBars = barLayout(
    series.map((point) => point.spent),
    CHART_WIDTH,
    CHART_HEIGHT,
  );
  const spendingSummary = summarizeSeries(
    series.map((point) => ({ day: point.day, value: point.spent })),
  );
  const labelEvery = series.length <= 8 ? 1 : Math.ceil(series.length / 7);
  const dayLabel = (day: string): string =>
    series.length <= 8
      ? formatDate(day, locale, { weekday: 'short', day: 'numeric' })
      : formatDate(day, locale, { day: 'numeric', month: 'short' });
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
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('stats.title')}</h1>
        <Link
          href="/wrapped"
          data-testid="stats-wrapped-link"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 text-sm font-semibold text-[var(--puls-primary-text)]"
        >
          {t('wrapped.title')}
        </Link>
      </div>

      <Segmented
        label={t('stats.period.label')}
        value={period}
        onChange={setPeriod}
        options={PERIODS.map((value) => ({
          value,
          label: t(`stats.period.${value}`),
          testId: `stats-period-${value}`,
        }))}
      />

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
          {error}
        </p>
      ) : null}

      {loading && !report ? (
        // Резервируем высоту под будущие карточки, чтобы данные не сдвигали макет (CLS).
        <div className="min-h-[70vh] animate-pulse rounded-[var(--radius-card)] bg-[var(--puls-surface)]/60 p-6">
          <p className="text-sm text-[var(--puls-ink-muted)]" role="status">
            {t('stats.loading')}
          </p>
        </div>
      ) : null}

      {report ? (
        <>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-[var(--puls-ink-muted)]">
              {formatDate(report.from, locale, { dateStyle: 'medium' })} —{' '}
              {formatDate(report.to, locale, { dateStyle: 'medium' })}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                label={t('stats.total.spent')}
                value={<span data-testid="stats-spent">{money(report.spent)}</span>}
                tone="warning"
                icon="wallet"
              />
              <StatTile
                label={t('stats.total.earned')}
                value={money(report.earned)}
                tone="finance"
                icon="plus"
              />
              <StatTile
                label={t('stats.total.net')}
                value={money(report.net)}
                tone="primary"
                icon="chart"
              />
              <StatTile
                label={t('stats.total.mood')}
                value={report.avgMood === null ? t('stats.heatmap.none') : number(report.avgMood)}
                tone="wellbeing"
                icon="heart"
              />
              {report.avgEnergy !== null ? (
                <StatTile
                  label={t('stats.total.energy')}
                  value={<span data-testid="stats-energy">{number(report.avgEnergy)}</span>}
                  tone="wellbeing"
                  icon="heart"
                />
              ) : null}
              {report.avgStress !== null ? (
                <StatTile
                  label={t('stats.total.stress')}
                  value={<span data-testid="stats-stress">{number(report.avgStress)}</span>}
                  tone="primary"
                  icon="heart"
                />
              ) : null}
              {report.avgSleep !== null ? (
                <StatTile
                  label={t('stats.total.sleep')}
                  value={<span data-testid="stats-sleep">{number(report.avgSleep)}</span>}
                  tone="wellbeing"
                  icon="heart"
                />
              ) : null}
              <StatTile
                label={t('stats.total.checkins')}
                value={String(report.checkins)}
                tone="wellbeing"
                icon="check"
              />
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
              <EmptyState icon="chart" tone="finance" title={t('stats.chart.empty')} />
            ) : (
              <figure className="flex flex-col gap-3" data-testid="stats-spending-chart">
                <div
                  role="img"
                  aria-label={t('stats.chart.spending')}
                  aria-describedby="stats-spending-desc"
                  className="flex h-40 items-stretch gap-[3px] pb-6"
                >
                  {spendingBars.map((bar, index) => {
                    const point = series[index];
                    const day = point?.day ?? String(index);
                    const label = labelEvery > 0 && index % labelEvery === 0;
                    const full = formatDate(day, locale, { day: 'numeric', month: 'long' });
                    return (
                      <div
                        key={day}
                        className="relative flex min-w-0 flex-1 flex-col justify-end rounded-t-[6px] rounded-b-[6px] bg-[var(--puls-finance-soft)]"
                        title={`${full}: ${money(point?.spent ?? 0)}`}
                        aria-hidden="true"
                      >
                        <div
                          className="w-full rounded-[6px] bg-[var(--puls-finance)]"
                          style={{
                            height: `${(bar.height / CHART_HEIGHT) * 100}%`,
                            minHeight: (point?.spent ?? 0) > 0 ? 4 : 0,
                          }}
                        />
                        {label ? (
                          <span className="absolute top-full left-1/2 mt-1.5 -translate-x-1/2 text-[11px] whitespace-nowrap text-[var(--puls-ink-muted)]">
                            {dayLabel(day)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <figcaption
                  id="stats-spending-desc"
                  className="text-xs text-[var(--puls-ink-muted)]"
                >
                  {t('stats.chart.summary', {
                    total: money(spendingSummary.total),
                    peak: money(spendingSummary.peakValue),
                    day: spendingSummary.peakDay
                      ? formatDate(spendingSummary.peakDay, locale, {
                          day: '2-digit',
                          month: 'short',
                        })
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
              <div data-testid="stats-categories-empty">
                <EmptyState icon="wallet" tone="finance" title={t('stats.byCategory.empty')} />
              </div>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="stats-categories">
                {report.byCategory.map((entry, index) => {
                  const tone = CATEGORY_TONES[index % CATEGORY_TONES.length]!;
                  const entryLabel = entry.categoryName
                    ? categoryLabel({ id: entry.categoryId, name: entry.categoryName }, t)
                    : t('stats.byCategory.other');
                  return (
                    <li key={entry.categoryId ?? 'none'} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{entryLabel}</span>
                        <span className="[font-variant-numeric:tabular-nums]">
                          {money(entry.total)}
                        </span>
                      </div>
                      <div
                        className="h-3 w-full overflow-hidden rounded-[var(--radius-chip)] bg-[var(--puls-line)]"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={maxCategory}
                        aria-valuenow={entry.total}
                        aria-label={entryLabel}
                      >
                        <div
                          className="h-full rounded-[var(--radius-chip)]"
                          style={{
                            width: `${maxCategory > 0 ? (entry.total / maxCategory) * 100 : 0}%`,
                            backgroundColor: `var(--puls-${tone})`,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{t('stats.heatmap.title')}</h2>
        {calendarDays.length === 0 ? (
          <EmptyState icon="heart" tone="wellbeing" title={t('stats.heatmap.empty')} />
        ) : (
          <figure className="flex flex-col gap-2" data-testid="stats-heatmap">
            <svg
              role="img"
              aria-labelledby="stats-heat-title stats-heat-desc"
              viewBox={`0 0 ${7 * 19} ${Math.ceil(daysGrid.length / 7) * 19 + 16}`}
              className="w-full max-w-sm"
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
                  // Центр клетки шириной 16 — x + 8; при 9px трёхбуквенные «Mon»/«Wed»
                  // не помещались в шаг 19 и налезали друг на друга, «Mon» обрезался.
                  x={(weekday - 1) * 19 + 8}
                  y={10}
                  fontSize={7}
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
                    rx={5}
                    fill={HEAT_COLORS[heatLevel(entry.mood)]}
                    stroke={entry.mood === null ? 'var(--puls-line-strong)' : 'none'}
                    strokeWidth={entry.mood === null ? 1 : 0}
                    aria-hidden="true"
                  />
                ) : null,
              )}
            </svg>
            <div
              className="flex flex-wrap items-center gap-2 text-xs text-[var(--puls-ink-muted)]"
              aria-hidden="true"
            >
              <span className="inline-block h-3.5 w-3.5 rounded-[5px] border-[1.5px] border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)]" />
              <span>{t('stats.heatmap.legend.empty')}</span>
              <span className="ml-3">{t('stats.heatmap.legend.worse')}</span>
              {([1, 2, 3, 4, 5] as const).map((level) => (
                <span
                  key={level}
                  className="inline-block h-3.5 w-3.5 rounded-[5px]"
                  style={{ backgroundColor: MOOD_COLORS[level] }}
                />
              ))}
              <span>{t('stats.heatmap.legend.better')}</span>
            </div>
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
