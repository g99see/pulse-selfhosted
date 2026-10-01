// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { MOOD_COLORS, MOOD_EMOJI, isMood, moodAverage } from '../src/mood';

describe('mood scale', () => {
  it('has an emoji and a colour for every value 1–5', () => {
    for (const mood of [1, 2, 3, 4, 5] as const) {
      expect(MOOD_EMOJI[mood]).toBeTruthy();
      expect(MOOD_COLORS[mood]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('validates only integers 1–5', () => {
    expect(isMood(3)).toBe(true);
    expect(isMood(0)).toBe(false);
    expect(isMood(6)).toBe(false);
    expect(isMood(2.5)).toBe(false);
    expect(isMood('4')).toBe(false);
  });

  it('averages valid values and ignores the rest', () => {
    expect(moodAverage([1, 2, 3, 4, 5])).toBe(3);
    expect(moodAverage([4, 3, 9])).toBe(3.5);
    expect(moodAverage([])).toBeNull();
  });
});
