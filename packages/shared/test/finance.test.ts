// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты финансовых схем и утилит (ТЗ §3.2): категории, счета, транзакции,
// переводы, бюджеты и разбор быстрого ввода текстом.
import { describe, expect, it } from 'vitest';
import {
  AccountCreateSchema,
  BudgetUpsertSchema,
  CategoryCreateSchema,
  TransactionCreateSchema,
  TransferCreateSchema,
  budgetLevel,
  guessCategoryName,
  monthKey,
} from '../src/finance';
import { SYSTEM_CATEGORIES } from '../src/categories';

describe('SYSTEM_CATEGORIES', () => {
  it('содержит базовые категории расходов и доходов', () => {
    const names = SYSTEM_CATEGORIES.map((category) => category.name);
    expect(names).toContain('Еда');
    expect(names).toContain('Транспорт');
    expect(names).toContain('Зарплата');

    const salary = SYSTEM_CATEGORIES.find((category) => category.name === 'Зарплата');
    expect(salary?.kind).toBe('income');
    expect(SYSTEM_CATEGORIES.some((category) => category.kind === 'expense')).toBe(true);
  });

  it('у каждой категории есть иконка и цвет', () => {
    for (const category of SYSTEM_CATEGORIES) {
      expect(category.icon).toBeTruthy();
      expect(category.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe('guessCategoryName', () => {
  it('подбирает «Еда» по «обед»', () => {
    expect(guessCategoryName('обед')).toBe('Еда');
    expect(guessCategoryName('Кофе с собой')).toBe('Еда');
  });

  it('подбирает «Транспорт» по «такси»', () => {
    expect(guessCategoryName('такси')).toBe('Транспорт');
  });

  it('подбирает доходную категорию по «зарплата»', () => {
    expect(guessCategoryName('зарплата')).toBe('Зарплата');
  });

  it('возвращает null, если совпадений нет', () => {
    expect(guessCategoryName('нечто непонятное')).toBeNull();
  });
});

describe('CategoryCreateSchema', () => {
  it('принимает свою категорию с иконкой и цветом', () => {
    const parsed = CategoryCreateSchema.parse({
      name: 'Дача',
      icon: 'trees',
      color: '#2BA889',
      kind: 'expense',
    });
    expect(parsed.name).toBe('Дача');
    expect(parsed.kind).toBe('expense');
  });

  it('отклоняет пустое имя и неверный цвет', () => {
    expect(CategoryCreateSchema.safeParse({ name: '', kind: 'expense' }).success).toBe(false);
    expect(
      CategoryCreateSchema.safeParse({ name: 'ok', kind: 'expense', color: 'green' }).success,
    ).toBe(false);
  });
});

describe('AccountCreateSchema', () => {
  it('принимает счёт и подставляет тип card', () => {
    const parsed = AccountCreateSchema.parse({ name: 'Карта' });
    expect(parsed).toMatchObject({ name: 'Карта', type: 'card', balance: 0 });
  });

  it('отклоняет отрицательный баланс и неизвестный тип', () => {
    expect(AccountCreateSchema.safeParse({ name: 'x', balance: -1 }).success).toBe(false);
    expect(AccountCreateSchema.safeParse({ name: 'x', type: 'crypto' }).success).toBe(false);
  });
});

describe('TransactionCreateSchema', () => {
  it('принимает расход с суммой и датой по умолчанию', () => {
    const parsed = TransactionCreateSchema.parse({ accountId: 'a1', amount: 450, type: 'expense' });
    expect(parsed.amount).toBe(450);
    expect(parsed.type).toBe('expense');
    expect(parsed.date).toBeUndefined();
  });

  it('отклоняет нулевую и отрицательную сумму', () => {
    expect(TransactionCreateSchema.safeParse({ accountId: 'a1', amount: 0 }).success).toBe(false);
    expect(TransactionCreateSchema.safeParse({ accountId: 'a1', amount: -5 }).success).toBe(false);
  });
});

describe('TransferCreateSchema', () => {
  it('принимает перевод между счетами', () => {
    const parsed = TransferCreateSchema.parse({
      fromAccountId: 'a1',
      toAccountId: 'a2',
      amount: 1000,
    });
    expect(parsed.amount).toBe(1000);
  });
});

describe('BudgetUpsertSchema', () => {
  it('принимает лимит на месяц', () => {
    const parsed = BudgetUpsertSchema.parse({ categoryId: 'c1', month: '2026-10', limit: 20000 });
    expect(parsed).toMatchObject({ month: '2026-10', limit: 20000 });
  });

  it('отклоняет неверный формат месяца', () => {
    expect(
      BudgetUpsertSchema.safeParse({ categoryId: 'c1', month: '10.2026', limit: 1 }).success,
    ).toBe(false);
  });
});

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

describe('monthKey', () => {
  it('строит ключ месяца YYYY-MM', () => {
    expect(monthKey(new Date(2026, 9, 15))).toBe('2026-10');
  });
});
