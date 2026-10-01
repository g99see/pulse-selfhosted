// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чистая логика формы своей категории (ТЗ §3.2): допустимые иконки и цвета
 * палитры, нормализация названия и валидация. Без React и строк интерфейса —
 * ошибки возвращаются кодами, подписи живут в i18n; покрывается unit-тестами.
 */
import type { CategoryKind } from '@puls/shared';

/** Иконка из набора: lucide-подобное имя для API + символ для отображения. */
export interface CategoryIconOption {
  /** Значение для API (латиница, цифры, дефис). */
  name: string;
  /** Символ или эмодзи для интерфейса. */
  glyph: string;
  /** Ключ подписи в i18n (доступное имя для скринридера). */
  labelKey: string;
}

/** Небольшой набор иконок для своих категорий (ТЗ §3.2). */
export const CATEGORY_ICONS: readonly CategoryIconOption[] = [
  { name: 'tag', glyph: '🏷', labelKey: 'finance.category.icon.tag' },
  { name: 'utensils', glyph: '🍽', labelKey: 'finance.category.icon.utensils' },
  { name: 'bus', glyph: '🚌', labelKey: 'finance.category.icon.bus' },
  { name: 'house', glyph: '🏠', labelKey: 'finance.category.icon.house' },
  { name: 'shopping-bag', glyph: '🛍', labelKey: 'finance.category.icon.shoppingBag' },
  { name: 'heart-pulse', glyph: '❤️', labelKey: 'finance.category.icon.heartPulse' },
  { name: 'party-popper', glyph: '🎉', labelKey: 'finance.category.icon.partyPopper' },
  { name: 'banknote', glyph: '💵', labelKey: 'finance.category.icon.banknote' },
  { name: 'gift', glyph: '🎁', labelKey: 'finance.category.icon.gift' },
  { name: 'plane', glyph: '✈️', labelKey: 'finance.category.icon.plane' },
  { name: 'book', glyph: '📚', labelKey: 'finance.category.icon.book' },
  { name: 'dumbbell', glyph: '🏋️', labelKey: 'finance.category.icon.dumbbell' },
  { name: 'smartphone', glyph: '📱', labelKey: 'finance.category.icon.smartphone' },
  { name: 'paw-print', glyph: '🐾', labelKey: 'finance.category.icon.pawPrint' },
];

/** Цвета берём из палитры «спокойный компаньон» (ТЗ §8), без красного. */
export interface CategoryColorOption {
  /** Hex-значение для API и стилей. */
  value: string;
  /** Ключ подписи в i18n (доступное имя для скринридера). */
  labelKey: string;
}

export const CATEGORY_COLORS: readonly CategoryColorOption[] = [
  { value: '#5B5BD6', labelKey: 'finance.category.color.indigo' },
  { value: '#2BA889', labelKey: 'finance.category.color.green' },
  { value: '#F2A25C', labelKey: 'finance.category.color.orange' },
  { value: '#6E6E7A', labelKey: 'finance.category.color.gray' },
  { value: '#3DD6AE', labelKey: 'finance.category.color.teal' },
  { value: '#8B8BF5', labelKey: 'finance.category.color.lavender' },
];

export const DEFAULT_CATEGORY_ICON = 'tag';
export const DEFAULT_CATEGORY_COLOR = '#5B5BD6';
export const CATEGORY_NAME_MAX = 80;

/** Значения формы своей категории (совместимы с CategoryCreateSchema). */
export interface CategoryFormValues {
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
}

export type CategoryFormError =
  | 'name_required'
  | 'name_too_long'
  | 'icon_invalid'
  | 'color_invalid';

export interface CategoryFormResult {
  ok: boolean;
  values: CategoryFormValues;
  errors: CategoryFormError[];
}

/** Схлопывает повторяющиеся пробелы и обрезает название по краям. */
export function normalizeCategoryName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Иконка входит в набор? */
export function isCategoryIcon(name: string): boolean {
  return CATEGORY_ICONS.some((icon) => icon.name === name);
}

/** Цвет входит в палитру? Сравнение без учёта регистра. */
export function isCategoryColor(color: string): boolean {
  const value = color.toLowerCase();
  return CATEGORY_COLORS.some((option) => option.value.toLowerCase() === value);
}

/** Символ иконки по имени; для неизвестной — нейтральный ярлык. */
/**
 * Иконки стандартных категорий (packages/shared DEFAULT_CATEGORIES), которых нет
 * в палитре выбора: без них строки «Подписки», «Прочее», «Прочий доход» были пустыми.
 */
const DEFAULT_ONLY_GLYPHS: Readonly<Record<string, string>> = {
  repeat: '🔁',
  'circle-ellipsis': '💬',
  plus: '➕',
};

/** Запасной символ с VS16: без него 🏷 на части систем не рисуется вовсе. */
const FALLBACK_GLYPH = '🏷️';

export function iconGlyph(name: string): string {
  return CATEGORY_ICONS.find((icon) => icon.name === name)?.glyph ?? DEFAULT_ONLY_GLYPHS[name] ?? FALLBACK_GLYPH;
}

/**
 * Нормализует и проверяет форму своей категории.
 * @returns нормализованные значения и коды ошибок (для перевода в компоненте).
 */
export function validateCategoryForm(values: Partial<CategoryFormValues>): CategoryFormResult {
  const name = normalizeCategoryName(values.name ?? '');
  const kind: CategoryKind = values.kind === 'income' ? 'income' : 'expense';
  const icon = values.icon ?? DEFAULT_CATEGORY_ICON;
  const color = values.color ?? DEFAULT_CATEGORY_COLOR;

  const errors: CategoryFormError[] = [];
  if (!name) errors.push('name_required');
  else if (name.length > CATEGORY_NAME_MAX) errors.push('name_too_long');
  if (!isCategoryIcon(icon)) errors.push('icon_invalid');
  if (!isCategoryColor(color)) errors.push('color_invalid');

  return { ok: errors.length === 0, values: { name, kind, icon, color }, errors };
}
