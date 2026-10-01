// SPDX-License-Identifier: AGPL-3.0-or-later
/** Предупреждения бюджета на 80% и 100% лимита (ТЗ §3.2). */
export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export interface BudgetStatus {
  percent: number;
  level: BudgetLevel;
}

export function budgetLevel(limit: number, spent: number): BudgetStatus {
  if (!Number.isFinite(limit) || limit <= 0) {
    return { percent: 0, level: 'ok' };
  }
  const percent = Math.round((spent / limit) * 100);
  if (percent >= 100) return { percent, level: 'exceeded' };
  if (percent >= 80) return { percent, level: 'warning' };
  return { percent, level: 'ok' };
}
