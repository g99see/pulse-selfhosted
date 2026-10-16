// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '@puls/shared';
import {
  buildBudgetAlert,
  buildDailySummary,
  buildMessage,
  buildReconciliationMismatch,
  checkinGreeting,
} from './messages';

describe('buildMessage', () => {
  it('чек-ин помечен kind=checkin (кнопки добавит Telegram)', () => {
    const message = buildMessage('checkins', {
      now: new Date('2026-10-01T06:00:00Z'),
      timezone: 'Europe/Moscow', // 09:00 — утро
    });
    expect(message.kind).toBe('checkin');
    expect(message.title).toContain('утро');
  });

  it('меняет приветствие по локальному времени', () => {
    expect(
      checkinGreeting({ now: new Date('2026-10-01T12:00:00Z'), timezone: 'UTC' }).title,
    ).toContain('день');
    expect(
      checkinGreeting({ now: new Date('2026-10-01T18:00:00Z'), timezone: 'UTC' }).title,
    ).toContain('прошёл день');
  });

  it('единые границы «утра» 04:00–12:00 с окном сна', () => {
    const titleAt = (hour: number) =>
      checkinGreeting({
        now: new Date(`2026-10-01T${String(hour).padStart(2, '0')}:30:00Z`),
        timezone: 'UTC',
      }).title;
    // Утро (в т.ч. 04:00 и 11:59) — как в окне сна.
    expect(titleAt(4)).toContain('утро');
    expect(titleAt(8)).toContain('утро');
    expect(titleAt(11)).toContain('утро');
    // 12:00 — уже день, вечер с 18:00, ночь с 23:00.
    expect(titleAt(12)).toContain('день');
    expect(titleAt(17)).toContain('день');
    expect(titleAt(18)).toContain('прошёл день');
    expect(titleAt(22)).toContain('прошёл день');
    expect(titleAt(23)).toContain('Как вы');
    expect(titleAt(3)).toContain('Как вы');
  });

  it('вне утреннего окна шаблоны не упоминают сон (вопрос о сне — только утром)', () => {
    const SLEEP_WORDS = /сон|спал|спится|поспать|недосып/;
    // Единое окно: сон упоминается только с 04:00 до 12:00.
    for (const hour of [12, 13, 17, 18, 21, 22, 23, 0, 1, 2, 3]) {
      const greeting = checkinGreeting({
        now: new Date(`2026-10-01T${String(hour).padStart(2, '0')}:30:00Z`),
        timezone: 'UTC',
      });
      const text = `${greeting.title} ${greeting.body}`.toLowerCase();
      expect(text).not.toMatch(SLEEP_WORDS);
    }
  });

  it('собирает сообщение для каждого типа', () => {
    for (const type of NOTIFICATION_TYPES) {
      const message = buildMessage(type, { now: new Date(), timezone: 'UTC' });
      expect(message.type).toBe(type);
      expect(message.title.length).toBeGreaterThan(0);
      expect(message.body.length).toBeGreaterThan(0);
    }
  });
});

describe('buildDailySummary', () => {
  const day = {
    day: '2026-10-01',
    timezone: 'UTC',
    currency: 'RUB',
    spent: 1200,
    earned: 5000,
    net: 3800,
    budgetLimit: 0,
    budgetRemaining: 0,
    avgMood: 4.5,
    checkins: 2,
  } as unknown as Parameters<typeof buildDailySummary>[0];

  it('содержит траты, доходы, настроение и чек-ины', () => {
    const message = buildDailySummary(day);
    expect(message.type).toBe('daily_summary');
    expect(message.body).toContain('Потрачено');
    expect(message.body).toContain('Получено');
    expect(message.body).toContain('4.5/5');
    expect(message.body).toContain('Чек-инов: 2');
  });

  it('без чек-инов пишет «нет данных»', () => {
    expect(buildDailySummary({ ...day, avgMood: null }).body).toContain('нет данных');
  });
});

describe('buildBudgetAlert', () => {
  it('до 80% предупреждения нет', () => {
    expect(
      buildBudgetAlert({ categoryName: 'Еда', limit: 1000, spent: 700, currency: 'RUB' }),
    ).toBeNull();
  });

  it('80% — предупреждение, 100% — превышение', () => {
    const warning = buildBudgetAlert({
      categoryName: 'Еда',
      limit: 1000,
      spent: 850,
      currency: 'RUB',
    });
    expect(warning?.title).toContain('85%');
    const exceeded = buildBudgetAlert({
      categoryName: 'Еда',
      limit: 1000,
      spent: 1200,
      currency: 'RUB',
    });
    expect(exceeded?.title).toContain('превышен');
  });
});

describe('buildReconciliationMismatch', () => {
  it('называет счёт и расхождение', () => {
    const message = buildReconciliationMismatch({ accountName: 'Карта', difference: '120 ₽' });
    expect(message.type).toBe('reconciliation_mismatch');
    expect(message.body).toContain('Карта');
    expect(message.body).toContain('120');
  });
});
