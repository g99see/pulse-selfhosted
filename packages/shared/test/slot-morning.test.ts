// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  CHECKIN_DAY_END_HOUR,
  SLEEP_MORNING_END_HOUR,
  SLEEP_MORNING_START_HOUR,
  isMorningForSleep,
  isMorningHour,
  slotForLocalHour,
  slotForUserHour,
} from '../src/checkin';

describe('единое определение «утра» (04:00–12:00 локально)', () => {
  it('окно сна и слот morning используют одни константы', () => {
    expect(SLEEP_MORNING_START_HOUR).toBe(4);
    expect(SLEEP_MORNING_END_HOUR).toBe(12);
    expect(CHECKIN_DAY_END_HOUR).toBe(18);
  });

  it('isMorningHour: 04:00–11:59 да, остальное нет', () => {
    expect(isMorningHour(3)).toBe(false);
    expect(isMorningHour(4)).toBe(true);
    expect(isMorningHour(11)).toBe(true);
    expect(isMorningHour(12)).toBe(false);
    expect(isMorningHour(23)).toBe(false);
  });

  it('isMorningForSleep по поясу', () => {
    expect(isMorningForSleep(new Date('2026-10-01T03:59:00Z'), 'UTC')).toBe(false);
    expect(isMorningForSleep(new Date('2026-10-01T04:00:00Z'), 'UTC')).toBe(true);
    expect(isMorningForSleep(new Date('2026-10-01T11:59:00Z'), 'UTC')).toBe(true);
    expect(isMorningForSleep(new Date('2026-10-01T12:00:00Z'), 'UTC')).toBe(false);
    const moment = new Date('2026-10-01T01:00:00Z');
    expect(isMorningForSleep(moment, 'Europe/Moscow')).toBe(true); // 04:00
    expect(isMorningForSleep(moment, 'UTC')).toBe(false); // 01:00
  });

  it('неизвестный пояс не роняет вызов', () => {
    expect(typeof isMorningForSleep(new Date('2026-10-01T06:00:00Z'), 'Nowhere/Nope')).toBe(
      'boolean',
    );
  });
});

describe('единый слот дня (утро 4–12, день 12–18, вечер 18–4)', () => {
  it('slotForLocalHour разбивает сутки', () => {
    expect(slotForLocalHour(0)).toBe('evening');
    expect(slotForLocalHour(3)).toBe('evening');
    expect(slotForLocalHour(4)).toBe('morning');
    expect(slotForLocalHour(7)).toBe('morning');
    expect(slotForLocalHour(11)).toBe('morning');
    expect(slotForLocalHour(12)).toBe('day');
    expect(slotForLocalHour(17)).toBe('day');
    expect(slotForLocalHour(18)).toBe('evening');
    expect(slotForLocalHour(23)).toBe('evening');
  });

  it('утро слота совпадает с окном сна — 00:00–03:59 больше не «утро»', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(slotForLocalHour(hour) === 'morning').toBe(isMorningHour(hour));
    }
  });

  it('slotForUserHour считает по поясу пользователя', () => {
    const moment = new Date('2026-10-01T01:00:00Z');
    expect(slotForUserHour(moment, 'Europe/Moscow')).toBe('morning'); // 04:00
    expect(slotForUserHour(moment, 'UTC')).toBe('evening'); // 01:00 → вечер
    expect(slotForUserHour(moment, 'America/New_York')).toBe('evening'); // 21:00 пред. дня
    expect(slotForUserHour(new Date('2026-10-01T08:00:00Z'), 'UTC')).toBe('morning'); // 08:00
    expect(slotForUserHour(new Date('2026-10-01T14:00:00Z'), 'UTC')).toBe('day'); // 14:00
  });
});
