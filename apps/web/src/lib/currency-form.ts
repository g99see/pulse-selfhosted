// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистая логика формы курса валют (ТЗ §3.2): разбор и валидация курса,
 * проверка пары валют. В UI остаётся только отрисовка и вызовы API.
 */
import { CURRENCIES, isCurrency } from '@puls/shared';

export interface RateFormInput {
  date: string;
  base: string;
  quote: string;
  rate: string;
}

export interface RateFormResult {
  ok: boolean;
  errorKey?: string;
  rate?: number;
}

/** Варианты валют для выпадающих списков (код как значение). */
export const CURRENCY_OPTIONS: ReadonlyArray<{ value: string }> = CURRENCIES.map((currency) => ({
  value: currency,
}));

/** Разбирает строку курса: положительное число или null. */
export function parseRateValue(value: string): number | null {
  const normalized = Number(value.replace(',', '.').trim());
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

/** Валидация формы курса: разные поддерживаемые валюты и положительный курс. */
export function validateRateForm(input: RateFormInput): RateFormResult {
  if (!isCurrency(input.base) || !isCurrency(input.quote)) {
    return { ok: false, errorKey: 'finance.rates.error.sameCurrency' };
  }
  if (input.base === input.quote) {
    return { ok: false, errorKey: 'finance.rates.error.sameCurrency' };
  }
  const rate = parseRateValue(input.rate);
  if (rate === null) {
    return { ok: false, errorKey: 'finance.rates.error.rate' };
  }
  return { ok: true, rate };
}
