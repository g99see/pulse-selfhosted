// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Currency, StatsDayResponse } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MASKED_AMOUNT } from '@/components/money';
import { Card, ProgressBar, StatTile } from '@/components/ui';
import { FINANCE_CHANGED_EVENT } from '@/lib/finance-client';
import { formatMoneyLocale } from '@/lib/format';
import { statsApi } from '@/lib/stats-client';
import { useQuietMode } from '@/lib/use-quiet-mode';

/**
 * Дашборд дня (ТЗ §3.4, §8): траты, остаток бюджета, среднее настроение и
 * число чек-инов. Обновляется сразу после записи траты — слушает событие
 * финансов и перечитывает сводку.
 */
export function TodayStats() {
  const { t, locale } = useT();
  const quiet = useQuietMode();
  const [day, setDay] = useState<StatsDayResponse | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setDay(await statsApi.day());
    } catch {
      // Блок не критичен для главной — при ошибке просто остаётся пустым.
    }
  }, []);

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

  const currency = (day?.currency ?? 'RUB') as Currency;
  const money = (value: number): string =>
    quiet ? MASKED_AMOUNT : formatMoneyLocale(value, locale, currency);
  const dash = '—';

  return (
    <div data-testid="today-stats">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-xl font-bold">{t('stats.title')}</h2>
          <Link href="/stats" className="text-sm font-medium text-[var(--puls-primary-text)]">
            {t('stats.today.more')}
          </Link>
        </div>

        <div className="grid min-h-[88px] grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            tone="warning"
            icon="wallet"
            label={t('stats.today.spent')}
            testId="today-spent"
            value={
              <span className="[font-variant-numeric:tabular-nums]">
                {day ? money(day.spent) : dash}
              </span>
            }
          />
          <StatTile
            tone="finance"
            icon="chart"
            label={t('stats.today.earned')}
            value={
              <span className="[font-variant-numeric:tabular-nums]">
                {day ? money(day.earned) : dash}
              </span>
            }
          />
          <StatTile
            tone="wellbeing"
            icon="heart"
            label={t('stats.today.mood')}
            value={
              <span className="[font-variant-numeric:tabular-nums]">
                {day === null || day.avgMood === null ? dash : day.avgMood}
              </span>
            }
          />
          <StatTile
            tone="primary"
            icon="check"
            label={t('stats.today.checkins')}
            value={
              <span className="[font-variant-numeric:tabular-nums]">
                {day ? day.checkins : dash}
              </span>
            }
          />
        </div>

        <div className="flex min-h-[44px] flex-col gap-2">
          {day && day.budgetLimit > 0 ? (
            <ProgressBar
              tone={day.budgetRemaining < 0 ? 'warning' : 'finance'}
              label={`${t('stats.today.budgetLeft')}: ${money(day.budgetRemaining)}`}
              value={Math.min(Math.max(day.spent, 0), day.budgetLimit)}
              max={day.budgetLimit}
            />
          ) : (
            <p className="text-sm text-[var(--puls-ink-muted)]">
              {t('stats.today.budgetLeft')}:{' '}
              <span className="font-semibold text-[var(--puls-ink)]">
                {t('stats.day.noBudget')}
              </span>
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
