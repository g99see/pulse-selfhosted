// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { CheckInInputSchema } from '../src/checkin';

describe('CheckInInputSchema', () => {
  it('accepts mood 1–5 and defaults tags to an empty list', () => {
    const parsed = CheckInInputSchema.parse({ mood: 3 });
    expect(parsed.tags).toEqual([]);
    expect(parsed.mood).toBe(3);
  });

  it('accepts a full extended check-in', () => {
    const parsed = CheckInInputSchema.parse({
      mood: 4,
      energy: 2,
      stress: 5,
      sleepHours: 7.5,
      tags: ['работа', 'спорт'],
      note: 'Хороший день',
    });
    expect(parsed.sleepHours).toBe(7.5);
    expect(parsed.tags).toHaveLength(2);
  });

  it('rejects mood above 5 and sleep above 24 h', () => {
    expect(() => CheckInInputSchema.parse({ mood: 6 })).toThrow();
    expect(() => CheckInInputSchema.parse({ mood: 3, sleepHours: 25 })).toThrow();
  });

  it('rejects notes longer than 2000 characters', () => {
    expect(() => CheckInInputSchema.parse({ mood: 3, note: 'x'.repeat(2001) })).toThrow();
  });
});
