// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты схем и чистых функций семейного режима (ТЗ §4): создание семьи,
// приглашение и вступление, операции по семейному счёту и расчёты по общим
// целям (прогресс, взнос, прогноз, вехи) на переиспользовании целей.
import { describe, expect, it } from 'vitest';
import {
  FAMILY_INVITE_HOURS_DEFAULT,
  FAMILY_MAX_MEMBERS,
  FamilyAccountCreateSchema,
  FamilyCreateSchema,
  FamilyGoalCreateSchema,
  FamilyGoalDepositSchema,
  FamilyInviteCreateSchema,
  FamilyJoinSchema,
  FamilyTransactionCreateSchema,
  applyFamilyTransaction,
  familyBalanceDelta,
  familyGoalSummary,
  isFamilyInviteActive,
} from '../src/family';

describe('FamilyCreateSchema и FamilyJoinSchema', () => {
  it('принимает непустое название семьи', () => {
    expect(FamilyCreateSchema.parse({ name: '  Дом  ' }).name).toBe('Дом');
    expect(FamilyCreateSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('требует код вступления', () => {
    expect(FamilyJoinSchema.parse({ code: 'ABCD-1234' }).code).toBe('ABCD-1234');
    expect(FamilyJoinSchema.safeParse({ code: 'x' }).success).toBe(false);
  });
});

describe('FamilyInviteCreateSchema', () => {
  it('срок по умолчанию — неделя, границы соблюдены', () => {
    expect(FamilyInviteCreateSchema.parse({}).expiresInHours).toBe(FAMILY_INVITE_HOURS_DEFAULT);
    expect(FamilyInviteCreateSchema.safeParse({ expiresInHours: 0 }).success).toBe(false);
    expect(FamilyInviteCreateSchema.safeParse({ expiresInHours: 99999 }).success).toBe(false);
  });

  it('выявляет активный и использованный/просроченный инвайт', () => {
    const now = new Date(Date.UTC(2026, 9, 1));
    expect(isFamilyInviteActive({ expiresAt: new Date(Date.UTC(2026, 9, 2)), usedAt: null }, now)).toBe(true);
    expect(isFamilyInviteActive({ expiresAt: new Date(Date.UTC(2026, 8, 30)), usedAt: null }, now)).toBe(false);
    expect(
      isFamilyInviteActive({ expiresAt: new Date(Date.UTC(2026, 9, 2)), usedAt: new Date(Date.UTC(2026, 9, 1)) }, now),
    ).toBe(false);
  });
});

describe('FamilyAccountCreateSchema и операции по счёту', () => {
  it('по умолчанию счёт-карта с нулевым балансом', () => {
    const parsed = FamilyAccountCreateSchema.parse({ name: 'Общий' });
    expect(parsed).toMatchObject({ type: 'card', balance: 0 });
  });

  it('доход увеличивает, расход уменьшает баланс', () => {
    expect(familyBalanceDelta('income', 5000)).toBe(5000);
    expect(familyBalanceDelta('expense', 5000)).toBe(-5000);
    expect(applyFamilyTransaction(10000, 'income', 2500)).toBe(12500);
    expect(applyFamilyTransaction(10000, 'expense', 4000)).toBe(6000);
  });

  it('операция требует положительной суммы и известного вида', () => {
    expect(FamilyTransactionCreateSchema.safeParse({ kind: 'income', amount: 100 }).success).toBe(true);
    expect(FamilyTransactionCreateSchema.safeParse({ kind: 'income', amount: 0 }).success).toBe(false);
    expect(FamilyTransactionCreateSchema.safeParse({ kind: 'transfer', amount: 100 }).success).toBe(false);
  });
});

describe('Семейные цели переиспользуют расчёты личных (ТЗ §4)', () => {
  it('принимает цель и отклоняет пустую/нулевую', () => {
    expect(FamilyGoalCreateSchema.parse({ title: 'Ремонт', targetAmount: 200000 }).savedAmount).toBe(0);
    expect(FamilyGoalCreateSchema.safeParse({ title: '', targetAmount: 1 }).success).toBe(false);
    expect(FamilyGoalCreateSchema.safeParse({ title: 'x', targetAmount: 0 }).success).toBe(false);
  });

  it('взнос положительный', () => {
    expect(FamilyGoalDepositSchema.safeParse({ amount: 1000 }).success).toBe(true);
    expect(FamilyGoalDepositSchema.safeParse({ amount: -1 }).success).toBe(false);
  });

  it('считает прогресс, остаток, взнос в месяц и вехи', () => {
    const from = new Date(Date.UTC(2026, 9, 1));
    const summary = familyGoalSummary(100000, 200000, new Date(Date.UTC(2027, 2, 1)), [
      { amount: 50000, date: from },
    ], from);
    expect(summary.percent).toBe(50);
    expect(summary.remaining).toBe(100000);
    expect(summary.milestones).toEqual([25, 50]);
    expect(summary.requiredMonthly).toBe(20000);
    expect(summary.forecastDate?.length).toBeGreaterThan(0);
  });

  it('без пополнений прогноза нет, а цель достигнута — 100%', () => {
    const from = new Date(Date.UTC(2026, 9, 1));
    expect(familyGoalSummary(0, 200000, null, [], from).forecastDate).toBeNull();
    expect(familyGoalSummary(200000, 200000, null, [], from).percent).toBe(100);
  });

  it('предел участников положительный', () => {
    expect(FAMILY_MAX_MEMBERS).toBeGreaterThan(1);
  });
});
