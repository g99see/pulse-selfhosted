// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { nearestScheduledTime, slotForHour } from '../src/lib/checkin';

describe('slotForHour (ТЗ §3.3)', () => {
  it('делит день на утро, день и вечер', () => {
    expect(slotForHour(7)).toBe('morning');
    expect(slotForHour(11)).toBe('morning');
    expect(slotForHour(12)).toBe('day');
    expect(slotForHour(17)).toBe('day');
    expect(slotForHour(18)).toBe('evening');
    expect(slotForHour(23)).toBe('evening');
  });
});

describe('nearestScheduledTime (ТЗ §3.3)', () => {
  it('возвращает ближайшее время из расписания', () => {
    const times = ['09:00', '15:00', '21:00'];
    expect(nearestScheduledTime(times, new Date(2026, 9, 1, 10, 0))).toBe('09:00');
    expect(nearestScheduledTime(times, new Date(2026, 9, 1, 14, 30))).toBe('15:00');
    expect(nearestScheduledTime(times, new Date(2026, 9, 1, 20, 0))).toBe('21:00');
  });

  it('без расписания возвращает null', () => {
    expect(nearestScheduledTime([], new Date(2026, 9, 1, 10, 0))).toBeNull();
  });
});
