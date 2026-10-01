// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты чистых функций капсулы времени (ТЗ §4): пресеты дат, проверка
// допустимого срока открытия, доступность и сборка снимка статистики за
// период [created_at, open_at].
import { describe, expect, it } from 'vitest';
import {
  CAPSULE_MAX_OPEN_YEARS,
  CapsuleCreateSchema,
  addMonthsClamped,
  buildCapsuleSnapshot,
  capsuleOpenAtError,
  capsuleOpenBounds,
  capsulePresetOpenAt,
  capsuleRemainingMs,
  isCapsuleOpen,
} from '../src/capsules';

describe('пресеты даты открытия', () => {
  it('через месяц прибавляет календарный месяц с зажимом дня', () => {
    expect(addMonthsClamped(new Date('2026-01-31T10:00:00.000Z'), 1).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(addMonthsClamped(new Date('2026-03-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2026-04-30T00:00:00.000Z',
    );
  });

  it('через год сохраняет день, кроме 29 февраля', () => {
    expect(addMonthsClamped(new Date('2024-02-29T09:30:00.000Z'), 12).toISOString()).toBe(
      '2025-02-28T09:30:00.000Z',
    );
  });

  it('пресеты month и year считаются от момента создания', () => {
    const created = new Date('2026-05-15T12:00:00.000Z');
    expect(capsulePresetOpenAt('month', created).toISOString()).toBe('2026-06-15T12:00:00.000Z');
    expect(capsulePresetOpenAt('year', created).toISOString()).toBe('2027-05-15T12:00:00.000Z');
  });
});

describe('допустимый срок открытия', () => {
  const created = new Date('2026-05-15T12:00:00.000Z');

  it('раньше суток — too_soon', () => {
    expect(capsuleOpenAtError(new Date('2026-05-15T20:00:00.000Z'), created)).toBe('too_soon');
  });

  it('ровно через сутки — допустимо', () => {
    expect(capsuleOpenAtError(new Date('2026-05-16T12:00:00.000Z'), created)).toBeNull();
  });

  it('позже десяти лет — too_far', () => {
    const tooFar = new Date(created.getTime());
    tooFar.setUTCFullYear(tooFar.getUTCFullYear() + CAPSULE_MAX_OPEN_YEARS);
    tooFar.setUTCMilliseconds(1);
    expect(capsuleOpenAtError(tooFar, created)).toBe('too_far');
  });

  it('границы: min = +1 сутки, max = +10 лет', () => {
    const { min, max } = capsuleOpenBounds(created);
    expect(min.toISOString()).toBe('2026-05-16T12:00:00.000Z');
    expect(max.toISOString()).toBe('2036-05-15T12:00:00.000Z');
  });
});

describe('доступность капсулы', () => {
  const openAt = new Date('2026-06-15T12:00:00.000Z');

  it('до наступления срока закрыта', () => {
    expect(isCapsuleOpen(openAt, new Date('2026-06-15T11:59:59.000Z'))).toBe(false);
    expect(capsuleRemainingMs(openAt, new Date('2026-06-15T11:00:00.000Z'))).toBe(3_600_000);
  });

  it('в момент открытия и позже открыта', () => {
    expect(isCapsuleOpen(openAt, openAt)).toBe(true);
    expect(capsuleRemainingMs(openAt, new Date('2026-07-01T00:00:00.000Z'))).toBe(0);
  });
});

describe('снимок статистики периода', () => {
  it('считает траты, доходы, настроение, чек-ины и цели', () => {
    const snapshot = buildCapsuleSnapshot({
      from: '2026-05-15T12:00:00.000Z',
      to: '2026-06-15T12:00:00.000Z',
      transactions: [
        { type: 'expense', amount: 100 },
        { type: 'expense', amount: 50.5 },
        { type: 'income', amount: 200 },
        { type: 'transfer', amount: 999 },
      ],
      moods: [5, 4, 4],
      goals: [
        { title: 'Ноутбук', targetAmount: 100_000, savedAmount: 25_000 },
        { title: 'Без цели', targetAmount: 0, savedAmount: 0 },
      ],
    });

    expect(snapshot.spent).toBe(150.5);
    expect(snapshot.earned).toBe(200);
    expect(snapshot.net).toBe(49.5);
    expect(snapshot.avgMood).toBe(4.3);
    expect(snapshot.checkins).toBe(3);
    expect(snapshot.goals).toEqual([
      { title: 'Ноутбук', targetAmount: 100_000, savedAmount: 25_000, percent: 25 },
      { title: 'Без цели', targetAmount: 0, savedAmount: 0, percent: 0 },
    ]);
  });

  it('пустой период даёт нули и null для настроения', () => {
    const snapshot = buildCapsuleSnapshot({
      from: '2026-05-15T12:00:00.000Z',
      to: '2026-06-15T12:00:00.000Z',
      transactions: [],
      moods: [],
      goals: [],
    });
    expect(snapshot).toMatchObject({
      spent: 0,
      earned: 0,
      net: 0,
      avgMood: null,
      checkins: 0,
      goals: [],
    });
  });
});

describe('схема создания капсулы', () => {
  it('принимает preset без openAt', () => {
    const parsed = CapsuleCreateSchema.safeParse({
      title: 'Привет',
      body: 'Текст',
      preset: 'year',
    });
    expect(parsed.success).toBe(true);
  });

  it('требует ровно одно из полей preset или openAt', () => {
    expect(CapsuleCreateSchema.safeParse({ title: 'a', body: 'b' }).success).toBe(false);
    expect(
      CapsuleCreateSchema.safeParse({
        title: 'a',
        body: 'b',
        preset: 'month',
        openAt: '2026-06-15T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('не принимает пустое тело', () => {
    expect(CapsuleCreateSchema.safeParse({ title: 'a', body: '', preset: 'month' }).success).toBe(
      false,
    );
  });
});
