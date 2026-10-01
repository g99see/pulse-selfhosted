// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { InstallPrompt } from '@/components/install-prompt';
import { useT } from '@/components/locale-provider';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { NotificationSettings } from '@/components/notification-settings';
import { ProfileEditor } from '@/components/profile-editor';
import { ThemeToggle } from '@/components/theme-toggle';
import { Card } from '@/components/ui';
import Link from 'next/link';

/** Профиль и настройки: тема, язык и установка PWA (ТЗ §7, §8). */
export default function ProfileSettingsPage() {
  const { t } = useT();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-extrabold">{t('settings.title')}</h1>

      <ProfileEditor />

      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-bold">{t('settings.appearance')}</h2>
        <ThemeToggle />
        <LocaleSwitcher />
      </Card>

      <Card>
        <InstallPrompt />
      </Card>

      <NotificationSettings />

      <Card className="flex items-center justify-between gap-3">
        <span className="font-semibold">{t('htmlPage.link')}</span>
        <Link
          href="/page-editor"
          data-testid="open-page-editor"
          className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
        >
          {t('htmlPage.title')}
        </Link>
      </Card>

      <Card className="flex items-center justify-between gap-3">
        <span className="font-semibold">{t('settings.data.title')}</span>
        <Link
          href="/settings"
          data-testid="open-data-privacy"
          className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
        >
          {t('settings.data.exportJson')} / {t('settings.data.exportCsv')}
        </Link>
      </Card>
    </div>
  );
}
