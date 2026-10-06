// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  defaultChannelSettings,
  defaultNotificationRule,
  defaultNotificationRules,
} from '@puls/shared';
import {
  channelTimezone,
  dueDeliveriesForUser,
  scheduleJson,
  scheduleSummaryTime,
  scheduleTimes,
  toChannelConfig,
} from './due';

describe('toChannelConfig', () => {
  it('без сохранённых настроек отдаёт умолчания', () => {
    const config = toChannelConfig('telegram', null, []);
    expect(config).toEqual(defaultChannelSettings('telegram'));
  });

  it('накладывает настройки канала и правила только своего канала', () => {
    const config = toChannelConfig(
      'discord',
      {
        channel: 'discord',
        enabled: false,
        schedule: { times: ['10:00'], summaryTime: '20:00' },
        quietStart: 23,
        quietEnd: 7,
        timezone: 'Europe/Berlin',
      },
      [
        { type: 'budget', channel: 'discord', enabled: false },
        { type: 'payments', channel: 'telegram', enabled: false },
      ],
    );
    expect(config).toMatchObject({
      enabled: false,
      times: ['10:00'],
      summaryTime: '20:00',
      quietHours: { start: 23, end: 7 },
      timezone: 'Europe/Berlin',
    });
    expect(config.types.budget).toBe(false);
    expect(config.types.payments).toBe(true);
  });
});

describe('scheduleTimes / scheduleSummaryTime / scheduleJson', () => {
  it('читает времена из JSON и сортирует', () => {
    expect(scheduleTimes({ times: ['21:00', '09:00'] })).toEqual(['09:00', '21:00']);
  });

  it('ограничивает число слотов шестью', () => {
    expect(
      scheduleTimes({ times: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'] }),
    ).toHaveLength(6);
  });

  it('время итога дня: из JSON или по умолчанию', () => {
    expect(scheduleSummaryTime({ summaryTime: '20:15' })).toBe('20:15');
    expect(scheduleSummaryTime({ summaryTime: 'abc' })).toBe('21:30');
    expect(scheduleSummaryTime({})).toBe('21:30');
  });

  it('сериализует расписание', () => {
    expect(scheduleJson(1, '22:00')).toEqual({ times: ['09:00'], summaryTime: '22:00' });
  });
});

describe('channelTimezone', () => {
  it('свой часовой пояс канала приоритетнее профиля', () => {
    const config = { ...defaultChannelSettings('telegram'), timezone: 'Asia/Tokyo' };
    expect(channelTimezone(config, 'UTC')).toBe('Asia/Tokyo');
    expect(channelTimezone({ ...config, timezone: null }, 'Europe/Moscow')).toBe('Europe/Moscow');
  });
});

describe('dueDeliveriesForUser', () => {
  const telegram = { ...defaultChannelSettings('telegram'), times: ['09:00'] };
  const user = { id: 'u1', timezone: 'UTC', channels: [telegram] };
  const window = {
    from: new Date('2026-10-01T08:00:00Z'),
    to: new Date('2026-10-01T09:10:00Z'),
  };

  it('выбирает чек-ин, когда слот попал в окно', () => {
    const due = dueDeliveriesForUser(user, window);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ userId: 'u1', type: 'checkins', channel: 'telegram' });
  });

  it('не выбирает вне окна', () => {
    expect(
      dueDeliveriesForUser(user, {
        from: new Date('2026-10-01T09:10:00Z'),
        to: new Date('2026-10-01T14:00:00Z'),
      }),
    ).toHaveLength(0);
  });

  it('пропускает выключенный канал и выключенный тип', () => {
    expect(
      dueDeliveriesForUser({ ...user, channels: [{ ...telegram, enabled: false }] }, window),
    ).toHaveLength(0);
    const noCheckins = { ...telegram, types: { ...telegram.types, checkins: false } };
    expect(dueDeliveriesForUser({ ...user, channels: [noCheckins] }, window)).toHaveLength(0);
  });

  it('итог дня уходит в своё время', () => {
    const due = dueDeliveriesForUser(user, {
      from: new Date('2026-10-01T21:00:00Z'),
      to: new Date('2026-10-01T21:40:00Z'),
    });
    expect(due.map((item) => item.type)).toEqual(['daily_summary']);
  });

  it('одно время в каждом канале даёт по записи на канал', () => {
    const discord = { ...defaultChannelSettings('discord'), times: ['09:00'] };
    const due = dueDeliveriesForUser({ ...user, channels: [telegram, discord] }, window);
    expect(due.map((item) => item.channel).sort()).toEqual(['discord', 'telegram']);
  });

  it('учитывает собственный часовой пояс канала', () => {
    // 06:05 UTC = 09:05 МСК.
    const moscow = { ...telegram, timezone: 'Europe/Moscow' };
    const due = dueDeliveriesForUser(
      { ...user, channels: [moscow] },
      { from: new Date('2026-10-01T05:00:00Z'), to: new Date('2026-10-01T06:05:00Z') },
    );
    expect(due).toHaveLength(1);
  });
});

describe('значения по умолчанию синхронны с shared', () => {
  it('расписание по умолчанию совпадает с правилом по умолчанию', () => {
    expect(defaultNotificationRule('checkins').times).toEqual(['09:00', '15:00', '21:00']);
    expect(defaultNotificationRules()).toHaveLength(7);
  });
});
