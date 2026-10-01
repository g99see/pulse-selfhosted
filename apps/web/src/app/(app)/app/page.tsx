// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { CheckInCard } from '@/components/checkin-card';
import { TodayStats } from '@/components/today-stats';
import { useT } from '@/components/locale-provider';
import { Card } from '@/components/ui';

/** Главная кабинета (ТЗ §8): карточка чек-ина, дашборд дня и онбординг. */
export default function AppHomePage() {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-extrabold">{t('app.today.title')}</h1>

      <CheckInCard />

      <TodayStats />

      <Card>
        <p className="text-[var(--puls-finance-text)]">{t('app.today.onboardingDone')}</p>
        <p className="mt-2 text-sm text-[var(--puls-ink-muted)]">{t('app.today.nextPhase')}</p>
      </Card>
    </div>
  );
}
