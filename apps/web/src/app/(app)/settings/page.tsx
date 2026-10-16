// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { DaySummarySection } from '@/components/day-summary-section';
import { DataPrivacySection } from '@/components/data-privacy-section';
import { AiKeySection } from '@/components/ai-key-section';
import { ApiAccessSection } from '@/components/api-access-section';
import { LinkedAccountsSection } from '@/components/linked-accounts-section';
import { QuietModeSection } from '@/components/quiet-mode-section';
import { NotificationSettings } from '@/components/notification-settings';
import { Card } from '@/components/ui';
import { useT } from '@/components/locale-provider';

/**
 * Настройки (ТЗ §8, экран «Настройки»). Здесь живёт секция «Данные и
 * приватность» (ТЗ §3.1, §6): экспорт JSON/CSV и удаление аккаунта.
 * Фаза 0 (§5): основная группа — «Самочувствие», деньги понижены в отдельную
 * группу-модуль с пометкой «TODO: переделать».
 */
export default function SettingsPage() {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-extrabold">{t('settings.title')}</h1>

      <SettingsGroup title={t('settings.group.wellbeing')}>
        <NotificationSettings />
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.privacy')}>
        <QuietModeSection />
        <DaySummarySection />
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.accounts')}>
        <LinkedAccountsSection />
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.data')}>
        <DataPrivacySection />
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.api')}>
        <AiKeySection />
        <ApiAccessSection />
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.money')} badge={t('app.nav.todoFinance')}>
        <Card className="flex flex-col gap-2">
          <p className="text-sm text-[var(--puls-ink-muted)]">{t('settings.money.hint')}</p>
          <Link
            href="/finance"
            data-testid="settings-money-open"
            className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-[var(--puls-finance-text)]"
          >
            {t('settings.money.open')}
          </Link>
        </Card>
      </SettingsGroup>
    </div>
  );
}

/** Группа настроек: заголовок раздела над стопкой карточек и необязательная пометка. */
function SettingsGroup({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex flex-wrap items-center gap-2 px-1 font-heading text-sm font-bold tracking-wide text-[var(--puls-ink-muted)] uppercase">
        {title}
        {badge ? (
          <span
            data-testid="settings-todo-finance"
            className="text-caption rounded-[var(--radius-chip)] border border-[var(--puls-line-strong)] px-2 py-0.5 font-semibold tracking-wide"
          >
            {badge}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}
