// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import type { ReactNode } from 'react';
import { DaySummarySection } from '@/components/day-summary-section';
import { DataPrivacySection } from '@/components/data-privacy-section';
import { AiKeySection } from '@/components/ai-key-section';
import { ApiAccessSection } from '@/components/api-access-section';
import { LinkedAccountsSection } from '@/components/linked-accounts-section';
import { QuietModeSection } from '@/components/quiet-mode-section';
import { NotificationSettings } from '@/components/notification-settings';
import { useT } from '@/components/locale-provider';

/**
 * Настройки (ТЗ §8, экран «Настройки»). Здесь живёт секция «Данные и
 * приватность» (ТЗ §3.1, §6): экспорт JSON/CSV и удаление аккаунта.
 */
export default function SettingsPage() {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-extrabold">{t('settings.title')}</h1>

      <SettingsGroup title={t('settings.group.privacy')}>
        <QuietModeSection />
        <DaySummarySection />
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.accounts')}>
        <LinkedAccountsSection />
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.notifications')}>
        <NotificationSettings />
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.data')}>
        <DataPrivacySection />
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.api')}>
        <AiKeySection />
        <ApiAccessSection />
      </SettingsGroup>
    </div>
  );
}

/** Группа настроек: заголовок раздела над стопкой карточек. */
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 font-heading text-sm font-bold tracking-wide text-[var(--puls-ink-muted)] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
