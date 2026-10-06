// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Currency, StatsDayResponse } from '@puls/shared';
import { QUICK_ADD_EVENT } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import { useT } from '@/components/locale-provider';
import { MASKED_AMOUNT } from '@/components/money';
import { Card, MonitorTile, ProgressBar, StatTile } from '@/components/ui';
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
          <Link
            href="/stats"
            className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--puls-primary-text)]"
          >
            {t('stats.today.more')}
          </Link>
        </div>

        <div className="grid min-h-[88px] grid-cols-2 gap-3 md:grid-cols-3">
          <MonitorTile
            label={t('stats.today.spent')}
            testId="today-spent"
            value={<span>{day ? money(day.spent) : dash}</span>}
          >
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(QUICK_ADD_EVENT))}
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-button)] bg-[var(--puls-on-primary)] px-4 text-sm font-semibold text-[var(--puls-primary)]"
            >
              <Icon name="plus" size={18} strokeWidth={2.4} />
              {t('app.nav.add')}
            </button>
          </MonitorTile>
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

        {day && (day.avgEnergy !== null || day.avgStress !== null || day.avgSleep !== null) ? (
          <div className="grid grid-cols-3 gap-3" data-testid="today-wellbeing">
            <StatTile
              tone="wellbeing"
              icon="heart"
              label={t('stats.today.energy')}
              testId="today-energy"
              value={day.avgEnergy === null ? dash : day.avgEnergy}
            />
            <StatTile
              tone="primary"
              icon="heart"
              label={t('stats.today.stress')}
              testId="today-stress"
              value={day.avgStress === null ? dash : day.avgStress}
            />
            <StatTile
              tone="wellbeing"
              icon="heart"
              label={t('stats.today.sleep')}
              testId="today-sleep"
              value={day.avgSleep === null ? dash : day.avgSleep}
            />
          </div>
        ) : null}

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
