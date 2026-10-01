// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты мультивалютности (ТЗ §3.2): конвертация, кросс-курс через базовую
// валюту, ближайший курс на дату и округление денег/курса.
import { describe, expect, it } from 'vitest';
import {
  convertToBase,
  crossRate,
  nearestRate,
  pickRate,
  roundRate,
  type RatePoint,
} from '../src/currency';
import {
  AccountCreateSchema,
  ExchangeRateCreateSchema,
  TransactionCreateSchema,
  TransferCreateSchema,
} from '../src/finance';

const rates: RatePoint[] = [
  { date: '2026-09-01', base: 'USD', quote: 'RUB', rate: 90 },
  { date: '2026-09-10', base: 'USD', quote: 'RUB', rate: 92 },
  { date: '2026-10-01', base: 'USD', quote: 'RUB', rate: 95 },
  { date: '2026-10-01', base: 'EUR', quote: 'RUB', rate: 100 },
];

describe('nearestRate', () => {
  it('возвращает курс на точную дату', () => {
    expect(nearestRate(rates, 'USD', 'RUB', '2026-10-01')).toBe(95);
  });

  it('если на дату курса нет — берёт последний предыдущий', () => {
    expect(nearestRate(rates, 'USD', 'RUB', '2026-09-20')).toBe(92);
    expect(nearestRate(rates, 'USD', 'RUB', '2026-09-01')).toBe(90);
  });

  it('игнорирует будущие курсы и возвращает null, если предыдущих нет', () => {
    expect(nearestRate(rates, 'USD', 'RUB', '2026-08-31')).toBeNull();
    expect(nearestRate(rates, 'USD', 'RUB', '2026-09-01')).toBe(90);
  });

  it('понимает обратную пару', () => {
    expect(nearestRate(rates, 'RUB', 'USD', '2026-10-01')).toBeCloseTo(1 / 95, 8);
  });
});

describe('pickRate', () => {
  it('возвращает курс и дату последнего предыдущего', () => {
    expect(pickRate(rates, 'USD', 'RUB', '2026-09-20')).toEqual({
      date: '2026-09-10',
      rate: 92,
    });
  });

  it('возвращает null, если данных нет', () => {
    expect(pickRate(rates, 'USD', 'EUR', '2026-10-01')).toBeNull();
  });
});

describe('crossRate', () => {
  it('одна валюта — курс 1', () => {
    expect(crossRate(rates, 'USD', 'USD', 'RUB', '2026-10-01')).toBe(1);
  });

  it('прямая пара', () => {
    expect(crossRate(rates, 'USD', 'RUB', 'RUB', '2026-10-01')).toBe(95);
  });

  it('кросс-курс через базовую валюту RUB', () => {
    // 1 EUR = 100 RUB, 1 USD = 95 RUB → 1 EUR = 100/95 USD
    expect(crossRate(rates, 'EUR', 'USD', 'RUB', '2026-10-01')).toBeCloseTo(100 / 95, 8);
  });

  it('кросс-курс, когда базовая валюта — одна из пары', () => {
    const withGbp = [...rates, { date: '2026-10-01', base: 'GBP', quote: 'RUB', rate: 114 }];
    // 1 RUB = 1/114 GBP — через базовую RUB обратным курсом GBP/RUB.
    expect(crossRate(withGbp, 'RUB', 'GBP', 'RUB', '2026-10-01')).toBeCloseTo(1 / 114, 8);
    expect(crossRate(withGbp, 'GBP', 'RUB', 'GBP', '2026-10-01')).toBe(114);
  });

  it('нет данных — null', () => {
    expect(crossRate(rates, 'GBP', 'RUB', 'RUB', '2026-10-01')).toBeNull();
  });
});

describe('convertToBase', () => {
  it('умножает сумму на курс и округляет до копеек', () => {
    expect(convertToBase(100, 95)).toBe(9500);
    expect(convertToBase(33.33, 3.77)).toBe(125.65);
    expect(convertToBase(10, 90.123456789)).toBe(901.23);
  });
});

describe('roundRate', () => {
  it('округляет курс до 8 знаков (точность Decimal(18,8))', () => {
    expect(roundRate(90.123456789)).toBe(90.12345679);
    expect(roundRate(1 / 3)).toBe(0.33333333);
  });
});

describe('схемы мультивалютности (ТЗ §3.2)', () => {
  it('AccountCreateSchema принимает валюту из набора', () => {
    const parsed = AccountCreateSchema.parse({ name: 'USD счёт', currency: 'usd' });
    expect(parsed.currency).toBe('USD');
    expect(AccountCreateSchema.safeParse({ name: 'счёт', currency: 'GBP' }).success).toBe(false);
  });

  it('TransactionCreateSchema принимает валюту и курс', () => {
    const parsed = TransactionCreateSchema.parse({ accountId: 'a', amount: 10, currency: 'usd', rate: 95 });
    expect(parsed.currency).toBe('USD');
    expect(parsed.rate).toBe(95);
    expect(TransactionCreateSchema.safeParse({ accountId: 'a', amount: 10, rate: 0 }).success).toBe(false);
  });

  it('ExchangeRateCreateSchema требует разные валюты и положительный курс', () => {
    const parsed = ExchangeRateCreateSchema.parse({
      date: '2026-10-01',
      base: 'USD',
      quote: 'RUB',
      rate: 95,
    });
    expect(parsed).toMatchObject({ base: 'USD', quote: 'RUB', rate: 95, source: 'manual' });
    expect(
      ExchangeRateCreateSchema.safeParse({ date: '2026-10-01', base: 'USD', quote: 'USD', rate: 1 }).success,
    ).toBe(false);
    expect(
      ExchangeRateCreateSchema.safeParse({ date: '2026-10-01', base: 'USD', quote: 'RUB', rate: -1 }).success,
    ).toBe(false);
  });

  it('TransferCreateSchema принимает вторую сумму перевода', () => {
    const parsed = TransferCreateSchema.parse({
      fromAccountId: 'a',
      toAccountId: 'b',
      amount: 100,
      toAmount: 9500,
    });
    expect(parsed.toAmount).toBe(9500);
  });
});
