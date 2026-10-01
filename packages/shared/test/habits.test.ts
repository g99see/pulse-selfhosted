// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты трекера привычек (ТЗ §4, P2): схемы, серия дней подряд и процент
// выполнения за 7 и 30 дней. Чистые функции без БД и сети.
import { describe, expect, it } from 'vitest';
import {
  HABIT_ICON_PRESETS,
  HabitCreateSchema,
  HabitLogSchema,
  HabitUpdateSchema,
  habitCompletionRate,
  habitExpectedCompletions,
  habitStatsFromDayKeys,
  habitStreak,
  shiftDayKey,
} from '../src/habits';

describe('Схемы привычек', () => {
  it('принимает привычку с иконкой, частотой и целью в неделю', () => {
    const parsed = HabitCreateSchema.parse({
      name: 'Вода',
      icon: '💧',
      cadence: 'daily',
      perWeek: 1,
    });
    expect(parsed).toMatchObject({ name: 'Вода', icon: '💧', cadence: 'daily', perWeek: 1 });
  });

  it('подставляет иконку и ежедневную частоту по умолчанию', () => {
    const parsed = HabitCreateSchema.parse({ name: 'Чтение' });
    expect(parsed.icon).toBe(HABIT_ICON_PRESETS[0]);
    expect(parsed.cadence).toBe('daily');
    expect(parsed.perWeek).toBe(1);
  });

  it('отклоняет пустое имя, неизвестную частоту и цель вне 1–7', () => {
    expect(HabitCreateSchema.safeParse({ name: '' }).success).toBe(false);
    expect(HabitCreateSchema.safeParse({ name: 'x', cadence: 'monthly' }).success).toBe(false);
    expect(HabitCreateSchema.safeParse({ name: 'x', perWeek: 0 }).success).toBe(false);
    expect(HabitCreateSchema.safeParse({ name: 'x', perWeek: 8 }).success).toBe(false);
  });

  it('правка принимает архивацию и частичные поля', () => {
    expect(HabitUpdateSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(HabitUpdateSchema.parse({ name: 'Спорт', perWeek: 3 })).toEqual({ name: 'Спорт', perWeek: 3 });
  });

  it('отметка по умолчанию — done=true без даты', () => {
    expect(HabitLogSchema.parse({})).toEqual({ done: true });
    expect(HabitLogSchema.parse({ date: '2026-10-01' })).toEqual({ date: '2026-10-01', done: true });
    expect(HabitLogSchema.safeParse({ date: 'не дата' }).success).toBe(false);
  });
});

describe('shiftDayKey', () => {
  it('сдвигает через границы месяца и года', () => {
    expect(shiftDayKey('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('habitStreak', () => {
  it('считает серию подряд, идущую до сегодня', () => {
    expect(habitStreak(['2026-10-01', '2026-09-30', '2026-09-29'], '2026-10-01')).toBe(3);
  });

  it('не прерывает серию, если сегодня ещё не отмечено', () => {
    expect(habitStreak(['2026-09-30', '2026-09-29'], '2026-10-01')).toBe(2);
  });

  it('возвращает 0, если нет ни сегодня, ни вчера', () => {
    expect(habitStreak(['2026-09-28'], '2026-10-01')).toBe(0);
    expect(habitStreak([], '2026-10-01')).toBe(0);
  });

  it('разрыв в середине останавливает счёт', () => {
    expect(habitStreak(['2026-10-01', '2026-09-30', '2026-09-28'], '2026-10-01')).toBe(2);
  });

  it('игнорирует дубликаты дней', () => {
    expect(habitStreak(['2026-10-01', '2026-10-01', '2026-09-30'], '2026-10-01')).toBe(2);
  });
});

describe('habitExpectedCompletions', () => {
  it('у ежедневной привычки ожидание равно числу дней окна', () => {
    expect(habitExpectedCompletions('daily', 1, 7)).toBe(7);
    expect(habitExpectedCompletions('daily', 1, 30)).toBe(30);
  });

  it('у недельной привычки ожидание пропорционально неделе', () => {
    expect(habitExpectedCompletions('weekly', 3, 7)).toBe(3);
    expect(habitExpectedCompletions('weekly', 3, 30)).toBe(13);
  });
});

describe('habitCompletionRate', () => {
  it('считает процент за 7 дней у ежедневной привычки', () => {
    const done = ['2026-10-01', '2026-09-30', '2026-09-29'];
    expect(habitCompletionRate(done, '2026-10-01', 7, 'daily', 1)).toBe(43);
  });

  it('не выходит за 100% даже при перевыполнении недельной цели', () => {
    const done = ['2026-10-01', '2026-09-30', '2026-09-29', '2026-09-28'];
    expect(habitCompletionRate(done, '2026-10-01', 7, 'weekly', 2)).toBe(100);
  });

  it('не учитывает отметки вне окна', () => {
    expect(habitCompletionRate(['2026-01-01'], '2026-10-01', 7, 'daily', 1)).toBe(0);
  });
});

describe('habitStatsFromDayKeys', () => {
  it('собирает серию, проценты и общее число отметок', () => {
    const done = ['2026-10-01', '2026-09-30', '2026-09-25'];
    expect(habitStatsFromDayKeys(done, '2026-10-01', 'daily', 1)).toEqual({
      streak: 2,
      rate7: 43,
      rate30: 10,
      totalDone: 3,
    });
  });
});
