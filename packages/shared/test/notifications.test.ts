// SPDX-License-Identifier: AGPL-3.0-or-later
// TDD-тесты чистой логики уведомлений (ТЗ §3.6, §5 сценарий 1, §9):
// расписание, часовой пояс, тихие часы, DST и включение типов.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUIET_HOURS,
  isTypeEnabled,
  isWithinQuietHours,
  nextAllowedTime,
  localParts,
  nextDeliveryTime,
  timesForCount,
  typicalAnswerTime,
  withMorningTime,
  defaultNotificationRules,
  deliveryOccurredBetween,
  selectDueTypes,
  type NotificationRuleConfig,
} from '../src/notifications';

const iso = (date: Date): string => date.toISOString();

describe('timesForCount', () => {
  it('по умолчанию три раза в день: утро, день, вечер (сценарий 1)', () => {
    expect(timesForCount(3)).toEqual(['09:00', '15:00', '21:00']);
  });

  it('поддерживает 1–6 слотов и сортирует их по возрастанию', () => {
    expect(timesForCount(1)).toEqual(['09:00']);
    expect(timesForCount(2)).toEqual(['09:00', '21:00']);
    expect(timesForCount(6)).toHaveLength(6);
    const six = timesForCount(6);
    expect([...six].sort()).toEqual(six);
  });

  it('зажимает значения вне диапазона 1–6', () => {
    expect(timesForCount(0)).toEqual(timesForCount(1));
    expect(timesForCount(99)).toEqual(timesForCount(6));
  });
});

describe('nextDeliveryTime', () => {
  it('в UTC выбирает ближайший слот после «сейчас»', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T05:00:00Z'),
      timezone: 'UTC',
    });
    expect(iso(next)).toBe('2026-10-01T09:00:00.000Z');
  });

  it('переходит на следующий день, когда слоты дня прошли', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T22:00:00Z'),
      timezone: 'UTC',
    });
    expect(iso(next)).toBe('2026-10-02T09:00:00.000Z');
  });

  it('строго после «сейчас»: ровно в 09:00 отправляет в 15:00', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T09:00:00.000Z'),
      timezone: 'UTC',
    });
    expect(iso(next)).toBe('2026-10-01T15:00:00.000Z');
  });

  it('учитывает часовой пояс пользователя (Europe/Moscow, UTC+3)', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T05:00:00Z'), // 08:00 MSK
      timezone: 'Europe/Moscow',
    });
    expect(iso(next)).toBe('2026-10-01T06:00:00.000Z'); // 09:00 MSK
  });

  it('учитывает часовой пояс по другую сторону UTC (America/New_York)', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T12:00:00Z'), // 08:00 EDT
      timezone: 'America/New_York',
    });
    expect(iso(next)).toBe('2026-10-01T13:00:00.000Z'); // 09:00 EDT
  });

  it('принимает количество слотов числом (1–6)', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T05:00:00Z'),
      timezone: 'UTC',
      times: 1,
    });
    expect(iso(next)).toBe('2026-10-01T09:00:00.000Z');
  });
});

describe('тихие часы', () => {
  it('определяет попадание в тихие часы через полночь', () => {
    expect(isWithinQuietHours(23 * 60, DEFAULT_QUIET_HOURS)).toBe(true);
    expect(isWithinQuietHours(7 * 60, DEFAULT_QUIET_HOURS)).toBe(true);
    expect(isWithinQuietHours(8 * 60, DEFAULT_QUIET_HOURS)).toBe(false);
    expect(isWithinQuietHours(21 * 60 + 59, DEFAULT_QUIET_HOURS)).toBe(false);
  });

  it('определяет тихие часы без перехода через полночь', () => {
    expect(isWithinQuietHours(14 * 60, { start: 13, end: 15 })).toBe(true);
    expect(isWithinQuietHours(15 * 60, { start: 13, end: 15 })).toBe(false);
    expect(isWithinQuietHours(12 * 60, { start: 13, end: 15 })).toBe(false);
  });

  it('поздний вечерний слот переносится на конец тихих часов (следующий день)', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T20:00:00Z'),
      timezone: 'UTC',
      times: ['22:30'],
      quietHours: { start: 22, end: 8 },
    });
    expect(iso(next)).toBe('2026-10-02T08:00:00.000Z');
  });

  it('ранний утренний слот переносится на конец тихих часов (тот же день)', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T06:00:00Z'),
      timezone: 'UTC',
      times: ['07:00'],
      quietHours: { start: 22, end: 8 },
    });
    expect(iso(next)).toBe('2026-10-01T08:00:00.000Z');
  });

  it('слот вне тихих часов не сдвигается', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T12:00:00Z'),
      timezone: 'UTC',
      times: ['15:00'],
      quietHours: { start: 22, end: 8 },
    });
    expect(iso(next)).toBe('2026-10-01T15:00:00.000Z');
  });

  it('границы тихих часов без перехода через полночь сдвигают в конец', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-01T12:00:00Z'),
      timezone: 'UTC',
      times: ['14:00'],
      quietHours: { start: 13, end: 15 },
    });
    expect(iso(next)).toBe('2026-10-01T15:00:00.000Z');
  });
});

describe('переходы DST', () => {
  it('весенний перевод часов вперёд (Europe/Berlin, 2026-03-29)', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-03-29T00:30:00Z'), // 01:30 CET, до перехода
      timezone: 'Europe/Berlin',
      times: ['09:00'],
    });
    // 09:00 CEST = 07:00 UTC, а не 08:00 UTC как было бы при CET
    expect(iso(next)).toBe('2026-03-29T07:00:00.000Z');
  });

  it('осенний перевод часов назад (Europe/Berlin, 2026-10-25)', () => {
    const next = nextDeliveryTime({
      now: new Date('2026-10-24T20:00:00Z'), // 22:00 CEST
      timezone: 'Europe/Berlin',
      times: ['09:00'],
    });
    // 09:00 CET = 08:00 UTC
    expect(iso(next)).toBe('2026-10-25T08:00:00.000Z');
  });
});

describe('localParts', () => {
  it('возвращает локальные компоненты даты в часовом поясе', () => {
    const parts = localParts(new Date('2026-10-01T22:30:00Z'), 'Europe/Moscow');
    expect(parts).toMatchObject({ year: 2026, month: 10, day: 2, hour: 1, minute: 30 });
  });
});

describe('умное время', () => {
  it('берёт медиану привычного времени ответа', () => {
    expect(typicalAnswerTime(['09:30', '09:40', '09:20'])).toBe('09:30');
  });

  it('поддерживает один ответ и минуты', () => {
    expect(typicalAnswerTime(['09:05'])).toBe('09:05');
  });

  it('возвращает null без данных', () => {
    expect(typicalAnswerTime([])).toBeNull();
  });

  it('подставляет привычное время в утренний слот', () => {
    const times = withMorningTime(['09:00', '15:00', '21:00'], '09:30');
    expect(times).toEqual(['09:30', '15:00', '21:00']);
  });
});

describe('правила по типам уведомлений', () => {
  it('создаёт правило для каждого типа', () => {
    const rules = defaultNotificationRules();
    expect(rules.map((rule) => rule.type).sort()).toEqual(
      [
        'budget',
        'checkins',
        'daily_summary',
        'payments',
        'reactions',
        'reconciliation_mismatch',
        'weekly_report',
      ].sort(),
    );
    expect(rules).toHaveLength(7);
  });

  it('позволяет включать и выключать каждый тип отдельно', () => {
    const rules: NotificationRuleConfig[] = defaultNotificationRules();
    const disabled = rules.map((rule) =>
      rule.type === 'payments' ? { ...rule, enabled: false } : rule,
    );
    expect(isTypeEnabled(disabled, 'payments')).toBe(false);
    expect(isTypeEnabled(disabled, 'checkins')).toBe(true);
    expect(isTypeEnabled(disabled, 'budget')).toBe(true);
  });
});

describe('due-выбор для планировщика', () => {
  it('находит слот внутри окна', () => {
    expect(
      deliveryOccurredBetween(
        {
          from: new Date('2026-10-01T08:00:00Z'),
          to: new Date('2026-10-01T09:30:00Z'),
          timezone: 'UTC',
        },
        { times: 3 },
      ),
    ).toBe(true);
  });

  it('не находит слот, если он ещё не наступил', () => {
    expect(
      deliveryOccurredBetween(
        {
          from: new Date('2026-10-01T09:30:00Z'),
          to: new Date('2026-10-01T14:00:00Z'),
          timezone: 'UTC',
        },
        { times: 3 },
      ),
    ).toBe(false);
  });

  it('включает правую границу окна', () => {
    expect(
      deliveryOccurredBetween(
        {
          from: new Date('2026-10-01T14:00:00Z'),
          to: new Date('2026-10-01T15:00:00Z'),
          timezone: 'UTC',
        },
        { times: 3 },
      ),
    ).toBe(true);
  });

  it('учитывает сдвиг тихих часов при выборе due', () => {
    expect(
      deliveryOccurredBetween(
        {
          from: new Date('2026-10-01T21:00:00Z'),
          to: new Date('2026-10-02T08:30:00Z'),
          timezone: 'UTC',
        },
        { times: ['22:30'], quietHours: { start: 22, end: 8 } },
      ),
    ).toBe(true);
  });

  it('выбирает только включённые типы', () => {
    const rules = defaultNotificationRules().map((rule) =>
      rule.type === 'checkins' ? { ...rule, enabled: false } : { ...rule, times: ['09:00'] },
    );
    const due = selectDueTypes(rules, {
      from: new Date('2026-10-01T08:00:00Z'),
      to: new Date('2026-10-01T09:30:00Z'),
      timezone: 'UTC',
    });
    expect(due).not.toContain('checkins');
    expect(due).toContain('payments');
  });
});

describe('nextAllowedTime (отложенная отправка в тихие часы)', () => {
  const quiet = { start: 22, end: 8 };

  it('вне тихих часов возвращает тот же момент', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(nextAllowedTime(now, 'UTC', quiet)).toBe(now);
  });

  it('ночью переносит на конец тихих часов следующего утра', () => {
    expect(iso(nextAllowedTime(new Date('2026-10-01T23:30:00Z'), 'UTC', quiet))).toBe(
      '2026-10-02T08:00:00.000Z',
    );
  });

  it('после полуночи переносит на то же утро', () => {
    expect(iso(nextAllowedTime(new Date('2026-10-02T03:00:00Z'), 'UTC', quiet))).toBe(
      '2026-10-02T08:00:00.000Z',
    );
  });

  it('учитывает часовой пояс пользователя', () => {
    // 23:30 UTC = 02:30 в Москве (UTC+3) → 08:00 МСК = 05:00 UTC.
    expect(iso(nextAllowedTime(new Date('2026-10-01T23:30:00Z'), 'Europe/Moscow', quiet))).toBe(
      '2026-10-02T05:00:00.000Z',
    );
  });

  it('границы: 22:00 — уже тихие часы, 08:00 — уже нет', () => {
    expect(iso(nextAllowedTime(new Date('2026-10-01T22:00:00Z'), 'UTC', quiet))).toBe(
      '2026-10-02T08:00:00.000Z',
    );
    const open = new Date('2026-10-02T08:00:00Z');
    expect(nextAllowedTime(open, 'UTC', quiet)).toBe(open);
  });
});
