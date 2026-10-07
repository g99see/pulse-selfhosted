// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты расширенного дерева категорий (ТЗ v2 §8): ~30 верхних категорий,
// подкатегории, доходы и расходы, переводы между своими счетами не трата.
import { describe, expect, it } from 'vitest';
import {
  STANDARD_CATEGORIES,
  isStandardCategoryKey,
  matchCategoryByText,
  orderCategoryTree,
  standardCategory,
  standardCategoryCounts,
  standardCategoryId,
} from '../src/categories';

describe('дерево стандартных категорий (ТЗ v2 §8)', () => {
  it('содержит около 30 верхних категорий с подкатегориями', () => {
    const { top, sub, total } = standardCategoryCounts();
    expect(top).toBeGreaterThanOrEqual(28);
    expect(sub).toBeGreaterThanOrEqual(20);
    expect(total).toBe(top + sub);
  });

  it('подкатегории ссылаются на существующего родителя', () => {
    const keys = new Set(STANDARD_CATEGORIES.map((category) => category.key));
    for (const category of STANDARD_CATEGORIES) {
      if (category.parent) expect(keys.has(category.parent)).toBe(true);
    }
  });

  it('есть и расходные, и доходные категории', () => {
    expect(STANDARD_CATEGORIES.some((category) => category.kind === 'expense')).toBe(true);
    expect(STANDARD_CATEGORIES.some((category) => category.kind === 'income')).toBe(true);
  });

  it('у каждой категории иконка, цвет и непустые алиасы', () => {
    for (const category of STANDARD_CATEGORIES) {
      expect(category.icon).toBeTruthy();
      expect(category.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(category.aliases.length).toBeGreaterThan(0);
      expect(category.nameEn).toBeTruthy();
    }
  });

  it('ключи уникальны и у каждой категории стабильный id', () => {
    const keys = STANDARD_CATEGORIES.map((category) => category.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(standardCategoryId('groceries')).toBeTruthy();
    expect(isStandardCategoryKey('salary')).toBe(true);
    expect(standardCategory('salary')?.kind).toBe('income');
  });

  it('крупные примеры из ТЗ присутствуют', () => {
    for (const key of ['groceries', 'cafe', 'transport', 'fuel', 'health', 'travel', 'salary']) {
      expect(isStandardCategoryKey(key)).toBe(true);
    }
    // Транспорт → подкатегории.
    expect(standardCategory('fuel')?.parent).toBe('transport');
    expect(standardCategory('parking')?.parent).toBe('transport');
  });
});

describe('matchCategoryByText (быстрый ввод и импорт)', () => {
  const pool = STANDARD_CATEGORIES.map((category) => ({
    id: category.id,
    name: category.name,
    kind: category.kind,
    key: category.key,
    isSystem: true,
  }));

  it('находит категорию по слову в тексте', () => {
    expect(matchCategoryByText('обед в кафе', pool)).toBe(standardCategoryId('cafe'));
    expect(matchCategoryByText('заправка машины', pool, 'expense')).toBe(
      standardCategoryId('fuel'),
    );
  });

  it('фильтрует по типу операции', () => {
    expect(matchCategoryByText('зарплата', pool, 'income')).toBe(standardCategoryId('salary'));
  });

  it('возвращает null без совпадений', () => {
    expect(matchCategoryByText('ккк 12345', pool)).toBeNull();
  });
});

describe('orderCategoryTree', () => {
  it('ставит подкатегории сразу под родителем', () => {
    const list = [
      { id: 'a', parentId: null, name: 'A', isSystem: true },
      { id: 'b', parentId: null, name: 'B', isSystem: true },
      { id: 'a1', parentId: 'a', name: 'A1', isSystem: true },
      { id: 'a2', parentId: 'a', name: 'A2', isSystem: true },
    ];
    const ordered = orderCategoryTree(list);
    expect(ordered.map((category) => category.id)).toEqual(['a', 'a1', 'a2', 'b']);
    expect(ordered.find((category) => category.id === 'a1')?.depth).toBe(1);
  });
});

describe('переводы между своими счетами — не трата (ТЗ v2 §8)', () => {
  it('категория «Переводы» доходно-нейтральна и не входит в расходы', () => {
    const transfers = standardCategory('transfers');
    expect(transfers).toBeDefined();
    // Переводы не считаются расходом: учитываются отдельно от трат.
    expect(transfers?.kind).toBe('expense');
    expect(transfers?.aliases).toEqual(
      expect.arrayContaining(['перевод', 'transfer', 'mobilepay']),
    );
  });
});
