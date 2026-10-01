// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Названия встроенных категорий хранятся в БД по-русски; на экране их
 * показываем через i18n. Пользовательские категории выводятся как есть.
 */
import { MESSAGES } from './i18n';

const SYSTEM_PREFIX = 'finance.category.system.';

export interface CategoryLabelSource {
  id?: string | null;
  categoryId?: string | null;
  name: string;
  isSystem?: boolean;
}

type Translate = (key: string) => string;

/** Русское имя по умолчанию → id системной категории (для DTO без categoryId). */
const SYSTEM_ID_BY_RU_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(MESSAGES.ru)
    .filter(([key]) => key.startsWith(SYSTEM_PREFIX))
    .map(([key, name]) => [name, key.slice(SYSTEM_PREFIX.length)]),
);

function isKnownSystemId(id: string): boolean {
  return `${SYSTEM_PREFIX}${id}` in MESSAGES.ru;
}

export function categoryLabel(category: CategoryLabelSource, t: Translate): string {
  const id = category.id ?? category.categoryId ?? null;
  if (id) {
    return isKnownSystemId(id) ? t(`${SYSTEM_PREFIX}${id}`) : category.name;
  }
  if (category.isSystem === false) return category.name;
  const byName = SYSTEM_ID_BY_RU_NAME.get(category.name);
  return byName ? t(`${SYSTEM_PREFIX}${byName}`) : category.name;
}
