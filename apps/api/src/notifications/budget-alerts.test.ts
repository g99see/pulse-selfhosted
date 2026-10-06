// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { crossedBudgetThreshold } from './budget-alerts';

describe('crossedBudgetThreshold', () => {
  it('пересечение 80% даёт warning', () => {
    expect(crossedBudgetThreshold(1000, 800, 200)).toBe('warning');
  });

  it('пересечение 100% даёт exceeded', () => {
    expect(crossedBudgetThreshold(1000, 1050, 300)).toBe('exceeded');
  });

  it('прыжок сразу через 100% — exceeded', () => {
    expect(crossedBudgetThreshold(1000, 1200, 700)).toBe('exceeded');
  });

  it('уже выше порога — повторно не срабатывает', () => {
    expect(crossedBudgetThreshold(1000, 900, 50)).toBeNull();
    expect(crossedBudgetThreshold(1000, 1100, 50)).toBeNull();
  });

  it('ниже 80% — тишина', () => {
    expect(crossedBudgetThreshold(1000, 500, 100)).toBeNull();
  });
});
