// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { CHECKIN_ACTIONS, buildNotificationEmail, buildPushPayload, checkinGreeting } from './messages';

describe('buildPushPayload', () => {
  it('для чек-ина несёт кнопки настроения 1–5 и путь API (ТЗ §9)', () => {
    const payload = buildPushPayload('checkins', {
      now: new Date('2026-10-01T06:00:00Z'),
      timezone: 'Europe/Moscow', // 09:00 — утро
    });

    expect(payload.checkinUrl).toBe('/api/checkins');
    expect(payload.actions?.map((action) => action.action)).toEqual([
      'mood-1',
      'mood-2',
      'mood-3',
      'mood-4',
      'mood-5',
    ]);
    expect(payload.actions).toHaveLength(CHECKIN_ACTIONS.length);
    expect(payload.title).toContain('утро');
  });

  it('меняет приветствие по локальному времени', () => {
    expect(
      checkinGreeting({ now: new Date('2026-10-01T12:00:00Z'), timezone: 'UTC' }).title,
    ).toContain('день');
    expect(
      checkinGreeting({ now: new Date('2026-10-01T18:00:00Z'), timezone: 'UTC' }).title,
    ).toContain('прошёл день');
  });

  it('собирает payload для каждого из типов', () => {
    for (const type of ['checkins', 'payments', 'budget', 'weekly_report', 'reactions'] as const) {
      const payload = buildPushPayload(type, { now: new Date(), timezone: 'UTC' });
      expect(payload.type).toBe(type);
      expect(payload.title.length).toBeGreaterThan(0);
      expect(payload.body.length).toBeGreaterThan(0);
    }
  });
});

describe('buildNotificationEmail', () => {
  it('строит письмо-уведомление с темой и типом', () => {
    const email = buildNotificationEmail('weekly_report', {
      now: new Date('2026-10-01T09:00:00Z'),
      timezone: 'UTC',
    });
    expect(email.subject).toContain('Пульс');
    expect(email.kind).toBe('notification:weekly_report');
    expect(email.text.length).toBeGreaterThan(0);
  });
});
