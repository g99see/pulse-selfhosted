// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты чистой логики формы курса валют (ТЗ §3.2).
import { describe, expect, it } from 'vitest';
import { CURRENCY_OPTIONS, parseRateValue, validateRateForm } from '../src/lib/currency-form';

describe('parseRateValue', () => {
  it('принимает точку и запятую как разделитель', () => {
    expect(parseRateValue('95.5')).toBe(95.5);
    expect(parseRateValue('95,5')).toBe(95.5);
    expect(parseRateValue(' 90 ')).toBe(90);
  });

  it('отклоняет ноль, отрицательные и мусор', () => {
    expect(parseRateValue('0')).toBeNull();
    expect(parseRateValue('-5')).toBeNull();
    expect(parseRateValue('abc')).toBeNull();
    expect(parseRateValue('')).toBeNull();
  });
});

describe('validateRateForm', () => {
  it('принимает разные валюты и положительный курс', () => {
    const result = validateRateForm({ date: '2026-10-01', base: 'USD', quote: 'RUB', rate: '95' });
    expect(result).toEqual({ ok: true, rate: 95 });
  });

  it('отклоняет одинаковые валюты', () => {
    const result = validateRateForm({ date: '2026-10-01', base: 'USD', quote: 'USD', rate: '95' });
    expect(result.ok).toBe(false);
    expect(result.errorKey).toBe('finance.rates.error.sameCurrency');
  });

  it('отклоняет неизвестную валюту', () => {
    expect(validateRateForm({ date: '2026-10-01', base: 'USD', quote: 'GBP', rate: '95' }).ok).toBe(false);
  });

  it('отклоняет неположительный курс', () => {
    const result = validateRateForm({ date: '2026-10-01', base: 'USD', quote: 'RUB', rate: '0' });
    expect(result.ok).toBe(false);
    expect(result.errorKey).toBe('finance.rates.error.rate');
  });
});

describe('CURRENCY_OPTIONS', () => {
  it('содержит RUB, USD и EUR', () => {
    expect(CURRENCY_OPTIONS.map((option) => option.value)).toEqual(['RUB', 'USD', 'EUR']);
  });
});
