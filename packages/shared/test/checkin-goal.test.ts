// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { CheckinGoalInputSchema, checkinGoalProgress, weekStartKey } from '../src';

describe('цель чек-инов', () => {
  it('понедельник недели', () => {
    expect(weekStartKey('2026-10-06')).toBe('2026-10-05'); // вторник
    expect(weekStartKey('2026-10-05')).toBe('2026-10-05');
    expect(weekStartKey('2026-10-11')).toBe('2026-10-05'); // воскресенье
    expect(weekStartKey('2026-10-12')).toBe('2026-10-12');
  });

  it('прогресс, достижение и отсутствие цели', () => {
    expect(checkinGoalProgress(5, 2, '2026-10-05')).toMatchObject({ percent: 40, reached: false });
    expect(checkinGoalProgress(5, 7, '2026-10-05')).toMatchObject({ percent: 100, reached: true });
    expect(checkinGoalProgress(null, 3, '2026-10-05')).toMatchObject({
      percent: null,
      reached: false,
    });
  });

  it('валидация ввода', () => {
    expect(CheckinGoalInputSchema.safeParse({ perWeek: 4 }).success).toBe(true);
    expect(CheckinGoalInputSchema.safeParse({ perWeek: null }).success).toBe(true);
    expect(CheckinGoalInputSchema.safeParse({ perWeek: 0 }).success).toBe(false);
    expect(CheckinGoalInputSchema.safeParse({ perWeek: 1.5 }).success).toBe(false);
  });
});
