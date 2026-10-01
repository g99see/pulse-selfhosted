// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { InsightDto } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Card } from '@/components/ui';
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

  if (!loaded) return null;

  return (
    <div data-testid="latest-insight">
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{t('insights.latest.title')}</h2>
          <Link href="/insights" className="text-sm font-medium text-[var(--puls-primary-text)]">
            {t('insights.more')}
          </Link>
        </div>
        <p className="text-sm">
          {insight ? t(insight.textKey, insight.params) : t('insights.latest.none')}
        </p>
      </Card>
    </div>
  );
}
