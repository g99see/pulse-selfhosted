// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { categoryLabel } from '../src/lib/category-label';
import { t } from '../src/lib/i18n';

const en = (key: string) => t(key, 'en');
const ru = (key: string) => t(key, 'ru');

describe('categoryLabel', () => {
  it('localizes system categories by id', () => {
    expect(categoryLabel({ id: 'sys-food', name: 'Еда' }, en)).toBe('Food');
    expect(categoryLabel({ categoryId: 'sys-connectivity', name: 'Связь' }, en)).toBe(
      'Mobile & internet',
    );
    expect(categoryLabel({ id: 'sys-food', name: 'Еда' }, ru)).toBe('Еда');
  });

  it('keeps user categories as stored, even if named like a system one', () => {
    expect(categoryLabel({ id: 'c1', name: 'Еда' }, en)).toBe('Еда');
    expect(categoryLabel({ name: 'Еда', isSystem: false }, en)).toBe('Еда');
    expect(categoryLabel({ id: 'c2', name: 'Кофе' }, en)).toBe('Кофе');
  });

  it('falls back to the Russian default name when there is no id', () => {
    expect(categoryLabel({ name: 'Транспорт' }, en)).toBe('Transport');
    expect(categoryLabel({ name: 'Кофе' }, en)).toBe('Кофе');
  });

  it('has a translation for all 11 system ids', () => {
    const ids = [
      'food',
      'transport',
      'housing',
      'entertainment',
      'health',
      'subscriptions',
      'shopping',
      'connectivity',
      'other',
      'salary',
      'other-income',
    ];
    for (const id of ids) {
      expect(categoryLabel({ id: `sys-${id}`, name: 'x' }, en)).not.toContain('finance.category');
    }
  });
});
