// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { CheckInCard } from '@/components/checkin-card';
import { GoalsCard } from '@/components/goals-card';
import { LatestInsight } from '@/components/latest-insight';
import { TodayStats } from '@/components/today-stats';
import { useT } from '@/components/locale-provider';
import { Card } from '@/components/ui';

/** Главная кабинета (ТЗ §8): карточка чек-ина, дашборд дня и онбординг. */
export default function AppHomePage() {
  const { t, locale } = useT();
  // Баннер «Год в цифрах» показывается с 1 декабря по 31 января (ТЗ §4, P2).
  const showWrapped = useMemo(() => {
    const month = new Date().getMonth();
    return month === 11 || month === 0;
  }, []);

  const dateLine = new Date().toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-extrabold">{t('app.today.title')}</h1>
        <p className="text-sm text-[var(--puls-ink-muted)] first-letter:uppercase">{dateLine}</p>
      </header>

      {showWrapped ? (
        <Card className="flex flex-col gap-2 !bg-[var(--puls-primary-soft)]">
          <div data-testid="wrapped-banner">
            <p className="font-bold">{t('wrapped.banner.title', { year: new Date().getFullYear() })}</p>
            <p className="text-sm text-[var(--puls-ink-muted)]">{t('wrapped.banner.body')}</p>
            <Link
              href="/wrapped"
              className="mt-2 inline-block text-sm font-semibold text-[var(--puls-primary-text)]"
            >
              {t('wrapped.banner.cta')}
            </Link>
          </div>
        </Card>
      ) : null}

      <CheckInCard />

      <TodayStats />

      <div className="grid gap-5 md:grid-cols-2">
        <LatestInsight />
        <GoalsCard />
      </div>
    </div>
  );
}
