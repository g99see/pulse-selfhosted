// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты представления данных разбора (ТЗ §3.9): заметки и имя попадают в
// текст, который уходит провайдеру, только при явных флагах.
import { describe, expect, it } from 'vitest';
import { renderReviewPayload, type ReviewData } from './ai-review.service';

const base: ReviewData = {
  period: 'week',
  from: '2026-09-28',
  to: '2026-10-04',
  currency: 'RUB',
  spent: 1000,
  earned: 5000,
  avgMood: 3.5,
  checkins: 4,
  byCategory: [{ name: 'Еда', total: 700 }],
  budgets: [{ name: 'Еда', limit: 10000, spent: 7000 }],
  goals: [{ title: 'Ноутбук', saved: 20000, target: 100000, percent: 20 }],
  streak: 5,
};

describe('renderReviewPayload', () => {
  it('без полей заметок и имени не рендерит их', () => {
    const text = renderReviewPayload(base);
    expect(text).toContain('Расходы: 1000 RUB');
    expect(text).toContain('Еда');
    // Заметки/имя попадают в payload только когда gather их добавил (флаги).
    expect(text).not.toContain('Пользователь:');
    expect(text).not.toContain('Заметки чек-инов:');
  });

  it('с переданными полями добавляет имя и заметки', () => {
    const text = renderReviewPayload({ ...base, notes: ['секретная заметка'], name: 'Иван' });
    expect(text).toContain('Пользователь: Иван');
    expect(text).toContain('Заметки чек-инов:');
    expect(text).toContain('секретная заметка');
  });
});
