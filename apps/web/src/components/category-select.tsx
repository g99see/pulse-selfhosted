// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import type { ReactNode } from 'react';
import { orderCategoryTree, type CategoryDto, type CategoryKind } from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Select } from '@/components/ui';
import { categoryLabel } from '@/lib/category-label';

/** Отступ подкатегории в выпадающем списке — неразрывные пробелы. */
const INDENT = '\u00A0\u00A0\u00A0';

type Translate = (key: string) => string;

/**
 * Опции дерева категорий: подкатегории идут сразу под родителем с отступом
 * (ТЗ v2 §8). При заданном `kind` — только категории этого типа.
 */
export function categoryTreeOptions(
  categories: readonly CategoryDto[],
  t: Translate,
  kind?: CategoryKind,
): ReactNode[] {
  const filtered = kind ? categories.filter((category) => category.kind === kind) : [...categories];
  return orderCategoryTree(filtered).map((category) => (
    <option key={category.id} value={category.id}>
      {`${INDENT.repeat(category.depth)}${categoryLabel(category, t)}`}
    </option>
  ));
}

/**
 * Выпадающий список категорий деревом (ТЗ v2 §8): подкатегории вложены под
 * родителем и сдвинуты отступом; тип фильтруется, если он уже задан экраном.
 */
export function CategorySelect({
  id,
  label,
  categories,
  value,
  onChange,
  kind,
  testId,
  emptyLabel,
}: {
  id: string;
  label: string;
  categories: readonly CategoryDto[];
  value: string;
  onChange: (value: string) => void;
  kind?: CategoryKind;
  testId?: string;
  emptyLabel: string;
}) {
  const { t } = useT();
  return (
    <Select
      id={id}
      label={label}
      data-testid={testId ?? id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {categoryTreeOptions(categories, t, kind)}
    </Select>
  );
}
