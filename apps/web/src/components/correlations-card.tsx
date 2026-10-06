// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import { CORRELATION_MIN_SAMPLES, type CorrelationsResponse } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MASKED_AMOUNT } from '@/components/money';
import { Card } from '@/components/ui';
import { formatMoneyLocale } from '@/lib/format';
import { insightsApi } from '@/lib/insights-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

/**
 * Карточка «Самочувствие и траты» (ТЗ v2 §7): сколько в среднем тратится в
 * «плохие» дни по сну, энергии и настроению. Без выводов при малой выборке.
 */
export function CorrelationsCard() {
  const { t, locale } = useT();
  const quiet = useQuietMode();
  const [data, setData] = useState<CorrelationsResponse | null>(null);

  useEffect(() => {
    let active = true;
    insightsApi
      .correlations()
      .then((response) => {
        if (active) setData(response);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!data) return null;
  const money = (value: number | null): string =>
    value === null ? '—' : quiet ? MASKED_AMOUNT : formatMoneyLocale(value, locale, 'RUB');

  return (
    <Card className="flex flex-col gap-3">
      <div data-testid="correlations-card" className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">{t('insights.correlations.title')}</h2>
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('insights.correlations.hint')}</p>
        </div>
        <ul className="flex flex-col gap-2">
          {data.correlations.map((item) => (
            <li
              key={item.metric}
              data-testid={`correlation-${item.metric}`}
              className="flex flex-col gap-0.5"
            >
              <span className="font-medium">{t(`insights.correlations.${item.metric}`)}</span>
              <span className="text-sm text-[var(--puls-ink-muted)]">
                {item.enough && item.diffPercent !== null
                  ? t('insights.correlations.diff', {
                      percent: `${item.diffPercent > 0 ? '+' : ''}${item.diffPercent}`,
                      bad: money(item.badAverage),
                      good: money(item.goodAverage),
                    })
                  : t('insights.correlations.notEnough', { min: CORRELATION_MIN_SAMPLES })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
