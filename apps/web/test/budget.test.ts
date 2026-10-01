// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { budgetLevel } from '../src/lib/budget';
import { healthUrl } from '../src/lib/api';

describe('budgetLevel', () => {
  it('is ok below 80%', () => {
    expect(budgetLevel(10_000, 4_000)).toEqual({ percent: 40, level: 'ok' });
  });

  it('warns at 80%', () => {
    expect(budgetLevel(50_000, 40_000)).toEqual({ percent: 80, level: 'warning' });
  });

  it('is exceeded at 100% and beyond', () => {
    expect(budgetLevel(50_000, 50_000).level).toBe('exceeded');
    expect(budgetLevel(50_000, 61_500).percent).toBe(123);
  });

  it('never divides by zero', () => {
    expect(budgetLevel(0, 500)).toEqual({ percent: 0, level: 'ok' });
  });
});

describe('healthUrl', () => {
  it('points at the API health endpoint', () => {
    expect(healthUrl()).toMatch(/\/health$/);
  });
});
