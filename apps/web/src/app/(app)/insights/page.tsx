// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  InsightDto,
  InsightFeedback,
  InsightsFeedResponse,
  SupportResourceDto,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MASKED_AMOUNT } from '@/components/money';
import { Badge, Card, EmptyState, GhostButton, IconBubble, PrimaryButton } from '@/components/ui';
import { FINANCE_CHANGED_EVENT, notifyFinanceChanged } from '@/lib/finance-client';
import { formatDate, formatMoneyLocale, formatNumber } from '@/lib/format';
import { insightsApi } from '@/lib/insights-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

const CURRENCY = 'RUB' as const;

/**
 * Экран «Рекомендации» (ТЗ §3.5, §8 пункт 7): лента наблюдений на правилах,
 * оценка «полезно / не полезно», кнопка «Применить» у предложения и контакты
 * служб поддержки при тревожном сигнале. Никаких диагнозов — только подсказки.
 */
export default function InsightsPage() {
  const { t, locale } = useT();
  const quiet = useQuietMode();
  const [feed, setFeed] = useState<InsightsFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setFeed(await insightsApi.feed());
      setError(null);
    } catch {
      setError(t('insights.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  const insights = feed?.insights ?? [];
  const support = feed?.support ?? [];

  function patchInsight(updated: InsightDto): void {
    setFeed((current) =>
      current
        ? {
            ...current,
            insights: current.insights.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current,
    );
  }

  function text(insight: InsightDto): string {
    const params: Record<string, string | number> = { ...insight.params };
    if (typeof params.amount === 'number')
      params.amount = quiet ? MASKED_AMOUNT : formatMoneyLocale(params.amount, locale, CURRENCY);
    if (typeof params.percent === 'number')
      params.percent = formatNumber(params.percent, locale, { maximumFractionDigits: 1 });
    if (typeof params.delta === 'number')
      params.delta = formatNumber(params.delta, locale, { maximumFractionDigits: 1 });
    return t(insight.textKey, params);
  }

  async function rate(insight: InsightDto, feedback: InsightFeedback): Promise<void> {
    setBusyId(insight.id);
    setNotice(null);
    try {
      const response = await insightsApi.feedback(insight.id, feedback);
      patchInsight(response.insight);
      if (feedback === 'not_useful') setNotice(t('insights.feedback.thanks'));
    } catch {
      setError(t('insights.feedback.error'));
    } finally {
      setBusyId(null);
    }
  }

  async function apply(insight: InsightDto): Promise<void> {
    setBusyId(insight.id);
    setNotice(null);
    try {
      const response = await insightsApi.apply(insight.id);
      patchInsight(response.insight);
      setNotice(t('insights.applied'));
      notifyFinanceChanged();
    } catch {
      setError(t('insights.applyError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <IconBubble name="sparkle" tone="primary" size={44} />
        <div>
          <h1 className="text-3xl font-extrabold">{t('insights.title')}</h1>
          <p className="mt-1 text-sm text-[var(--puls-ink-muted)]">{t('insights.subtitle')}</p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--puls-warning-text)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-[var(--puls-finance-text)]">
          {notice}
        </p>
      ) : null}

      {loading && insights.length === 0 ? (
        <p className="text-sm text-[var(--puls-ink-muted)]" role="status">
          {t('insights.loading')}
        </p>
      ) : null}

      {!loading && insights.length === 0 ? (
        <Card>
          <div data-testid="insights-empty">
            <EmptyState icon="sparkle" tone="primary" title={t('insights.empty')} />
          </div>
        </Card>
      ) : null}

      {insights.length > 0 ? (
        <ul className="flex flex-col gap-3" data-testid="insights-feed">
          {insights.map((insight) => (
            <li key={insight.id} data-testid="insight-card" data-insight-type={insight.type}>
              <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={insight.source === 'weekly' ? 'primary' : 'wellbeing'}>
                    {insight.source === 'weekly' ? t('insights.week') : t('insights.rule')}
                  </Badge>
                  <span className="text-xs text-[var(--puls-ink-muted)]">
                    {formatDate(insight.createdAt, locale, { day: '2-digit', month: 'short' })}
                  </span>
                </div>

                <p className="text-base">{text(insight)}</p>

                <div className="flex flex-wrap items-center gap-2">
                  {insight.feedback === null ? (
                    <>
                      <button
                        type="button"
                        data-testid="insight-feedback-useful"
                        disabled={busyId === insight.id}
                        onClick={() => void rate(insight, 'useful')}
                        className="rounded-[var(--radius-chip)] bg-[var(--puls-surface-2)] px-3.5 py-1.5 text-sm font-semibold hover:bg-[var(--puls-primary-soft)] hover:text-[var(--puls-primary-text)] disabled:opacity-50"
                      >
                        {t('insights.feedback.useful')}
                      </button>
                      <button
                        type="button"
                        data-testid="insight-feedback-not-useful"
                        disabled={busyId === insight.id}
                        onClick={() => void rate(insight, 'not_useful')}
                        className="rounded-[var(--radius-chip)] bg-[var(--puls-surface-2)] px-3.5 py-1.5 text-sm font-semibold hover:bg-[var(--puls-primary-soft)] hover:text-[var(--puls-primary-text)] disabled:opacity-50"
                      >
                        {t('insights.feedback.notUseful')}
                      </button>
                    </>
                  ) : (
                    <span
                      className="text-sm text-[var(--puls-ink-muted)]"
                      data-testid="insight-feedback-given"
                    >
                      {insight.feedback === 'useful'
                        ? t('insights.feedback.useful')
                        : t('insights.feedback.notUseful')}
                    </span>
                  )}

                  {insight.action && insight.appliedAt === null ? (
                    <PrimaryButton
                      type="button"
                      data-testid="insight-apply"
                      disabled={busyId === insight.id}
                      onClick={() => void apply(insight)}
                    >
                      {t('insights.apply')}
                    </PrimaryButton>
                  ) : null}
                  {insight.appliedAt !== null ? (
                    <span
                      className="text-sm text-[var(--puls-finance-text)]"
                      data-testid="insight-applied"
                    >
                      {t('insights.applied')}
                    </span>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      <SupportSection resources={support} />

      {loading ? null : (
        <div>
          <GhostButton type="button" onClick={() => void reload()} disabled={loading}>
            {t('common.retry')}
          </GhostButton>
        </div>
      )}
    </div>
  );
}

/** Контакты поддержки по стране пользователя (ТЗ §3.5) — без диагнозов. */
function SupportSection({ resources }: { resources: SupportResourceDto[] }) {
  const { t } = useT();
  if (resources.length === 0) return null;

  return (
    <div
      data-testid="insights-support"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-wellbeing-soft)] p-5 sm:p-6"
    >
      <div className="flex items-center gap-3">
        <IconBubble name="shield" tone="wellbeing" size={36} />
        <h2 className="text-lg font-bold text-[var(--puls-wellbeing-text)]">
          {t('insights.support.title')}
        </h2>
      </div>
      <p className="text-sm text-[var(--puls-ink-muted)]">{t('insights.support.hint')}</p>
      <ul className="flex flex-col gap-3">
        {resources.map((resource) => (
          <li
            key={resource.country}
            className="flex flex-col gap-1 rounded-[18px] bg-[var(--puls-surface)] p-4"
          >
            <span className="font-medium">{t(resource.nameKey)}</span>
            <span className="text-sm text-[var(--puls-ink-muted)]">
              {t(resource.descriptionKey)}
            </span>
            <span className="flex flex-wrap gap-3 text-sm">
              {resource.phone ? (
                <a
                  href={`tel:${resource.phone.replace(/[^+\d]/g, '')}`}
                  className="font-medium text-[var(--puls-primary-text)]"
                >
                  {resource.phone}
                </a>
              ) : null}
              {resource.url ? (
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--puls-primary-text)]"
                >
                  {t('insights.support.site')}
                </a>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
