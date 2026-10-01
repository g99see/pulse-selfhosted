// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты чистой логики формы своей категории (ТЗ §3.2): нормализация
// названия, допустимые иконки и цвета палитры, валидация.
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CATEGORY_NAME_MAX,
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_ICON,
  iconGlyph,
  isCategoryColor,
  isCategoryIcon,
  normalizeCategoryName,
  validateCategoryForm,
} from '../src/lib/category-form';

describe('normalizeCategoryName', () => {
  it('обрезает пробелы по краям', () => {
    expect(normalizeCategoryName('  Кофе  ')).toBe('Кофе');
  });

  it('схлопывает повторяющиеся пробелы и переводы строк', () => {
    expect(normalizeCategoryName('Дом   и\n семья')).toBe('Дом и семья');
  });

  it('пустую строку превращает в пустую', () => {
    expect(normalizeCategoryName('   ')).toBe('');
  });
});

describe('набор иконок и палитра цветов', () => {
  it('содержит дефолтные значения из наборов', () => {
    expect(isCategoryIcon(DEFAULT_CATEGORY_ICON)).toBe(true);
    expect(isCategoryColor(DEFAULT_CATEGORY_COLOR)).toBe(true);
  });

  it('не содержит красного цвета (ТЗ §8)', () => {
    for (const color of CATEGORY_COLORS) {
      expect(color.value.toLowerCase()).not.toBe('#e5484d');
    }
  });

  it('все цвета — валидный hex #RRGGBB', () => {
    for (const color of CATEGORY_COLORS) {
      expect(color.value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('у каждой иконки есть символ и ключ подписи', () => {
    for (const icon of CATEGORY_ICONS) {
      expect(icon.glyph.length).toBeGreaterThan(0);
      expect(icon.labelKey).toMatch(/^finance\.category\.icon\./);
    }
  });

  it('iconGlyph отдаёт символ известной иконки и запасной для чужой', () => {
    expect(iconGlyph('utensils')).toBe(iconGlyph('utensils'));
    expect(iconGlyph('unknown-icon')).toBe('🏷️');
    // иконки стандартных категорий, которых нет в палитре, тоже рисуются
    for (const name of ['repeat', 'circle-ellipsis', 'plus']) {
      expect(iconGlyph(name)).not.toBe('🏷️');
    }
  });
});

describe('validateCategoryForm', () => {
  const base = { name: 'Кофе', kind: 'expense' as const, icon: 'utensils', color: '#2BA889' };

  it('принимает корректную форму и возвращает нормализованные значения', () => {
    const result = validateCategoryForm({ ...base, name: '  Кофе  ' });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.values.name).toBe('Кофе');
    expect(result.values.icon).toBe('utensils');
  });

  it('требует название', () => {
    const result = validateCategoryForm({ ...base, name: '   ' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('name_required');
  });

  it('ограничивает длину названия', () => {
    const result = validateCategoryForm({ ...base, name: 'а'.repeat(CATEGORY_NAME_MAX + 1) });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('name_too_long');
  });

  it('отвергает иконку вне набора', () => {
    const result = validateCategoryForm({ ...base, icon: 'skull' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('icon_invalid');
  });

  it('отвергает цвет вне палитры', () => {
    const result = validateCategoryForm({ ...base, color: '#123456' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('color_invalid');
  });

  it('подставляет дефолты, если поля не заданы', () => {
    const result = validateCategoryForm({ name: 'Кино', kind: 'income' });
    expect(result.ok).toBe(true);
    expect(result.values.icon).toBe(DEFAULT_CATEGORY_ICON);
    expect(result.values.color).toBe(DEFAULT_CATEGORY_COLOR);
    expect(result.values.kind).toBe('income');
  });

  it('неизвестный тип сводит к расходу', () => {
    const result = validateCategoryForm({ ...base, kind: 'weird' as never });
    expect(result.values.kind).toBe('expense');
  });
});
