// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { Card } from '@/components/ui';
import { t } from '@/lib/i18n';

/** Главная кабинета: пока приветствие и подтверждение завершённого онбординга. */
export default function AppHomePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-extrabold">{t('app.today.title')}</h1>

      <Card>
        <p className="text-[var(--puls-finance)]">{t('app.today.onboardingDone')}</p>
        <p className="mt-2 text-sm text-[var(--puls-ink-muted)]">{t('app.today.nextPhase')}</p>
      </Card>
    </div>
  );
}
