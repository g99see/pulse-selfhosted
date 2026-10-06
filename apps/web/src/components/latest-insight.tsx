// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { InsightDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { categoryLabel } from '@/lib/category-label';
import { Card, EmptyState, IconBubble } from '@/components/ui';
import { insightsApi } from '@/lib/insights-client';

/**
 * Блок последнего инсайта на главной (ТЗ §8, «Главная (сегодня)»: последний
 * инсайт). Ошибка не критична — блок просто остаётся пустым.
 */
export function LatestInsight() {
  const { t } = useT();
  const [insight, setInsight] = useState<InsightDto | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    insightsApi
      .latest()
      .then((response) => {
        if (active) setInsight(response.insight);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div data-testid="latest-insight" className="min-h-[160px]">
      <Card className="flex h-full flex-col gap-3 !bg-[var(--puls-primary-soft)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconBubble name="sparkle" tone="primary" />
            <h2 className="font-heading text-lg font-bold text-[var(--puls-primary-text)]">
              {t('insights.latest.title')}
            </h2>
          </div>
          <Link
            href="/insights"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--puls-primary-text)]"
          >
            {t('insights.more')}
          </Link>
        </div>
        {!loaded ? null : insight ? (
          <p className="text-sm text-[var(--puls-ink)]">
            {t(insight.textKey, {
              ...insight.params,
              ...(typeof insight.params.category === 'string' && insight.params.category
                ? { category: categoryLabel({ name: insight.params.category }, t) }
                : {}),
            })}
          </p>
        ) : (
          <EmptyState
            icon="sparkle"
            tone="primary"
            title={t('insights.latest.none')}
            action={
              <Link
                href="/insights"
                className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--puls-primary-text)] underline"
              >
                {t('app.today.insightCta')}
              </Link>
            }
          />
        )}
      </Card>
    </div>
  );
}
