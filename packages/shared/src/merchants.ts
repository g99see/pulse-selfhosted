// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Справочник мировых магазинов и автоопределение операций в выписке (ТЗ v2 §9).
 *
 * Чистая логика, общая для API и web: нормализация строки из выписки, точное
 * совпадение по алиасу, совпадение по шаблону и нечёткое (fuzzy) совпадение с
 * порогом. Сам справочник — файл данных (JSON), его грузит сторона API и может
 * обновлять без изменения кода; личные магазины пользователя живут в БД и
 * имеют приоритет над общей базой.
 */
import { z } from 'zod';

/** Порог нечёткого совпадения: ниже — считаем, что магазин не распознан. */
export const MERCHANT_FUZZY_THRESHOLD = 0.84;

/** Запись справочника магазинов (файл данных). */
export interface MerchantEntry {
  /** Стабильный id записи справочника. */
  id: string;
  /** Каноническое название. */
  name: string;
  /** Варианты написания, как название выглядит в выписке. */
  aliases: readonly string[];
  /** Шаблоны (регулярные выражения) для строк, которые алиасами не описать. */
  patterns?: readonly string[];
  /** Категория по умолчанию — стабильный ключ стандартной категории. */
  defaultCategory: string;
  /** Код страны/регион. */
  country?: string;
  region?: string;
  /** Логотип (необязательно). */
  logo?: string;
}

/** Откуда взято совпадение: общая база или личный магазин пользователя. */
export type MerchantSource = 'world' | 'user';

export interface MerchantEntryWithSource extends MerchantEntry {
  source: MerchantSource;
}

export type MerchantMatchMethod = 'alias' | 'pattern' | 'fuzzy';

export interface MerchantMatch {
  entry: MerchantEntryWithSource;
  method: MerchantMatchMethod;
  /** Что сработало: алиас, шаблон или нормализованное имя. */
  matched: string;
  /** Оценка совпадения (1 у точного алиаса/шаблона, < 1 у fuzzy). */
  score: number;
}

/* ----- Нормализация строки из выписки ----- */

/** Диакритика и буквы, которые NFD не разбирает. */
const CHAR_MAP: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  å: 'a',
  ä: 'a',
  ö: 'o',
  ü: 'u',
  ß: 'ss',
  ñ: 'n',
  ç: 'c',
  è: 'e',
  é: 'e',
  ê: 'e',
  ë: 'e',
  à: 'a',
  á: 'a',
  â: 'a',
  ì: 'i',
  í: 'i',
  î: 'i',
  ï: 'i',
  ò: 'o',
  ó: 'o',
  ô: 'o',
  ù: 'u',
  ú: 'u',
  û: 'u',
  ý: 'y',
  ÿ: 'y',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ś: 's',
  ż: 'z',
  ź: 'z',
  ć: 'c',
  ę: 'e',
  ą: 'a',
  ń: 'n',
  ř: 'r',
  č: 'c',
  š: 's',
  ž: 'z',
  ě: 'e',
  ů: 'u',
  і: 'i',
  ї: 'i',
  є: 'e',
  ґ: 'g',
  ё: 'е',
};

/** Слова-мусор: коды терминалов, тип карты, служебные пометки банка. */
const NOISE_WORDS = new Set([
  'pos',
  'term',
  'terminal',
  'trm',
  'kort',
  'kortkjøp',
  'kortkjop',
  'kob',
  'køb',
  'varer',
  'dankort',
  'visa',
  'mastercard',
  'maestro',
  'butik',
  'butikk',
  'butiken',
  'avd',
  'avdeling',
  'filial',
  'kassa',
  'kasse',
  'ref',
  'refnr',
  'transaksjon',
  'transaktion',
  'betaling',
  'payment',
  'purchase',
  'købt',
  'kobt',
]);

/** Двухбуквенные коды стран и распространённые сокращения городов. */
const NOISE_TOKENS = new Set([
  'dk',
  'se',
  'no',
  'fi',
  'de',
  'us',
  'uk',
  'gb',
  'nl',
  'fr',
  'es',
  'it',
  'pl',
  'pt',
  'ch',
  'at',
  'be',
  'ie',
  'au',
  'ca',
  'nz',
  'eu',
  'cph',
  'kbh',
  'osl',
  'sto',
  'bgo',
  'göteborg',
  'goteborg',
  'malmö',
  'malmo',
  'stockholm',
  'kobenhavn',
  'københavn',
  'copenhagen',
  'oslo',
  'helsinki',
  'berlin',
  'munchen',
  'münchen',
  'hamburg',
  'paris',
  'london',
  'madrid',
  'barcelona',
  'amsterdam',
  'rotterdam',
  'brussels',
  'wien',
  'zurich',
  'warszawa',
  'krakow',
  'kyiv',
  'kiev',
  'lviv',
  'moskva',
  'moscow',
  'spb',
]);

/** Приводит буквы к базовым, убирает диакритику. */
function foldChars(value: string): string {
  let result = '';
  for (const char of value.toLowerCase()) {
    result += CHAR_MAP[char] ?? char;
  }
  return result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Нормализует строку выписки для сопоставления по алиасам: регистр, диакритика,
 * лишние символы, коды терминалов, города, номера точек и даты отбрасываются.
 * @returns Список значимых токенов.
 */
export function merchantTokens(raw: string): string[] {
  const folded = foldChars(raw)
    .replace(/[^a-z0-9а-я]+/g, ' ')
    .trim();
  if (folded === '') return [];
  return folded.split(/\s+/).filter((token) => {
    if (token === '') return false;
    if (/^\d+$/.test(token)) return false; // номера точек и терминалов
    if (/^\d{1,2}[.:]\d{2}$/.test(token)) return false; // время
    if (/^\d{6,8}$/.test(token)) return false; // даты вида 20261007
    if (NOISE_WORDS.has(token)) return false;
    if (NOISE_TOKENS.has(token)) return false;
    return true;
  });
}

/** Нормализованная строка (токены через пробел) для алиасов и fuzzy. */
export function normalizeMerchantText(raw: string): string {
  return merchantTokens(raw).join(' ');
}

/** Строка для проверки шаблонов: сохраняет цифры (номера точек в шаблонах). */
export function merchantPatternText(raw: string): string {
  return foldChars(raw)
    .replace(/[^a-z0-9а-я]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ----- Сопоставление ----- */

function phraseInTokens(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
    let ok = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (tokens[start + offset] !== phrase[offset]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Коэффициент Сёренсена–Дайса по биграммам символов строки. */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (value: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i += 1) {
      const gram = value.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };
  const left = bigrams(a);
  const right = bigrams(b);
  let intersection = 0;
  for (const [gram, count] of left) {
    const other = right.get(gram);
    if (other) intersection += Math.min(count, other);
  }
  const total = a.length - 1 + (b.length - 1);
  return (2 * intersection) / total;
}

/** Расстояние Левенштейна (для порога «почти точное» совпадение). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '' || b === '') return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function similarity(a: string, b: string): number {
  if (a === '' || b === '') return 0;
  const ratio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return Math.max(diceCoefficient(a, b), ratio);
}

interface PreparedAlias {
  text: string;
  tokens: readonly string[];
}

interface PreparedEntry {
  entry: MerchantEntryWithSource;
  aliases: PreparedAlias[];
  patterns: readonly RegExp[];
}

function prepare(entry: MerchantEntry | MerchantEntryWithSource): PreparedEntry {
  const withSource: MerchantEntryWithSource = {
    ...entry,
    source: (entry as MerchantEntryWithSource).source ?? 'world',
  };
  const aliases = [withSource.name, ...withSource.aliases]
    .map((alias) => ({ text: normalizeMerchantText(alias), tokens: merchantTokens(alias) }))
    .filter((alias) => alias.tokens.length > 0);
  const patterns: RegExp[] = [];
  for (const source of withSource.patterns ?? []) {
    try {
      patterns.push(new RegExp(source, 'i'));
    } catch {
      // Некорректный шаблон в файле данных не должен ломать сопоставление.
    }
  }
  return { entry: withSource, aliases, patterns };
}

/** Ищет лучшего кандидата точным алиасом: выигрывает самая длинная фраза. */
function matchAlias(
  tokens: readonly string[],
  prepared: readonly PreparedEntry[],
): MerchantMatch | null {
  let best: { match: MerchantMatch; length: number } | null = null;
  for (const item of prepared) {
    for (const alias of item.aliases) {
      if (phraseInTokens(tokens, alias.tokens)) {
        if (!best || alias.tokens.length > best.length) {
          best = {
            match: {
              entry: item.entry,
              method: 'alias',
              matched: alias.text,
              score: 1,
            },
            length: alias.tokens.length,
          };
        }
      }
    }
  }
  return best?.match ?? null;
}

function matchPattern(
  normalized: string,
  prepared: readonly PreparedEntry[],
): MerchantMatch | null {
  if (normalized === '') return null;
  for (const item of prepared) {
    for (const pattern of item.patterns) {
      if (pattern.test(normalized)) {
        return { entry: item.entry, method: 'pattern', matched: pattern.source, score: 1 };
      }
    }
  }
  return null;
}

function matchFuzzy(
  normalized: string,
  prepared: readonly PreparedEntry[],
  threshold: number,
): MerchantMatch | null {
  if (normalized === '') return null;
  let best: MerchantMatch | null = null;
  for (const item of prepared) {
    for (const alias of item.aliases) {
      const score = similarity(normalized, alias.text);
      if (score >= threshold && (!best || score > best.score)) {
        best = { entry: item.entry, method: 'fuzzy', matched: alias.text, score };
      }
    }
  }
  return best;
}

/**
 * Сопоставляет строку выписки с набором магазинов: точный алиас → шаблон → fuzzy.
 * @param raw Строка из выписки (описание операции).
 * @param entries Магазины (личные пользователя — впереди общей базы).
 * @param threshold Порог нечёткого совпадения.
 */
export function matchMerchant(
  raw: string,
  entries: readonly (MerchantEntry | MerchantEntryWithSource)[],
  threshold = MERCHANT_FUZZY_THRESHOLD,
): MerchantMatch | null {
  const tokens = merchantTokens(raw);
  const normalized = tokens.join(' ');
  const patternText = merchantPatternText(raw);
  const prepared = entries.map(prepare);

  return (
    matchAlias(tokens, prepared) ??
    matchPattern(patternText, prepared) ??
    matchFuzzy(normalized, prepared, threshold)
  );
}

/**
 * Сопоставление с приоритетом личных магазинов: сначала свои (ТЗ §9), затем
 * общая база. Возвращает null, если ни один магазин не подошёл.
 */
export function matchMerchantWithPriority(
  raw: string,
  ownEntries: readonly MerchantEntry[],
  worldEntries: readonly MerchantEntry[],
  threshold = MERCHANT_FUZZY_THRESHOLD,
): MerchantMatch | null {
  const own = ownEntries.map((entry) => ({ ...entry, source: 'user' as const }));
  const world = worldEntries.map((entry) => ({ ...entry, source: 'world' as const }));

  const ownMatch = matchMerchant(raw, own, threshold);
  if (ownMatch) return ownMatch;
  return matchMerchant(raw, world, threshold);
}

/** Поиск магазинов по подстроке (для подсказок «Добавить магазин»). */
export function searchMerchants(
  query: string,
  entries: readonly MerchantEntryWithSource[],
  limit = 20,
): MerchantEntryWithSource[] {
  const normalized = normalizeMerchantText(query);
  if (normalized === '') return entries.slice(0, limit);
  const needle = normalized;
  return entries
    .filter((entry) => {
      const haystack = `${normalizeMerchantText(entry.name)} ${entry.aliases
        .map(normalizeMerchantText)
        .join(' ')}`;
      return haystack.includes(needle);
    })
    .slice(0, limit);
}

/* ----- Схемы запросов API ----- */

/** Создание личного магазина: название, категория, необязательный шаблон. */
export const UserStoreCreateSchema = z.object({
  name: z.string().trim().min(1, { message: 'Введите название' }).max(120),
  categoryId: z.string().min(1, { message: 'Выберите категорию' }),
  /** Шаблон строки в выписке (регулярное выражение); по умолчанию — название. */
  pattern: z.string().trim().max(200).optional(),
  /** Применить ко всем похожим операциям — прошлым и будущим (ТЗ §9). */
  applyToSimilar: z.boolean().default(false),
});
export type UserStoreCreateInput = z.infer<typeof UserStoreCreateSchema>;
export type UserStoreCreateValues = z.input<typeof UserStoreCreateSchema>;

export const UserStoreUpdateSchema = UserStoreCreateSchema.partial();
export type UserStoreUpdateInput = z.infer<typeof UserStoreUpdateSchema>;

/** Объединение своих категорий: операции переносятся на целевую. */
export const MergeCategorySchema = z.object({
  targetId: z.string().min(1, { message: 'Выберите категорию' }),
});
export type MergeCategoryInput = z.infer<typeof MergeCategorySchema>;

/* ----- Контракты ответов ----- */

export interface UserStoreDto {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  pattern: string | null;
  createdAt: string;
}

/** Операция, ожидающая категорию: очередь «Требует внимания» (ТЗ §9). */
export interface UnmatchedTransactionDto {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  amount: number;
  currency: string;
  type: 'expense' | 'income';
  description: string | null;
  /** Что показал автоматический разбор в момент импорта (если что-то). */
  suggestion: MerchantSuggestion | null;
}

export interface MerchantSuggestion {
  merchantId: string;
  name: string;
  categoryId: string | null;
  categoryKey: string;
  method: MerchantMatchMethod;
}
