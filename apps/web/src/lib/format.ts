// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Форматы дат, чисел и сумм по локали (ТЗ §6). Обёртки над Intl с тегом
 * ru-RU/en-US из lib/locale.ts, чтобы в компонентах не было строк локалей.
 */
import type { Currency, Locale } from '@puls/shared';
import { formatMoney } from '@puls/shared';
import { localeToBcp47 } from './locale';

/** Сумма с валютой по правилам локали. */
export function formatMoneyLocale(
  amount: number,
  locale: Locale,
  currency: Currency = 'RUB',
): string {
  return formatMoney(amount, currency, localeToBcp47(locale));
}

/** Число (крупные суммы, проценты, счётчики) по правилам локали. */
export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(localeToBcp47(locale), options).format(value);
}

/** Дата по правилам локали; принимает Date, ISO-строку или timestamp. */
export function formatDate(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(localeToBcp47(locale), options).format(date);
}
