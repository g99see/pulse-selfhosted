// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Currency, StatsDayResponse } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { MASKED_AMOUNT } from '@/components/money';
import { Card } from '@/components/ui';
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
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{t('stats.title')}</h2>
          <Link href="/stats" className="text-sm font-medium text-[var(--puls-primary-text)]">
            {t('stats.today.more')}
          </Link>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-[var(--puls-ink-muted)]">{t('stats.today.spent')}</dt>
            <dd
              className="text-lg font-bold text-[var(--puls-warning-text)] [font-variant-numeric:tabular-nums]"
              data-testid="today-spent"
            >
              {day ? money(day.spent) : dash}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--puls-ink-muted)]">{t('stats.today.earned')}</dt>
            <dd className="text-lg font-bold text-[var(--puls-finance-text)] [font-variant-numeric:tabular-nums]">
              {day ? money(day.earned) : dash}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--puls-ink-muted)]">{t('stats.today.mood')}</dt>
            <dd className="text-lg font-bold [font-variant-numeric:tabular-nums]">
              {day?.avgMood === null || day === null ? dash : day.avgMood}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--puls-ink-muted)]">{t('stats.today.checkins')}</dt>
            <dd className="text-lg font-bold [font-variant-numeric:tabular-nums]">
              {day ? day.checkins : dash}
            </dd>
          </div>
        </dl>

        <p className="text-sm text-[var(--puls-ink-muted)]">
          {t('stats.today.budgetLeft')}:{' '}
          <span className="font-semibold text-[var(--puls-ink)] [font-variant-numeric:tabular-nums]">
            {day && day.budgetLimit > 0 ? money(day.budgetRemaining) : t('stats.day.noBudget')}
          </span>
        </p>
      </Card>
    </div>
  );
}
