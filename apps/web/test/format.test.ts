// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { formatDate, formatMoneyLocale, formatNumber } from '../src/lib/format';

const DAY = new Date('2026-01-15T12:00:00Z');

describe('форматы по локали (ТЗ §6: даты и валюты)', () => {
  it('форматирует даты по правилам локали', () => {
    expect(formatDate(DAY, 'ru')).toContain('янв');
    expect(formatDate(DAY, 'en')).toContain('Jan');
    expect(formatDate(DAY, 'en')).toContain('2026');
  });

  it('форматирует суммы с валютой локали', () => {
    expect(formatMoneyLocale(1234.5, 'ru', 'RUB')).toContain('₽');
    expect(formatMoneyLocale(1234.5, 'en', 'RUB')).toContain('RUB');
    expect(formatMoneyLocale(1234.5, 'en', 'USD')).toContain('$');
  });

  it('разделяет разряды по правилам локали', () => {
    expect(formatNumber(1234567.5, 'ru')).toMatch(/1\s234\s567,5/);
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.5');
  });

  it('принимает строки и числа дат', () => {
    expect(formatDate('2026-01-15T12:00:00Z', 'en')).toContain('2026');
  });
});
