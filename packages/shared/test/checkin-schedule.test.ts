// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  CHECKIN_BACKDATE_HOURS,
  DEFAULT_CHECKIN_SCHEDULE,
  CheckInScheduleSchema,
  dayBoundsInTimeZone,
  isWithinBackdateWindow,
} from '../src/checkin';

describe('расписание чек-инов (ТЗ §3.3)', () => {
  it('по умолчанию — 3 раза в день (утро, день, вечер)', () => {
    expect(DEFAULT_CHECKIN_SCHEDULE.timesPerDay).toBe(3);
    expect(DEFAULT_CHECKIN_SCHEDULE.times).toHaveLength(3);
    expect(CheckInScheduleSchema.parse(DEFAULT_CHECKIN_SCHEDULE)).toEqual(DEFAULT_CHECKIN_SCHEDULE);
  });

  it('принимает от 1 до 6 напоминаний', () => {
    expect(CheckInScheduleSchema.parse({ timesPerDay: 1, times: ['09:00'] }).timesPerDay).toBe(1);
    expect(
      CheckInScheduleSchema.parse({
        timesPerDay: 6,
        times: ['07:00', '09:00', '12:00', '15:00', '18:00', '21:00'],
      }).times,
    ).toHaveLength(6);
  });

  it('отклоняет число вне 1–6 и несовпадение длины', () => {
    expect(() => CheckInScheduleSchema.parse({ timesPerDay: 0, times: [] })).toThrow();
    expect(() => CheckInScheduleSchema.parse({ timesPerDay: 7, times: ['07:00'] })).toThrow();
    expect(() => CheckInScheduleSchema.parse({ timesPerDay: 3, times: ['09:00'] })).toThrow();
  });

  it('отклоняет дубликаты и неверный формат времени', () => {
    expect(() =>
      CheckInScheduleSchema.parse({ timesPerDay: 2, times: ['09:00', '09:00'] }),
    ).toThrow();
    expect(() => CheckInScheduleSchema.parse({ timesPerDay: 1, times: ['9:00'] })).toThrow();
    expect(() => CheckInScheduleSchema.parse({ timesPerDay: 1, times: ['25:00'] })).toThrow();
  });
});

describe('заполнение задним числом (ТЗ §3.3)', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  it('принимает время в пределах 24 часов', () => {
    expect(CHECKIN_BACKDATE_HOURS).toBe(24);
    expect(isWithinBackdateWindow(new Date('2026-10-01T11:00:00.000Z'), now)).toBe(true);
    expect(isWithinBackdateWindow(new Date('2026-09-30T12:01:00.000Z'), now)).toBe(true);
  });

  it('отклоняет старше 24 часов', () => {
    expect(isWithinBackdateWindow(new Date('2026-09-30T11:59:00.000Z'), now)).toBe(false);
  });
});

describe('границы дня в часовом поясе пользователя (ТЗ §3.3)', () => {
  it('считает ключ дня и границы суток по зоне', () => {
    // 01.10 22:30 UTC — это уже 02.10 01:30 в Москве (UTC+3).
    const now = new Date('2026-10-01T22:30:00.000Z');
    const { start, end, dayKey } = dayBoundsInTimeZone(now, 'Europe/Moscow');

    expect(dayKey).toBe('2026-10-02');
    expect(start.toISOString()).toBe('2026-10-01T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-02T21:00:00.000Z');
  });

  it('для UTC совпадает с календарными сутками UTC', () => {
    const now = new Date('2026-10-01T05:00:00.000Z');
    const { start, end, dayKey } = dayBoundsInTimeZone(now, 'UTC');

    expect(dayKey).toBe('2026-10-01');
    expect(start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });
});
