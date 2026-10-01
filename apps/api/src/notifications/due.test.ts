// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultNotificationRule, defaultNotificationRules } from '@puls/shared';
import { toRuleConfig, dueDeliveriesForUser, scheduleJson, scheduleTimes } from './due';

const storedCheckins = {
  type: 'checkins',
  channel: 'web_push',
  schedule: { times: ['09:00', '15:00', '21:00'] },
  quietHoursStart: 22,
  quietHoursEnd: 8,
  enabled: true,
};

describe('toRuleConfig', () => {
  it('превращает строку БД в конфиг правила', () => {
    const config = toRuleConfig(storedCheckins);
    expect(config).toEqual({
      type: 'checkins',
      channel: 'web_push',
      enabled: true,
      times: ['09:00', '15:00', '21:00'],
      quietHours: { start: 22, end: 8 },
    });
  });

  it('игнорирует неизвестные типы и каналы', () => {
    expect(toRuleConfig({ ...storedCheckins, type: 'telepathy' })).toBeNull();
    expect(toRuleConfig({ ...storedCheckins, channel: 'carrier_pigeon' })).toBeNull();
  });

  it('подставляет расписание по умолчанию для пустого schedule', () => {
    expect(toRuleConfig({ ...storedCheckins, schedule: {} })?.times).toEqual([
      '09:00',
      '15:00',
      '21:00',
    ]);
  });
});

describe('scheduleTimes / scheduleJson', () => {
  it('читает времена из JSON и сортирует', () => {
    expect(scheduleTimes({ times: ['21:00', '09:00'] })).toEqual(['09:00', '21:00']);
  });

  it('ограничивает число слотов шестью', () => {
    const times = scheduleTimes({
      times: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'],
    });
    expect(times).toHaveLength(6);
  });

  it('сериализует число слотов в список времён', () => {
    expect(scheduleJson(1)).toEqual({ times: ['09:00'] });
  });
});

describe('dueDeliveriesForUser', () => {
  const user = {
    id: 'u1',
    email: 'u1@example.com',
    timezone: 'UTC',
    notificationRules: [storedCheckins],
  };
  const window = {
    from: new Date('2026-10-01T08:00:00Z'),
    to: new Date('2026-10-01T09:10:00Z'),
    timezone: 'UTC',
  };

  it('выбирает тип, когда плановый слот попал в окно', () => {
    const due = dueDeliveriesForUser(user, window);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ userId: 'u1', type: 'checkins', channel: 'web_push' });
  });

  it('не выбирает тип вне окна', () => {
    const due = dueDeliveriesForUser(user, {
      from: new Date('2026-10-01T09:10:00Z'),
      to: new Date('2026-10-01T14:00:00Z'),
      timezone: 'UTC',
    });
    expect(due).toHaveLength(0);
  });

  it('пропускает выключенные правила', () => {
    const due = dueDeliveriesForUser(
      { ...user, notificationRules: [{ ...storedCheckins, enabled: false }] },
      window,
    );
    expect(due).toHaveLength(0);
  });

  it('не зависит от порядка правил и включает несколько типов', () => {
    const due = dueDeliveriesForUser(
      {
        ...user,
        notificationRules: [
          { ...storedCheckins, type: 'budget' },
          { ...storedCheckins, type: 'payments', channel: 'email' },
        ],
      },
      window,
    );
    expect(due.map((delivery) => delivery.type).sort()).toEqual(['budget', 'payments']);
    expect(due.find((delivery) => delivery.type === 'payments')?.channel).toBe('email');
  });
});

describe('значения по умолчанию синхронны с shared', () => {
  it('расписание по умолчанию совпадает с правилом по умолчанию', () => {
    const rule = defaultNotificationRule('checkins');
    expect(rule.times).toEqual(['09:00', '15:00', '21:00']);
    expect(defaultNotificationRules()).toHaveLength(5);
  });
});
