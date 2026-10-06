// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Декларативный каталог достижений (ТЗ v2 §4). Одна запись = одно достижение:
 * код, группа, иконка, редкость, скрытость, ключ метрики, уровни
 * (бронза/серебро/золото) и тексты ru+en. Логика выдачи — это набор функций-
 * метрик на стороне API (metric key → число по userId); новое достижение на
 * существующей метрике добавляется ОДНОЙ строкой ниже, без правки логики.
 * Новая метрика — это новый ключ в ACHIEVEMENT_METRICS + функция в API.
 *
 * Тексты: ключи i18n `achievements.<код>.title|description`, значения берутся
 * из этой же записи (веб подмешивает их в словарь через achievementMessages).
 * В описании `{n}` заменяется порогом уровня.
 */

/* ----- Метрики и события ----- */

/** События, после которых пересчитываются связанные метрики. */
export const ACHIEVEMENT_EVENTS = [
  'checkin',
  'transaction',
  'budget',
  'reconciliation',
  'import',
  'goal',
  'habit',
  'account',
] as const;
export type AchievementEvent = (typeof ACHIEVEMENT_EVENTS)[number];

const ALL_EVENTS = ACHIEVEMENT_EVENTS;

/**
 * Ключи метрик → события, после которых метрика может измениться. Для каждого
 * ключа в API есть функция вычисления (проверяется типом Record и тестом).
 */
export const ACHIEVEMENT_METRIC_EVENTS = {
  // Чек-ины
  checkin_count: ['checkin'],
  checkin_days: ['checkin'],
  checkin_streak_best: ['checkin'],
  checkin_full_count: ['checkin'],
  checkin_note_count: ['checkin'],
  checkin_tag_count: ['checkin'],
  checkin_summary_count: ['checkin'],
  checkin_energy_count: ['checkin'],
  checkin_stress_count: ['checkin'],
  checkin_water_days: ['checkin'],
  checkin_steps_days: ['checkin'],
  checkin_sleep_days: ['checkin'],
  checkin_morning_count: ['checkin'],
  checkin_evening_count: ['checkin'],
  checkin_both_slots_days: ['checkin'],
  checkin_high_mood_count: ['checkin'],
  checkin_weekend_days: ['checkin'],
  checkin_goal_weeks: ['checkin'],
  special_midnight_checkins: ['checkin'],
  special_early_checkins: ['checkin'],
  special_new_year_checkin: ['checkin'],
  special_leap_day_checkin: ['checkin'],
  mood_comeback_count: ['checkin'],
  // Финансы
  transaction_count: ['transaction', 'import'],
  income_count: ['transaction', 'import'],
  expense_count: ['transaction', 'import'],
  transfer_count: ['transaction', 'import'],
  transaction_days: ['transaction', 'import'],
  transaction_streak_best: ['transaction', 'import'],
  transaction_comment_count: ['transaction', 'import'],
  category_used_count: ['transaction', 'import'],
  currency_count: ['transaction', 'account', 'import'],
  account_count: ['account'],
  budget_count: ['budget'],
  budget_category_count: ['budget'],
  budget_closed_months: ['budget', 'transaction', 'import'],
  budget_closed_streak_best: ['budget', 'transaction', 'import'],
  reconciliation_count: ['reconciliation', 'import'],
  reconciliation_account_count: ['reconciliation', 'import'],
  reconciliation_statement_count: ['import', 'reconciliation'],
  reconciliation_matched_accounts: ['reconciliation', 'import', 'transaction'],
  import_transaction_count: ['import'],
  // Накопления
  goal_count: ['goal'],
  goal_best_percent: ['goal'],
  goal_completed_count: ['goal'],
  goal_deposit_count: ['goal'],
  goal_deposit_days: ['goal'],
  // Привычки
  habit_count: ['habit'],
  habit_log_count: ['habit'],
  habit_active_days: ['habit'],
  habit_best_streak: ['habit'],
  habit_multi_days: ['habit'],
  // Активность (зависят от любых событий)
  active_days: ALL_EVENTS,
  active_streak_best: ALL_EVENTS,
  active_modules: ALL_EVENTS,
  account_age_days: ALL_EVENTS,
  perfect_days: ALL_EVENTS,
} as const satisfies Record<string, readonly AchievementEvent[]>;

export type AchievementMetric = keyof typeof ACHIEVEMENT_METRIC_EVENTS;
export const ACHIEVEMENT_METRICS = Object.keys(ACHIEVEMENT_METRIC_EVENTS) as AchievementMetric[];

/** Метрики, которые могли измениться после события. */
export function metricsForEvent(event: AchievementEvent): AchievementMetric[] {
  return ACHIEVEMENT_METRICS.filter((metric) =>
    (ACHIEVEMENT_METRIC_EVENTS[metric] as readonly AchievementEvent[]).includes(event),
  );
}

/* ----- Типы каталога ----- */

export const ACHIEVEMENT_GROUPS = ['checkin', 'finance', 'activity', 'special'] as const;
export type AchievementGroup = (typeof ACHIEVEMENT_GROUPS)[number];

export const ACHIEVEMENT_RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type AchievementRarity = (typeof ACHIEVEMENT_RARITIES)[number];

export const ACHIEVEMENT_LEVELS = ['bronze', 'silver', 'gold'] as const;
export type AchievementLevel = (typeof ACHIEVEMENT_LEVELS)[number];

export interface AchievementTier {
  level: AchievementLevel;
  threshold: number;
}

export type AchievementCode = string;

export interface AchievementDefinition {
  code: AchievementCode;
  group: AchievementGroup;
  /** Ключ метрики: число, с которым сравниваются пороги уровней. */
  metric: AchievementMetric;
  icon: string;
  rarity: AchievementRarity;
  /** Скрытое: до получения в UI показывается как «???». */
  hidden: boolean;
  /** Уровни по возрастанию порога; одноуровневое — один «gold». */
  tiers: readonly AchievementTier[];
  titleKey: string;
  descriptionKey: string;
  /** Порядок показа внутри группы (индекс в каталоге). */
  position: number;
}

export interface AchievementText {
  title: string;
  description: string;
}

type Locale = 'ru' | 'en';

const LEVEL_SETS: Record<number, readonly AchievementLevel[]> = {
  1: ['gold'],
  2: ['silver', 'gold'],
  3: ['bronze', 'silver', 'gold'],
};

interface Row {
  code: string;
  group: AchievementGroup;
  metric: AchievementMetric;
  icon: string;
  rarity: AchievementRarity;
  thresholds: readonly number[];
  ru: readonly [title: string, description: string];
  en: readonly [title: string, description: string];
  hidden?: boolean;
}

const C = 'common';
const R = 'rare';
const E = 'epic';
const L = 'legendary';

/* ----- Каталог: одна строка — одно достижение ----- */

const ROWS: readonly Row[] = [
  // ===== Чек-ины =====
  {
    code: 'checkin_total',
    group: 'checkin',
    metric: 'checkin_count',
    icon: '🌱',
    rarity: C,
    thresholds: [1, 30, 100],
    ru: ['Первый шаг', 'Чек-инов за всё время: {n}.'],
    en: ['First step', 'Check-ins in total: {n}.'],
  },
  {
    code: 'checkin_streak',
    group: 'checkin',
    metric: 'checkin_streak_best',
    icon: '🔥',
    rarity: R,
    thresholds: [7, 30, 100],
    ru: ['Серия чек-инов', 'Дней с чек-инами подряд: {n}.'],
    en: ['Check-in streak', 'Check-in days in a row: {n}.'],
  },
  {
    code: 'checkin_days',
    group: 'checkin',
    metric: 'checkin_days',
    icon: '📅',
    rarity: C,
    thresholds: [7, 60, 365],
    ru: ['Дни с самочувствием', 'Разных дней с чек-ином: {n}.'],
    en: ['Days of wellbeing', 'Different days with a check-in: {n}.'],
  },
  {
    code: 'checkin_full',
    group: 'checkin',
    metric: 'checkin_full_count',
    icon: '🧩',
    rarity: R,
    thresholds: [1, 20, 100],
    ru: ['Полная картина', 'Чек-инов со всеми полями (энергия, стресс, сон, вода, шаги): {n}.'],
    en: ['Full picture', 'Check-ins with every field (energy, stress, sleep, water, steps): {n}.'],
  },
  {
    code: 'checkin_notes',
    group: 'checkin',
    metric: 'checkin_note_count',
    icon: '✍️',
    rarity: C,
    thresholds: [5, 30, 100],
    ru: ['Дневник мыслей', 'Чек-инов с заметкой: {n}.'],
    en: ['Thought diary', 'Check-ins with a note: {n}.'],
  },
  {
    code: 'checkin_tags',
    group: 'checkin',
    metric: 'checkin_tag_count',
    icon: '🏷️',
    rarity: C,
    thresholds: [5, 30, 100],
    ru: ['Мастер тегов', 'Чек-инов с тегами: {n}.'],
    en: ['Tag master', 'Check-ins with tags: {n}.'],
  },
  {
    code: 'checkin_summary',
    group: 'checkin',
    metric: 'checkin_summary_count',
    icon: '🌙',
    rarity: C,
    thresholds: [3, 20, 60],
    ru: ['Итог дня', 'Вечерних итогов дня: {n}.'],
    en: ['Day wrap-up', 'Evening day summaries: {n}.'],
  },
  {
    code: 'checkin_energy',
    group: 'checkin',
    metric: 'checkin_energy_count',
    icon: '⚡',
    rarity: C,
    thresholds: [10, 50, 200],
    ru: ['Заряд энергии', 'Чек-инов с оценкой энергии: {n}.'],
    en: ['Energy charge', 'Check-ins with an energy rating: {n}.'],
  },
  {
    code: 'checkin_stress',
    group: 'checkin',
    metric: 'checkin_stress_count',
    icon: '🧘',
    rarity: C,
    thresholds: [10, 50, 200],
    ru: ['Под контролем', 'Чек-инов с оценкой стресса: {n}.'],
    en: ['Under control', 'Check-ins with a stress rating: {n}.'],
  },
  {
    code: 'water_days',
    group: 'checkin',
    metric: 'checkin_water_days',
    icon: '💧',
    rarity: C,
    thresholds: [5, 30, 100],
    ru: ['Водный баланс', 'Дней с 8 и более стаканами воды: {n}.'],
    en: ['Water balance', 'Days with 8 or more glasses of water: {n}.'],
  },
  {
    code: 'steps_days',
    group: 'checkin',
    metric: 'checkin_steps_days',
    icon: '👟',
    rarity: R,
    thresholds: [5, 30, 100],
    ru: ['Десять тысяч шагов', 'Дней с 10 000 шагов и более: {n}.'],
    en: ['Ten thousand steps', 'Days with 10,000 steps or more: {n}.'],
  },
  {
    code: 'sleep_days',
    group: 'checkin',
    metric: 'checkin_sleep_days',
    icon: '😴',
    rarity: R,
    thresholds: [5, 30, 100],
    ru: ['Здоровый сон', 'Дней со сном 7–9 часов: {n}.'],
    en: ['Healthy sleep', 'Days with 7–9 hours of sleep: {n}.'],
  },
  {
    code: 'morning_checkins',
    group: 'checkin',
    metric: 'checkin_morning_count',
    icon: '🌅',
    rarity: C,
    thresholds: [5, 30, 100],
    ru: ['Утренний ритуал', 'Утренних чек-инов: {n}.'],
    en: ['Morning ritual', 'Morning check-ins: {n}.'],
  },
  {
    code: 'evening_checkins',
    group: 'checkin',
    metric: 'checkin_evening_count',
    icon: '🌇',
    rarity: C,
    thresholds: [5, 30, 100],
    ru: ['Вечерний ритуал', 'Вечерних чек-инов: {n}.'],
    en: ['Evening ritual', 'Evening check-ins: {n}.'],
  },
  {
    code: 'both_slots',
    group: 'checkin',
    metric: 'checkin_both_slots_days',
    icon: '☯️',
    rarity: R,
    thresholds: [3, 15, 60],
    ru: ['Утро и вечер', 'Дней с утренним и вечерним чек-ином: {n}.'],
    en: ['Morning and evening', 'Days with both a morning and an evening check-in: {n}.'],
  },
  {
    code: 'high_mood',
    group: 'checkin',
    metric: 'checkin_high_mood_count',
    icon: '😄',
    rarity: C,
    thresholds: [5, 30, 100],
    ru: ['Отличное настроение', 'Чек-инов с настроением 5 из 5: {n}.'],
    en: ['Great mood', 'Check-ins with mood 5 out of 5: {n}.'],
  },
  {
    code: 'weekend_checkins',
    group: 'checkin',
    metric: 'checkin_weekend_days',
    icon: '🏖️',
    rarity: C,
    thresholds: [4, 20, 52],
    ru: ['Выходные с Пульсом', 'Выходных дней с чек-ином: {n}.'],
    en: ['Weekends with Pulse', 'Weekend days with a check-in: {n}.'],
  },
  {
    code: 'weekly_goal',
    group: 'checkin',
    metric: 'checkin_goal_weeks',
    icon: '🎯',
    rarity: R,
    thresholds: [1, 4, 12],
    ru: ['Цель недели', 'Недель, когда выполнена цель по чек-инам: {n}.'],
    en: ['Weekly goal', 'Weeks when the check-in goal was met: {n}.'],
  },

  // ===== Финансы: операции =====
  {
    code: 'transactions_total',
    group: 'finance',
    metric: 'transaction_count',
    icon: '🧾',
    rarity: C,
    thresholds: [1, 100, 1000],
    ru: ['Первая запись', 'Операций в дневнике: {n}.'],
    en: ['First entry', 'Transactions logged: {n}.'],
  },
  {
    code: 'expense_entries',
    group: 'finance',
    metric: 'expense_count',
    icon: '🛒',
    rarity: C,
    thresholds: [10, 100, 500],
    ru: ['Учёт расходов', 'Записано расходов: {n}.'],
    en: ['Expense tracking', 'Expenses logged: {n}.'],
  },
  {
    code: 'income_entries',
    group: 'finance',
    metric: 'income_count',
    icon: '💰',
    rarity: C,
    thresholds: [1, 12, 60],
    ru: ['Доходы на виду', 'Записано доходов: {n}.'],
    en: ['Income in sight', 'Incomes logged: {n}.'],
  },
  {
    code: 'transfer_entries',
    group: 'finance',
    metric: 'transfer_count',
    icon: '🔁',
    rarity: C,
    thresholds: [1, 10, 50],
    ru: ['Между счетами', 'Переводов между счетами: {n}.'],
    en: ['Between accounts', 'Transfers between accounts: {n}.'],
  },
  {
    code: 'transaction_days',
    group: 'finance',
    metric: 'transaction_days',
    icon: '🗓️',
    rarity: C,
    thresholds: [7, 60, 200],
    ru: ['Учёт без пропусков', 'Дней с записанными операциями: {n}.'],
    en: ['Steady bookkeeping', 'Days with logged transactions: {n}.'],
  },
  {
    code: 'transaction_streak',
    group: 'finance',
    metric: 'transaction_streak_best',
    icon: '📈',
    rarity: R,
    thresholds: [3, 14, 60],
    ru: ['Серия учёта', 'Дней подряд с записанными операциями: {n}.'],
    en: ['Bookkeeping streak', 'Days in a row with logged transactions: {n}.'],
  },
  {
    code: 'transaction_comments',
    group: 'finance',
    metric: 'transaction_comment_count',
    icon: '💬',
    rarity: C,
    thresholds: [10, 50, 200],
    ru: ['С комментарием', 'Операций с комментарием: {n}.'],
    en: ['With a comment', 'Transactions with a comment: {n}.'],
  },
  {
    code: 'categories_used',
    group: 'finance',
    metric: 'category_used_count',
    icon: '🗂️',
    rarity: C,
    thresholds: [5, 10, 20],
    ru: ['Всё по полочкам', 'Разных категорий в операциях: {n}.'],
    en: ['Neatly sorted', 'Different categories used: {n}.'],
  },
  {
    code: 'multi_currency',
    group: 'finance',
    metric: 'currency_count',
    icon: '🌍',
    rarity: R,
    thresholds: [2, 3, 5],
    ru: ['Мультивалютный', 'Разных валют в счетах и операциях: {n}.'],
    en: ['Multi-currency', 'Different currencies in accounts and transactions: {n}.'],
  },
  {
    code: 'accounts_total',
    group: 'finance',
    metric: 'account_count',
    icon: '🏦',
    rarity: C,
    thresholds: [2, 3, 5],
    ru: ['Несколько счетов', 'Счетов в Пульсе: {n}.'],
    en: ['Several accounts', 'Accounts in Pulse: {n}.'],
  },
  // ===== Финансы: бюджеты =====
  {
    code: 'budgets_set',
    group: 'finance',
    metric: 'budget_count',
    icon: '📋',
    rarity: C,
    thresholds: [1, 6, 24],
    ru: ['Бюджетник', 'Бюджетов по категориям: {n}.'],
    en: ['Budgeteer', 'Category budgets set: {n}.'],
  },
  {
    code: 'budget_categories',
    group: 'finance',
    metric: 'budget_category_count',
    icon: '🎛️',
    rarity: C,
    thresholds: [3, 5, 10],
    ru: ['Всё под контролем', 'Категорий с бюджетом: {n}.'],
    en: ['Everything under control', 'Categories with a budget: {n}.'],
  },
  {
    code: 'budget_closed',
    group: 'finance',
    metric: 'budget_closed_months',
    icon: '📊',
    rarity: R,
    thresholds: [1, 3, 12],
    ru: ['В рамках бюджета', 'Месяцев закрыто без превышения бюджета: {n}.'],
    en: ['Within budget', 'Months closed without exceeding the budget: {n}.'],
  },
  {
    code: 'budget_streak',
    group: 'finance',
    metric: 'budget_closed_streak_best',
    icon: '🛡️',
    rarity: E,
    thresholds: [2, 4, 6],
    ru: ['Финансовая дисциплина', 'Месяцев подряд без превышения бюджета: {n}.'],
    en: ['Financial discipline', 'Months in a row without exceeding the budget: {n}.'],
  },
  // ===== Финансы: сверка и импорт =====
  {
    code: 'reconciliations',
    group: 'finance',
    metric: 'reconciliation_count',
    icon: '⚖️',
    rarity: C,
    thresholds: [1, 5, 20],
    ru: ['Сверка баланса', 'Сверок с данными банка: {n}.'],
    en: ['Balance check', 'Reconciliations with bank data: {n}.'],
  },
  {
    code: 'reconciled_accounts',
    group: 'finance',
    metric: 'reconciliation_account_count',
    icon: '🔍',
    rarity: R,
    thresholds: [1, 3, 5],
    ru: ['Счета сверены', 'Счетов, сверенных с банком: {n}.'],
    en: ['Accounts reconciled', 'Accounts reconciled with the bank: {n}.'],
  },
  {
    code: 'statement_imports',
    group: 'finance',
    metric: 'reconciliation_statement_count',
    icon: '📥',
    rarity: C,
    thresholds: [1, 5, 20],
    ru: ['Выписка загружена', 'Загружено выписок: {n}.'],
    en: ['Statement uploaded', 'Statements uploaded: {n}.'],
  },
  {
    code: 'imported_rows',
    group: 'finance',
    metric: 'import_transaction_count',
    icon: '📦',
    rarity: R,
    thresholds: [10, 200, 2000],
    ru: ['Большой импорт', 'Операций, импортированных из выписок: {n}.'],
    en: ['Big import', 'Transactions imported from statements: {n}.'],
  },
  {
    code: 'balance_match',
    group: 'finance',
    metric: 'reconciliation_matched_accounts',
    icon: '🎯',
    rarity: E,
    thresholds: [1, 3, 5],
    hidden: true,
    ru: ['Копейка в копейку', 'Счетов, где баланс сошёлся с банком: {n}.'],
    en: ['Penny perfect', 'Accounts whose balance matches the bank: {n}.'],
  },
  // ===== Финансы: накопления =====
  {
    code: 'goals_created',
    group: 'finance',
    metric: 'goal_count',
    icon: '🎯',
    rarity: C,
    thresholds: [1, 3, 10],
    ru: ['Первый ориентир', 'Целей накопления создано: {n}.'],
    en: ['First milestone', 'Savings goals created: {n}.'],
  },
  {
    code: 'goal_progress',
    group: 'finance',
    metric: 'goal_best_percent',
    icon: '⛰️',
    rarity: R,
    thresholds: [25, 50, 100],
    ru: ['Путь к цели', 'Лучший прогресс по цели, %: {n}.'],
    en: ['Road to the goal', 'Best goal progress, %: {n}.'],
  },
  {
    code: 'goals_completed',
    group: 'finance',
    metric: 'goal_completed_count',
    icon: '🏆',
    rarity: E,
    thresholds: [1, 3, 10],
    ru: ['Цель достигнута', 'Достигнуто целей: {n}.'],
    en: ['Goal reached', 'Goals reached: {n}.'],
  },
  {
    code: 'goal_deposits',
    group: 'finance',
    metric: 'goal_deposit_count',
    icon: '🐷',
    rarity: C,
    thresholds: [1, 10, 50],
    ru: ['Копилка', 'Пополнений целей: {n}.'],
    en: ['Piggy bank', 'Goal deposits: {n}.'],
  },
  {
    code: 'goal_deposit_days',
    group: 'finance',
    metric: 'goal_deposit_days',
    icon: '💎',
    rarity: R,
    thresholds: [3, 15, 60],
    ru: ['Регулярные накопления', 'Дней с пополнением целей: {n}.'],
    en: ['Regular saving', 'Days with a goal deposit: {n}.'],
  },

  // ===== Активность =====
  {
    code: 'active_days',
    group: 'activity',
    metric: 'active_days',
    icon: '✨',
    rarity: C,
    thresholds: [7, 50, 200],
    ru: ['Дни с Пульсом', 'Дней активности в приложении: {n}.'],
    en: ['Days with Pulse', 'Days of activity in the app: {n}.'],
  },
  {
    code: 'active_streak',
    group: 'activity',
    metric: 'active_streak_best',
    icon: '🚀',
    rarity: R,
    thresholds: [7, 30, 100],
    ru: ['Серия активности', 'Дней активности подряд: {n}.'],
    en: ['Activity streak', 'Days of activity in a row: {n}.'],
  },
  {
    code: 'veteran',
    group: 'activity',
    metric: 'account_age_days',
    icon: '🎖️',
    rarity: R,
    thresholds: [30, 180, 365],
    ru: ['Старожил', 'Дней с момента регистрации: {n}.'],
    en: ['Veteran', 'Days since registration: {n}.'],
  },
  {
    code: 'all_rounder',
    group: 'activity',
    metric: 'active_modules',
    icon: '🧭',
    rarity: E,
    thresholds: [3, 5, 7],
    ru: [
      'Универсал',
      'Разделов, которыми вы пользуетесь (чек-ины, операции, бюджеты, цели, привычки, сверка, импорт): {n}.',
    ],
    en: [
      'All-rounder',
      'Sections in use (check-ins, transactions, budgets, goals, habits, reconciliation, import): {n}.',
    ],
  },
  {
    code: 'habits_created',
    group: 'activity',
    metric: 'habit_count',
    icon: '🌿',
    rarity: C,
    thresholds: [1, 3, 7],
    ru: ['Новая привычка', 'Привычек создано: {n}.'],
    en: ['New habit', 'Habits created: {n}.'],
  },
  {
    code: 'habit_marks',
    group: 'activity',
    metric: 'habit_log_count',
    icon: '✅',
    rarity: C,
    thresholds: [10, 100, 500],
    ru: ['Отметки привычек', 'Выполненных отметок привычек: {n}.'],
    en: ['Habit check-offs', 'Habit marks done: {n}.'],
  },
  {
    code: 'habit_days',
    group: 'activity',
    metric: 'habit_active_days',
    icon: '📆',
    rarity: C,
    thresholds: [7, 50, 200],
    ru: ['Дни привычек', 'Дней с выполненной привычкой: {n}.'],
    en: ['Habit days', 'Days with a habit done: {n}.'],
  },
  {
    code: 'habit_streak',
    group: 'activity',
    metric: 'habit_best_streak',
    icon: '🔗',
    rarity: R,
    thresholds: [7, 30, 100],
    ru: ['Цепочка привычки', 'Дней подряд с одной привычкой: {n}.'],
    en: ['Habit chain', 'Days in a row with a single habit: {n}.'],
  },
  {
    code: 'habit_multi',
    group: 'activity',
    metric: 'habit_multi_days',
    icon: '🎪',
    rarity: R,
    thresholds: [3, 20, 60],
    ru: ['Много дел сразу', 'Дней с тремя и более выполненными привычками: {n}.'],
    en: ['Many things at once', 'Days with three or more habits done: {n}.'],
  },

  // ===== Особые и скрытые =====
  {
    code: 'perfect_day',
    group: 'special',
    metric: 'perfect_days',
    icon: '🌟',
    rarity: E,
    thresholds: [1, 10, 50],
    ru: ['Идеальный день', 'Дней с полным чек-ином, операцией и привычкой: {n}.'],
    en: ['Perfect day', 'Days with a full check-in, a transaction and a habit: {n}.'],
  },
  {
    code: 'midnight_checkin',
    group: 'special',
    metric: 'special_midnight_checkins',
    icon: '🦉',
    rarity: R,
    thresholds: [1, 5, 20],
    hidden: true,
    ru: ['Полуночник', 'Чек-инов между 00:00 и 01:00: {n}.'],
    en: ['Night owl', 'Check-ins between 00:00 and 01:00: {n}.'],
  },
  {
    code: 'early_bird',
    group: 'special',
    metric: 'special_early_checkins',
    icon: '🐦',
    rarity: R,
    thresholds: [1, 5, 20],
    hidden: true,
    ru: ['Жаворонок', 'Чек-инов между 04:00 и 06:00: {n}.'],
    en: ['Early bird', 'Check-ins between 04:00 and 06:00: {n}.'],
  },
  {
    code: 'comeback',
    group: 'special',
    metric: 'mood_comeback_count',
    icon: '🌈',
    rarity: E,
    thresholds: [1, 5, 20],
    hidden: true,
    ru: ['Всё к лучшему', 'Раз, когда настроение выросло с 1–2 до 4–5: {n}.'],
    en: ['It gets better', 'Times your mood rose from 1–2 to 4–5: {n}.'],
  },
  {
    code: 'streak_365',
    group: 'special',
    metric: 'checkin_streak_best',
    icon: '👑',
    rarity: L,
    thresholds: [365],
    hidden: true,
    ru: ['Год без пропусков', 'Дней с чек-инами подряд: {n}.'],
    en: ['A year without gaps', 'Check-in days in a row: {n}.'],
  },
  {
    code: 'new_year',
    group: 'special',
    metric: 'special_new_year_checkin',
    icon: '🎄',
    rarity: E,
    thresholds: [1],
    hidden: true,
    ru: ['С Новым годом!', 'Чек-ин в первый день года.'],
    en: ['Happy New Year!', 'A check-in on the first day of the year.'],
  },
  {
    code: 'leap_day',
    group: 'special',
    metric: 'special_leap_day_checkin',
    icon: '🐸',
    rarity: L,
    thresholds: [1],
    hidden: true,
    ru: ['Редкий день', 'Чек-ин 29 февраля.'],
    en: ['Rare day', 'A check-in on February 29.'],
  },
  {
    code: 'streak_180',
    group: 'special',
    metric: 'checkin_streak_best',
    icon: '🏔️',
    rarity: E,
    thresholds: [180],
    hidden: true,
    ru: ['Полгода в ритме', 'Дней с чек-инами подряд: {n}.'],
    en: ['Half a year in rhythm', 'Check-in days in a row: {n}.'],
  },
  {
    code: 'centurion',
    group: 'special',
    metric: 'checkin_count',
    icon: '💯',
    rarity: L,
    thresholds: [1000],
    hidden: true,
    ru: ['Тысяча чек-инов', 'Чек-инов за всё время: {n}.'],
    en: ['A thousand check-ins', 'Check-ins in total: {n}.'],
  },
];

function buildDefinition(row: Row, index: number): AchievementDefinition {
  const levels = LEVEL_SETS[row.thresholds.length];
  if (!levels) throw new Error(`achievement ${row.code}: недопустимое число уровней`);
  return {
    code: row.code,
    group: row.group,
    metric: row.metric,
    icon: row.icon,
    rarity: row.rarity,
    hidden: row.hidden ?? false,
    tiers: row.thresholds.map((threshold, i) => ({ level: levels[i]!, threshold })),
    titleKey: `achievements.${row.code}.title`,
    descriptionKey: `achievements.${row.code}.description`,
    position: index + 1,
  };
}

/** Каталог в порядке показа. */
export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = ROWS.map(buildDefinition);

/** Алиас прежнего имени каталога. */
export const ACHIEVEMENTS = ACHIEVEMENT_CATALOG;

export const ACHIEVEMENT_CODES: readonly AchievementCode[] = ACHIEVEMENT_CATALOG.map(
  (item) => item.code,
);

/** Тексты достижения по локали (без подстановки порога). */
export const ACHIEVEMENT_TEXTS: Readonly<Record<string, Record<Locale, AchievementText>>> =
  Object.fromEntries(
    ROWS.map((row) => [
      row.code,
      {
        ru: { title: row.ru[0], description: row.ru[1] },
        en: { title: row.en[0], description: row.en[1] },
      },
    ]),
  );

/** Словарь i18n-ключей достижений для подмешивания в словарь веба. */
export function achievementMessages(locale: Locale): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const row of ROWS) {
    const text = row[locale];
    messages[`achievements.${row.code}.title`] = text[0];
    messages[`achievements.${row.code}.description`] = text[1];
  }
  return messages;
}

/** Описание достижения по коду. */
export function achievementByCode(code: AchievementCode): AchievementDefinition | undefined {
  return ACHIEVEMENT_CATALOG.find((item) => item.code === code);
}

/** Название достижения для сообщений вне веба (уведомления, карточки). */
export function achievementTitle(code: AchievementCode, locale: Locale = 'ru'): string {
  return ACHIEVEMENT_TEXTS[code]?.[locale].title ?? code;
}

/** Описание с подставленным порогом уровня. */
export function achievementDescription(
  code: AchievementCode,
  threshold: number,
  locale: Locale = 'ru',
): string {
  return (ACHIEVEMENT_TEXTS[code]?.[locale].description ?? code).replace('{n}', String(threshold));
}

/** Уровни, пороги которых достигнуты значением метрики. */
export function reachedTiers(definition: AchievementDefinition, value: number): AchievementTier[] {
  return definition.tiers.filter((tier) => value >= tier.threshold);
}

export interface AchievementProgress {
  /** Высший полученный уровень или null. */
  level: AchievementLevel | null;
  /** Следующий непройденный уровень или null, если всё получено. */
  next: AchievementTier | null;
  /** Доля пути до следующего порога (от порога предыдущего уровня), 0..1; 1 — всё получено. */
  progress: number;
}

/** Прогресс по значению метрики: текущий уровень, следующий порог и доля пути. */
export function progressFor(definition: AchievementDefinition, value: number): AchievementProgress {
  const reached = reachedTiers(definition, value);
  const level = reached.length > 0 ? reached[reached.length - 1]!.level : null;
  const next = definition.tiers.find((tier) => value < tier.threshold) ?? null;
  if (!next) return { level, next: null, progress: 1 };
  const base = reached.length > 0 ? reached[reached.length - 1]!.threshold : 0;
  const span = next.threshold - base;
  const done = Math.max(0, value - base);
  return { level, next, progress: span > 0 ? Math.min(1, done / span) : 0 };
}
