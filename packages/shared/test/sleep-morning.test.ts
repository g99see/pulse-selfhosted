// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  SLEEP_MORNING_END_HOUR,
  SLEEP_MORNING_START_HOUR,
  isMorningForSleep,
} from '../src/checkin';

describe('окно вопроса о сне (утро пользователя 04:00–12:00)', () => {
  it('границы окна по локальному часу', () => {
    expect(isMorningForSleep(new Date('2026-10-01T03:59:00Z'), 'UTC')).toBe(false);
    expect(isMorningForSleep(new Date('2026-10-01T04:00:00Z'), 'UTC')).toBe(true);
    expect(isMorningForSleep(new Date('2026-10-01T11:59:00Z'), 'UTC')).toBe(true);
    expect(isMorningForSleep(new Date('2026-10-01T12:00:00Z'), 'UTC')).toBe(false);
  });

  it('считает по часовому поясу пользователя', () => {
    const moment = new Date('2026-10-01T01:00:00Z');
    expect(isMorningForSleep(moment, 'Europe/Moscow')).toBe(true); // 04:00
    expect(isMorningForSleep(moment, 'Asia/Tokyo')).toBe(true); // 10:00
    expect(isMorningForSleep(moment, 'UTC')).toBe(false); // 01:00
    expect(isMorningForSleep(moment, 'America/New_York')).toBe(false); // 21:00 прошлого дня
  });

  it('неизвестный пояс не роняет вызов', () => {
    expect(typeof isMorningForSleep(new Date('2026-10-01T06:00:00Z'), 'Nowhere/Nope')).toBe(
      'boolean',
    );
  });

  it('константы окна: начало 4, конец 12 (не включительно)', () => {
    expect(SLEEP_MORNING_START_HOUR).toBe(4);
    expect(SLEEP_MORNING_END_HOUR).toBe(12);
  });
});
