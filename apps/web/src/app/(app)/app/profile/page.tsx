// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { InstallPrompt } from '@/components/install-prompt';
import { useT } from '@/components/locale-provider';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { NotificationSettings } from '@/components/notification-settings';
import { ThemeToggle } from '@/components/theme-toggle';
import { Card } from '@/components/ui';

/** Профиль и настройки: тема, язык и установка PWA (ТЗ §7, §8). */
export default function ProfileSettingsPage() {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-extrabold">{t('settings.title')}</h1>

      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-bold">{t('settings.appearance')}</h2>
        <ThemeToggle />
        <LocaleSwitcher />
      </Card>

      <Card>
        <InstallPrompt />
      </Card>

      <NotificationSettings />
    </div>
  );
}
