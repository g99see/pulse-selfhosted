// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

/**
 * Секция «Режим Тишина» в настройках (ТЗ §4, P1): объясняет, что суммы
 * скрываются на всех экранах, и показывает переключатель.
 */
import { useT } from '@/components/locale-provider';
import { QuietModeToggle } from '@/components/quiet-mode-toggle';
import { Card } from '@/components/ui';

export function QuietModeSection() {
  const { t } = useT();

  return (
    <div data-testid="quiet-settings">
      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">{t('quiet.settings.title')}</h2>
        <p className="text-sm text-[var(--puls-ink-muted)]">{t('quiet.settings.description')}</p>
        <div>
          <QuietModeToggle
            testId="quiet-settings-toggle"
            className="inline-flex h-11 w-fit items-center gap-2 rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-4 text-sm font-semibold text-[var(--puls-primary-text)] transition-opacity duration-150 hover:opacity-90"
          />
        </div>
        <p className="text-xs text-[var(--puls-ink-muted)]">{t('quiet.settings.hint')}</p>
      </Card>
    </div>
  );
}
