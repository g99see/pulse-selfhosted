// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { formatMoney, parseQuickTransaction } from '../src/money';
import { percentChange, toDayKey } from '../src/dates';

describe('formatMoney', () => {
  it('formats roubles without decimals for whole amounts', () => {
    const formatted = formatMoney(120000);
    expect(formatted).toContain('120');
    expect(formatted).toContain('₽');
  });
});

describe('parseQuickTransaction', () => {
  it('parses an expense without a sign', () => {
    expect(parseQuickTransaction('кофе 250')).toEqual({
      title: 'кофе',
      amount: 250,
      type: 'expense',
    });
  });

  it('parses income marked with +', () => {
    expect(parseQuickTransaction('зарплата +80000')).toEqual({
      title: 'зарплата',
      amount: 80000,
      type: 'income',
    });
  });

  it('parses an explicit expense with - and decimal comma', () => {
    expect(parseQuickTransaction('такси -300,50')).toEqual({
      title: 'такси',
      amount: 300.5,
      type: 'expense',
    });
  });

  it('honours the default type', () => {
    expect(parseQuickTransaction('премия 5000', 'income')?.type).toBe('income');
  });

  it('returns null when there is no amount or no title', () => {
    expect(parseQuickTransaction('просто текст')).toBeNull();
    expect(parseQuickTransaction('250')).toBeNull();
    expect(parseQuickTransaction('')).toBeNull();
  });
});

describe('dates helpers', () => {
  it('builds a YYYY-MM-DD day key', () => {
    expect(toDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('computes percent change and handles a zero base', () => {
    expect(percentChange(140, 100)).toBe(40);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(50, 0)).toBeNull();
  });
});
