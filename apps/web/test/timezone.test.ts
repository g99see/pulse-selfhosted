// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  hourInTimeZone,
  isoToZonedWallClock,
  timeZoneOffsetMs,
  zonedWallClockToIso,
} from '../src/lib/timezone';

describe('timeZoneOffsetMs', () => {
  it('учитывает летнее время (Europe/Berlin)', () => {
    // Июль — CEST (+02:00), январь — CET (+01:00).
    expect(timeZoneOffsetMs(new Date('2026-07-01T12:00:00.000Z'), 'Europe/Berlin')).toBe(
      2 * 60 * 60 * 1000,
    );
    expect(timeZoneOffsetMs(new Date('2026-01-15T12:00:00.000Z'), 'Europe/Berlin')).toBe(
      1 * 60 * 60 * 1000,
    );
    expect(timeZoneOffsetMs(new Date('2026-01-15T12:00:00.000Z'), 'UTC')).toBe(0);
  });
});

describe('zonedWallClockToIso (QA-2 D4: окно задним числом в поясе профиля)', () => {
  it('переводит настенные часы пояса в абсолютный момент', () => {
    expect(zonedWallClockToIso('2026-07-01T12:00', 'Europe/Berlin')).toBe(
      '2026-07-01T10:00:00.000Z',
    );
    expect(zonedWallClockToIso('2026-01-15T12:00', 'Europe/Berlin')).toBe(
      '2026-01-15T11:00:00.000Z',
    );
    expect(zonedWallClockToIso('2026-01-15T12:00', 'America/New_York')).toBe(
      '2026-01-15T17:00:00.000Z',
    );
  });

  it('возвращает null на мусор', () => {
    expect(zonedWallClockToIso('', 'UTC')).toBeNull();
    expect(zonedWallClockToIso('не дата', 'UTC')).toBeNull();
  });

  it('обратен isoToZonedWallClock', () => {
    const iso = '2026-07-01T10:00:00.000Z';
    const wall = isoToZonedWallClock(iso, 'Europe/Berlin');
    expect(wall).toBe('2026-07-01T12:00');
    expect(zonedWallClockToIso(wall, 'Europe/Berlin')).toBe(iso);
  });
});

describe('isoToZonedWallClock', () => {
  it('показывает настенные часы пояса профиля', () => {
    expect(isoToZonedWallClock('2026-10-16T09:30:00.000Z', 'Europe/Berlin')).toBe(
      '2026-10-16T11:30',
    );
    expect(isoToZonedWallClock('2026-10-16T09:30:00.000Z', 'UTC')).toBe('2026-10-16T09:30');
  });
});

describe('hourInTimeZone', () => {
  it('даёт час в поясе, а не в поясе процесса', () => {
    expect(hourInTimeZone(new Date('2026-10-16T09:30:00.000Z'), 'Europe/Berlin')).toBe(11);
    expect(hourInTimeZone(new Date('2026-10-16T09:30:00.000Z'), 'America/New_York')).toBe(5);
  });
});
