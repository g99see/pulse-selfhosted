// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

/**
 * Обёртка денежной суммы (ТЗ §4, P1): в режиме «Тишина» вместо суммы рисует
 * маску «••••». Скрытая сумма помечается для скринридеров, чтобы значение не
 * терялось молча. Используется там, где сумма показывается отдельным узлом;
 * для сумм внутри составных строк хук useQuietMode применяют напрямую.
 */
import type { Currency } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { formatMoneyLocale } from '@/lib/format';
import { useQuietMode } from '@/lib/use-quiet-mode';

/** Маска скрытой суммы — без букв, чтобы не путалась с текстом. */
export const MASKED_AMOUNT = '••••';

export interface MoneyProps {
  value: number;
  currency?: Currency;
  className?: string;
  testId?: string;
}

export function Money({ value, currency = 'RUB', className, testId }: MoneyProps) {
  const { t, locale } = useT();
  const quiet = useQuietMode();

  return (
    <span
      className={className}
      data-testid={testId}
      data-quiet-masked={quiet ? 'true' : undefined}
      aria-label={quiet ? t('quiet.amountHidden') : undefined}
    >
      {quiet ? MASKED_AMOUNT : formatMoneyLocale(value, locale, currency)}
    </span>
  );
}
