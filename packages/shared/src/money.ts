// SPDX-License-Identifier: AGPL-3.0-or-later
export const CURRENCIES = ['RUB', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export type TransactionType = 'expense' | 'income';

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

/** Форматирование суммы по локали (ТЗ §8: цифры табличные, валюта по локали). */
export function formatMoney(amount: number, currency: Currency = 'RUB', locale = 'ru-RU'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export interface QuickTransaction {
  title: string;
  amount: number;
  type: TransactionType;
}

const QUICK_INPUT_RE = /^(?<title>.*?)\s*(?<sign>[+-])?\s*(?<amount>\d{1,9}(?:[.,]\d{1,2})?)\s*$/u;

/**
 * Быстрый ввод одной строкой (ТЗ §4, P1): «кофе 250», «зарплата +80000», «такси -300».
 * @returns разобранную транзакцию или null, если строка не распознана.
 */
export function parseQuickTransaction(
  input: string,
  defaultType: TransactionType = 'expense',
): QuickTransaction | null {
  const match = QUICK_INPUT_RE.exec(input.trim());
  if (!match?.groups) return null;

  const title = match.groups.title.trim();
  if (title.length === 0) return null;

  const amount = Number(match.groups.amount.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const type: TransactionType =
    match.groups.sign === '+' ? 'income' : match.groups.sign === '-' ? 'expense' : defaultType;

  return { title, amount, type };
}
