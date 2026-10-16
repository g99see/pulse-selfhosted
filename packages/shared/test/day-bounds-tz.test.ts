// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { dayBoundsInTimeZone } from '../src/checkin';
import { dayKeyInTimezone, zonedDayBounds } from '../src/stats';

/**
 * Таблица границ локальных суток. `start`/`end` — реальная UTC-полночь и
 * UTC-полночь следующего дня (проверено независимым перебором по Intl).
 * Длина суток: 24 — обычный день, 25 — переход назад, 23 — переход вперёд,
 * в т.ч. в зонах, где локальная полночь не существует (Azores/Havana/Santiago).
 */
const CASES: {
  tz: string;
  now: string;
  dayKey: string;
  start: string;
  end: string;
  hours: number;
  note: string;
}[] = [
  {
    tz: 'Europe/Kyiv',
    now: '2026-10-25T12:00:00Z',
    dayKey: '2026-10-25',
    start: '2026-10-24T21:00:00.000Z',
    end: '2026-10-25T22:00:00.000Z',
    hours: 25,
    note: 'Киев, переход назад (25 ч)',
  },
  {
    tz: 'America/Los_Angeles',
    now: '2026-11-01T20:00:00Z',
    dayKey: '2026-11-01',
    start: '2026-11-01T07:00:00.000Z',
    end: '2026-11-02T08:00:00.000Z',
    hours: 25,
    note: 'Лос-Анджелес, переход назад (25 ч)',
  },
  {
    tz: 'Pacific/Auckland',
    now: '2026-09-27T00:00:00Z',
    dayKey: '2026-09-27',
    start: '2026-09-26T12:00:00.000Z',
    end: '2026-09-27T11:00:00.000Z',
    hours: 23,
    note: 'Окленд, переход вперёд (23 ч)',
  },
  {
    tz: 'Atlantic/Azores',
    now: '2026-03-29T12:00:00Z',
    dayKey: '2026-03-29',
    start: '2026-03-29T01:00:00.000Z',
    end: '2026-03-30T00:00:00.000Z',
    hours: 23,
    note: 'Азоры: локальной полуночи нет — первый существующий момент',
  },
  {
    tz: 'America/Havana',
    now: '2026-03-08T15:00:00Z',
    dayKey: '2026-03-08',
    start: '2026-03-08T05:00:00.000Z',
    end: '2026-03-09T04:00:00.000Z',
    hours: 23,
    note: 'Гавана: локальной полуночи нет — первый существующий момент',
  },
  {
    tz: 'America/Santiago',
    now: '2026-09-06T15:00:00Z',
    dayKey: '2026-09-06',
    start: '2026-09-06T04:00:00.000Z',
    end: '2026-09-07T03:00:00.000Z',
    hours: 23,
    note: 'Сантьяго: локальной полуночи нет — первый существующий момент',
  },
  {
    tz: 'Europe/Berlin',
    now: '2026-10-25T12:00:00Z',
    dayKey: '2026-10-25',
    start: '2026-10-24T22:00:00.000Z',
    end: '2026-10-25T23:00:00.000Z',
    hours: 25,
    note: 'Берлин, переход назад (25 ч)',
  },
  {
    tz: 'Europe/Kyiv',
    now: '2026-10-20T09:00:00Z',
    dayKey: '2026-10-20',
    start: '2026-10-19T21:00:00.000Z',
    end: '2026-10-20T21:00:00.000Z',
    hours: 24,
    note: 'обычный день',
  },
  {
    tz: 'UTC',
    now: '2026-10-01T05:00:00Z',
    dayKey: '2026-10-01',
    start: '2026-10-01T00:00:00.000Z',
    end: '2026-10-02T00:00:00.000Z',
    hours: 24,
    note: 'UTC',
  },
];

describe('границы дня в часовом поясе: DST и пропущенная полночь', () => {
  for (const c of CASES) {
    it(`${c.tz} ${c.dayKey} — ${c.note}`, () => {
      const now = new Date(c.now);
      const { start, end, dayKey } = dayBoundsInTimeZone(now, c.tz);

      expect(dayKey).toBe(c.dayKey);
      expect(start.toISOString()).toBe(c.start);
      expect(end.toISOString()).toBe(c.end);
      expect((end.getTime() - start.getTime()) / 3_600_000).toBe(c.hours);
    });

    it(`${c.tz} ${c.dayKey} — dayBoundsInTimeZone и zonedDayBounds согласованы`, () => {
      const { start, end, dayKey } = dayBoundsInTimeZone(new Date(c.now), c.tz);
      const bounds = zonedDayBounds(dayKey, c.tz);
      expect(bounds.start.toISOString()).toBe(start.toISOString());
      expect(bounds.end.toISOString()).toBe(end.toISOString());
    });

    it(`${c.tz} ${c.dayKey} — start/end действительно лежат на границах дня`, () => {
      const { start, end, dayKey } = dayBoundsInTimeZone(new Date(c.now), c.tz);
      // Начало — первый момент этого локального дня, конец — следующий локальный день.
      expect(dayKeyInTimezone(start, c.tz)).toBe(dayKey);
      expect(dayKeyInTimezone(new Date(start.getTime() - 1), c.tz)).not.toBe(dayKey);
      // Конец открыт: последний момент предыдущих суток, а не этих.
      expect(dayKeyInTimezone(end, c.tz)).not.toBe(dayKey);
      expect(dayKeyInTimezone(new Date(end.getTime() - 1), c.tz)).toBe(dayKey);
    });
  }
});
