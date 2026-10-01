// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { DataPrivacySection } from '@/components/data-privacy-section';
import { AiKeySection } from '@/components/ai-key-section';
import { ApiAccessSection } from '@/components/api-access-section';
import { LinkedAccountsSection } from '@/components/linked-accounts-section';
import { TelegramSection } from '@/components/telegram-section';
import { TwoFactorSection } from '@/components/two-factor-section';
import { useT } from '@/components/locale-provider';

/**
 * Настройки (ТЗ §8, экран «Настройки»). Здесь живёт секция «Данные и
 * приватность» (ТЗ §3.1, §6): экспорт JSON/CSV и удаление аккаунта.
 */
export default function SettingsPage() {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-extrabold">{t('settings.title')}</h1>

      <DataPrivacySection />
      <AiKeySection />
      <ApiAccessSection />
      <LinkedAccountsSection />
      <TelegramSection />
      <TwoFactorSection />
    </div>
  );
}
