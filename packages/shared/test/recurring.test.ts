// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты регулярных платежей (ТЗ §3.2): расчёт следующей даты с учётом
// конца месяца, високосного года и часового пояса (включая переходы DST),
// плюс схемы API.
import { describe, expect, it } from 'vitest';
import {
  RecurringPaymentCreateSchema,
  RecurringPaymentUpdateSchema,
  advanceOccurrence,
  clampDayToMonth,
  formatDateOnly,
  isLeapYear,
  isOccurrenceDate,
  nextOccurrence,
  nextOccurrenceDate,
  type RecurrenceRule,
} from '../src/recurring';
import { daysInMonth } from '../src/stats';

const monthly = (day: number): RecurrenceRule => ({ frequency: 'monthly', day });
const weekly = (day: number): RecurrenceRule => ({ frequency: 'weekly', day });
const yearly = (month: number, day: number): RecurrenceRule => ({ frequency: 'yearly', day, month });

describe('длина месяца и високосный год (ТЗ §3.2)', () => {
  it('определяет високосный год, включая вековые исключения', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('считает дни месяца', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it('прижимает 31-е к концу месяца: 30/28/29', () => {
    expect(clampDayToMonth(2026, 1, 31)).toBe(31);
    expect(clampDayToMonth(2026, 2, 31)).toBe(28);
    expect(clampDayToMonth(2028, 2, 31)).toBe(29);
    expect(clampDayToMonth(2026, 4, 31)).toBe(30);
    expect(clampDayToMonth(2026, 2, 28)).toBe(28);
  });
});

describe('nextOccurrenceDate (ТЗ §3.2)', () => {
  it('для ежемесячного платежа берёт 31-е и прижимает к концу месяца', () => {
    expect(nextOccurrenceDate({ year: 2026, month: 1, day: 15 }, monthly(31))).toEqual({
      year: 2026,
      month: 1,
      day: 31,
    });
    expect(nextOccurrenceDate({ year: 2026, month: 1, day: 31 }, monthly(31))).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(nextOccurrenceDate({ year: 2026, month: 2, day: 28 }, monthly(31))).toEqual({
      year: 2026,
      month: 3,
      day: 31,
    });
    expect(nextOccurrenceDate({ year: 2026, month: 4, day: 30 }, monthly(31))).toEqual({
      year: 2026,
      month: 5,
      day: 31,
    });
  });

  it('учитывает високосный февраль', () => {
    expect(nextOccurrenceDate({ year: 2028, month: 1, day: 31 }, monthly(31))).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  it('для середины месяца не смещает день', () => {
    expect(nextOccurrenceDate({ year: 2026, month: 2, day: 1 }, monthly(15))).toEqual({
      year: 2026,
      month: 2,
      day: 15,
    });
    expect(nextOccurrenceDate({ year: 2026, month: 2, day: 20 }, monthly(15))).toEqual({
      year: 2026,
      month: 3,
      day: 15,
    });
  });

  it('для еженедельного платежа находит следующий день недели', () => {
    // 2026-10-01 — четверг; ближайший понедельник — 5 октября.
    expect(nextOccurrenceDate({ year: 2026, month: 10, day: 1 }, weekly(1))).toEqual({
      year: 2026,
      month: 10,
      day: 5,
    });
    // Ровно в понедельник берём следующий понедельник.
    expect(nextOccurrenceDate({ year: 2026, month: 10, day: 5 }, weekly(1))).toEqual({
      year: 2026,
      month: 10,
      day: 12,
    });
    expect(nextOccurrenceDate({ year: 2026, month: 10, day: 1 }, weekly(7))).toEqual({
      year: 2026,
      month: 10,
      day: 4,
    });
  });

  it('для ежегодного платежа учитывает месяц и 29 февраля', () => {
    expect(nextOccurrenceDate({ year: 2026, month: 6, day: 1 }, yearly(2, 29))).toEqual({
      year: 2027,
      month: 2,
      day: 28,
    });
    expect(nextOccurrenceDate({ year: 2027, month: 6, day: 1 }, yearly(2, 29))).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(nextOccurrenceDate({ year: 2028, month: 3, day: 1 }, yearly(2, 29))).toEqual({
      year: 2029,
      month: 2,
      day: 28,
    });
    expect(nextOccurrenceDate({ year: 2026, month: 1, day: 1 }, yearly(3, 1))).toEqual({
      year: 2026,
      month: 3,
      day: 1,
    });
    expect(nextOccurrenceDate({ year: 2026, month: 3, day: 1 }, yearly(3, 1))).toEqual({
      year: 2027,
      month: 3,
      day: 1,
    });
  });
});

describe('isOccurrenceDate (ТЗ §3.2)', () => {
  it('считает плановой прижатую дату конца месяца', () => {
    expect(isOccurrenceDate({ year: 2026, month: 2, day: 28 }, monthly(31))).toBe(true);
    expect(isOccurrenceDate({ year: 2026, month: 2, day: 27 }, monthly(31))).toBe(false);
    expect(isOccurrenceDate({ year: 2026, month: 10, day: 5 }, weekly(1))).toBe(true);
    expect(isOccurrenceDate({ year: 2026, month: 10, day: 6 }, weekly(1))).toBe(false);
    expect(isOccurrenceDate({ year: 2028, month: 2, day: 29 }, yearly(2, 29))).toBe(true);
    expect(isOccurrenceDate({ year: 2029, month: 2, day: 28 }, yearly(2, 29))).toBe(true);
    expect(isOccurrenceDate({ year: 2029, month: 3, day: 1 }, yearly(2, 29))).toBe(false);
  });
});

describe('nextOccurrence с часовым поясом и DST (ТЗ §3.2)', () => {
  it('считает ближайшее списание в зоне пользователя', () => {
    const schedule = { rule: monthly(1), timeOfDay: '10:00', timezone: 'Europe/Moscow' };
    const next = nextOccurrence(schedule, new Date('2026-09-15T00:00:00Z'));

    expect(next.date).toEqual({ year: 2026, month: 10, day: 1 });
    expect(next.instant.toISOString()).toBe('2026-10-01T07:00:00.000Z');
  });

  it('в день списания до наступления времени оставляет сегодня', () => {
    const schedule = { rule: monthly(1), timeOfDay: '10:00', timezone: 'Europe/Moscow' };
    const next = nextOccurrence(schedule, new Date('2026-10-01T06:00:00Z'));
    expect(next.instant.toISOString()).toBe('2026-10-01T07:00:00.000Z');
  });

  it('после наступления времени переносит на следующий период', () => {
    const schedule = { rule: monthly(1), timeOfDay: '10:00', timezone: 'Europe/Moscow' };
    const next = nextOccurrence(schedule, new Date('2026-10-01T08:00:00Z'));
    expect(next.date).toEqual({ year: 2026, month: 11, day: 1 });
    expect(next.instant.toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });

  it('корректно переходит на летнее время (весна США)', () => {
    const schedule = { rule: monthly(8), timeOfDay: '09:00', timezone: 'America/New_York' };
    const next = nextOccurrence(schedule, new Date('2026-03-07T15:00:00Z'));
    expect(next.date).toEqual({ year: 2026, month: 3, day: 8 });
    expect(next.instant.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('корректно переходит на зимнее время (осень США)', () => {
    const schedule = { rule: monthly(8), timeOfDay: '09:00', timezone: 'America/New_York' };
    const next = nextOccurrence(schedule, new Date('2026-12-07T15:00:00Z'));
    expect(next.date).toEqual({ year: 2026, month: 12, day: 8 });
    expect(next.instant.toISOString()).toBe('2026-12-08T14:00:00.000Z');
  });

  it('в UTC совпадает со стенным временем', () => {
    const schedule = { rule: monthly(1), timeOfDay: '10:00', timezone: 'UTC' };
    const next = nextOccurrence(schedule, new Date('2026-09-15T00:00:00Z'));
    expect(next.instant.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });
});

describe('advanceOccurrence (ТЗ §3.2)', () => {
  it('сдвигает плановую дату на следующий период', () => {
    const schedule = { rule: monthly(31), timeOfDay: '10:00', timezone: 'UTC' };
    const next = advanceOccurrence(schedule, { year: 2026, month: 1, day: 31 });

    expect(next.date).toEqual({ year: 2026, month: 2, day: 28 });
    expect(next.instant.toISOString()).toBe('2026-02-28T10:00:00.000Z');
  });
});

describe('formatDateOnly', () => {
  it('сериализует дату в YYYY-MM-DD', () => {
    expect(formatDateOnly({ year: 2026, month: 2, day: 8 })).toBe('2026-02-08');
  });
});

describe('схемы регулярных платежей (ТЗ §3.2)', () => {
  it('подставляет тип, время и активность по умолчанию', () => {
    const parsed = RecurringPaymentCreateSchema.parse({
      name: 'Аренда',
      amount: 30000,
      accountId: 'a1',
      frequency: 'monthly',
      day: 31,
    });
    expect(parsed).toMatchObject({ type: 'expense', timeOfDay: '10:00', active: true });
  });

  it('принимает ежегодный платёж с месяцем', () => {
    const parsed = RecurringPaymentCreateSchema.parse({
      name: 'Страховка',
      amount: 12000,
      accountId: 'a1',
      frequency: 'yearly',
      day: 29,
      month: 2,
    });
    expect(parsed.month).toBe(2);
  });

  it('отклоняет нулевую сумму', () => {
    expect(
      RecurringPaymentCreateSchema.safeParse({
        name: 'x',
        amount: 0,
        accountId: 'a1',
        frequency: 'monthly',
        day: 1,
      }).success,
    ).toBe(false);
  });

  it('отклоняет день недели вне 1–7', () => {
    expect(
      RecurringPaymentCreateSchema.safeParse({
        name: 'x',
        amount: 100,
        accountId: 'a1',
        frequency: 'weekly',
        day: 8,
      }).success,
    ).toBe(false);
  });

  it('отклоняет ежегодный платёж без месяца', () => {
    expect(
      RecurringPaymentCreateSchema.safeParse({
        name: 'x',
        amount: 100,
        accountId: 'a1',
        frequency: 'yearly',
        day: 1,
      }).success,
    ).toBe(false);
  });

  it('частичная правка: пауза/возобновление', () => {
    const parsed = RecurringPaymentUpdateSchema.parse({ active: false });
    expect(parsed).toEqual({ active: false });
  });
});
