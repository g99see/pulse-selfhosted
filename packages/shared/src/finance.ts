// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Финансовые схемы, типы и утилиты (ТЗ §3.2, §7). Общие для API и web:
 * категории (системные и свои), счета, транзакции, переводы и бюджеты.
 * Суммы передаются как числа, в БД хранятся как Decimal(14,2).
 */
import { z } from 'zod';
import { isCurrency } from './money';
import { AccountTypeSchema, type AccountType } from './auth';

export const TRANSACTION_KINDS = ['expense', 'income', 'transfer'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** Тип категории: расходная или доходная. */
export const CategoryKindSchema = z.enum(['expense', 'income']);
export type CategoryKind = z.infer<typeof CategoryKindSchema>;

/** Сумма транзакции/бюджета: положительная, до 1 млрд. */
const amountSchema = z.number().finite().positive().max(1_000_000_000);

/** Код валюты из поддерживаемого набора (RUB, USD, EUR). */
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCurrency, { message: 'Неподдерживаемая валюта' });

/** Курс валюты: положительный, до 1 млн (Decimal(18, 8)). */
const rateSchema = z.number().finite().positive().max(1_000_000);

/** Ключ месяца «YYYY-MM». */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
  message: 'Месяц в формате YYYY-MM',
});

/** Ключ месяца для даты (локально, без UTC-сдвигов). */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export interface SystemCategory {
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
}

/** Готовые категории (ТЗ §3.2). Засеиваются в БД как системные (user_id = null). */
export const SYSTEM_CATEGORIES: readonly SystemCategory[] = [
  { name: 'Еда', icon: 'utensils', color: '#2BA889', kind: 'expense' },
  { name: 'Транспорт', icon: 'bus', color: '#5B5BD6', kind: 'expense' },
  { name: 'Жильё', icon: 'house', color: '#F2A25C', kind: 'expense' },
  { name: 'Развлечения', icon: 'party-popper', color: '#E5484D', kind: 'expense' },
  { name: 'Здоровье', icon: 'heart-pulse', color: '#E5484D', kind: 'expense' },
  { name: 'Подписки', icon: 'repeat', color: '#5B5BD6', kind: 'expense' },
  { name: 'Покупки', icon: 'shopping-bag', color: '#2BA889', kind: 'expense' },
  { name: 'Связь', icon: 'smartphone', color: '#6E6E7A', kind: 'expense' },
  { name: 'Прочее', icon: 'circle-ellipsis', color: '#6E6E7A', kind: 'expense' },
  { name: 'Зарплата', icon: 'banknote', color: '#2BA889', kind: 'income' },
  { name: 'Прочий доход', icon: 'plus', color: '#2BA889', kind: 'income' },
];

/**
 * Ключевые слова для автоматического подбора категории в быстром вводе
 * (ТЗ §4, P1): «обед 450», «такси 300», «зарплата +80000».
 */
const CATEGORY_KEYWORDS: ReadonlyArray<{ name: string; words: readonly string[] }> = [
  {
    name: 'Еда',
    words: [
      'еда',
      'обед',
      'завтрак',
      'ужин',
      'кофе',
      'продукты',
      'кафе',
      'ресторан',
      'перекус',
      'чай',
    ],
  },
  {
    name: 'Транспорт',
    words: ['такси', 'метро', 'автобус', 'бензин', 'заправка', 'проезд', 'электричка', 'самокат'],
  },
  { name: 'Жильё', words: ['жильё', 'аренда', 'квартира', 'коммунал', 'коммун', 'ипотека', 'дом'] },
  {
    name: 'Развлечения',
    words: ['кино', 'игра', 'развлечен', 'концерт', 'бар', 'театр', 'подписка игры'],
  },
  {
    name: 'Здоровье',
    words: ['здоровье', 'аптека', 'врач', 'лекарств', 'стоматолог', 'больниц', 'анализы'],
  },
  {
    name: 'Подписки',
    words: ['подписка', 'netflix', 'spotify', 'яндекс плюс', 'icloud', 'google one'],
  },
  {
    name: 'Покупки',
    words: ['покупк', 'магазин', 'одежд', 'обувь', 'техника', 'ozon', 'wildberries'],
  },
  { name: 'Связь', words: ['связь', 'интернет', 'мобильн', 'тариф', 'sim'] },
  { name: 'Зарплата', words: ['зарплата', 'аванс', 'оклад', 'получка'] },
  { name: 'Прочий доход', words: ['доход', 'премия', 'кэшбэк', 'кэшбек', 'возврат', 'подарок'] },
];

/**
 * Подбирает системную категорию по названию/комментарию (ТЗ §4, P1).
 * @returns имя категории или null, если совпадений нет.
 */
export function guessCategoryName(input: string): string | null {
  const haystack = input.toLowerCase();
  for (const { name, words } of CATEGORY_KEYWORDS) {
    if (words.some((word) => haystack.includes(word))) return name;
  }
  return null;
}

export const CategoryCreateSchema = z.object({
  name: z.string().trim().min(1, { message: 'Введите название' }).max(80),
  kind: CategoryKindSchema,
  icon: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, { message: 'Иконка: латиница, цифры и дефис' })
    .default('tag'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, { message: 'Цвет в формате #RRGGBB' })
    .default('#6E6E7A'),
});
export type CategoryCreateInput = z.infer<typeof CategoryCreateSchema>;
export type CategoryCreateValues = z.input<typeof CategoryCreateSchema>;

export const CategoryUpdateSchema = CategoryCreateSchema.partial();
export type CategoryUpdateInput = z.infer<typeof CategoryUpdateSchema>;

export const AccountCreateSchema = z.object({
  name: z.string().trim().min(1, { message: 'Введите название счёта' }).max(80),
  type: AccountTypeSchema.default('card'),
  balance: z.number().finite().min(0).max(1_000_000_000).default(0),
  currency: currencyCodeSchema.optional(),
});
export type AccountCreateInput = z.infer<typeof AccountCreateSchema>;
export type AccountCreateValues = z.input<typeof AccountCreateSchema>;

export const AccountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  type: AccountTypeSchema.optional(),
  balance: z.number().finite().min(0).max(1_000_000_000).optional(),
  currency: currencyCodeSchema.optional(),
});
export type AccountUpdateInput = z.infer<typeof AccountUpdateSchema>;

/** Дата операции: YYYY-MM-DD или ISO-строка. По умолчанию — сегодня (на API). */
const dateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Некорректная дата' });

export const TransactionCreateSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  type: z.enum(['expense', 'income']).default('expense'),
  amount: amountSchema,
  /** Валюта операции; по умолчанию — валюта счёта (ТЗ §3.2). */
  currency: currencyCodeSchema.optional(),
  /** Зафиксированный курс валюты операции к основной валюте пользователя. */
  rate: rateSchema.optional(),
  comment: z.string().trim().max(500).optional(),
  date: dateSchema.optional(),
});
export type TransactionCreateInput = z.infer<typeof TransactionCreateSchema>;
export type TransactionCreateValues = z.input<typeof TransactionCreateSchema>;

export const TransferCreateSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amount: amountSchema,
    /** Сумма зачисления в валюте счёта-получателя (для счетов разных валют). */
    toAmount: amountSchema.optional(),
    comment: z.string().trim().max(500).optional(),
    date: dateSchema.optional(),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: 'Счета перевода должны отличаться',
    path: ['toAccountId'],
  });
export type TransferCreateInput = z.infer<typeof TransferCreateSchema>;

export const BudgetUpsertSchema = z.object({
  categoryId: z.string().min(1),
  month: monthSchema,
  limit: amountSchema,
});
export type BudgetUpsertInput = z.infer<typeof BudgetUpsertSchema>;

export const QuickTransactionSchema = z.object({
  text: z.string().trim().min(1, { message: 'Введите текст' }).max(200),
  accountId: z.string().min(1).optional(),
});
export type QuickTransactionInput = z.infer<typeof QuickTransactionSchema>;

export const TransactionFilterSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  accountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  type: z.enum(['expense', 'income', 'transfer']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type TransactionFilter = z.infer<typeof TransactionFilterSchema>;

/* ----- Курсы валют (ТЗ §3.2) ----- */

/** Ручной курс: одна единица base стоит rate единиц quote на дату. */
export const ExchangeRateCreateSchema = z
  .object({
    date: dateSchema,
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: rateSchema,
    source: z.enum(['manual', 'provider']).default('manual'),
  })
  .refine((value) => value.base !== value.quote, {
    message: 'Валюты курса должны отличаться',
    path: ['quote'],
  });
export type ExchangeRateCreateInput = z.infer<typeof ExchangeRateCreateSchema>;
export type ExchangeRateCreateValues = z.input<typeof ExchangeRateCreateSchema>;

export const ExchangeRateFilterSchema = z.object({
  date: dateSchema.optional(),
  base: currencyCodeSchema.optional(),
  quote: currencyCodeSchema.optional(),
});
export type ExchangeRateFilter = z.infer<typeof ExchangeRateFilterSchema>;

/** Курс валюты в ответах API. */
export interface ExchangeRateDto {
  id: string;
  date: string;
  base: string;
  quote: string;
  rate: number;
  source: string;
}

/* ----- Контракты ответов API (общие для web и api) ----- */

export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export interface BudgetStatus {
  percent: number;
  level: BudgetLevel;
}

/** Уровень предупреждения бюджета (ТЗ §3.2): 80% — warning, 100% — exceeded. */
export function budgetLevel(limit: number, spent: number): BudgetStatus {
  if (!Number.isFinite(limit) || limit <= 0) {
    return { percent: 0, level: 'ok' };
  }
  const percent = Math.round((spent / limit) * 100);
  if (percent >= 100) return { percent, level: 'exceeded' };
  if (percent >= 80) return { percent, level: 'warning' };
  return { percent, level: 'ok' };
}

export interface AccountDto {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  currency: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
  isSystem: boolean;
}

export interface TransactionDto {
  id: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  type: TransactionKind;
  amount: number;
  currency: string;
  /** Курс валюты операции к основной валюте пользователя на дату операции. */
  rate: number;
  /** Сумма в основной валюте пользователя (amount × rate). */
  amountBase: number;
  /** Основная валюта пользователя, в которой посчитан amountBase. */
  baseCurrency: string;
  /** Сумма зачисления при переводе в валюте счёта-получателя. */
  toAmount: number | null;
  date: string;
  comment: string | null;
  transferAccountId: string | null;
  createdAt: string;
}

export interface BudgetDto {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  month: string;
  limit: number;
  spent: number;
  percent: number;
  level: BudgetLevel;
}

export interface FinanceOverviewResponse {
  accounts: AccountDto[];
  categories: CategoryDto[];
  transactions: TransactionDto[];
  budgets: BudgetDto[];
  totalBalance: number;
  currency: string;
}
