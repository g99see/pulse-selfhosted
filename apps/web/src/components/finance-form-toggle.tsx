// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useState, type ReactNode } from 'react';
import { useT } from '@/components/locale-provider';
import { Icon } from '@/components/icons';
import { GhostButton } from '@/components/ui';

/** Свёрнутая по умолчанию форма: кнопка «Новый …» раскрывает поля, повторное нажатие сворачивает. */
export function FormToggle({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <GhostButton
        type="button"
        data-testid={testId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 self-start"
      >
        <Icon name={open ? 'close' : 'plus'} size={18} />
        {open ? t('finance.form.hide') : label}
      </GhostButton>
      {open ? (
        <div className="rounded-[var(--radius-tile)] bg-[var(--puls-surface-2)] p-4 sm:p-5">
          {children}
        </div>
      ) : null}
    </div>
  );
}
