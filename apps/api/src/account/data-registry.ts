// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Единый реестр таблиц пользователя для экспорта и удаления (ТЗ §3.1, §6).
 *
 * Здесь и только здесь перечислено, что входит в выгрузку. Когда появляется
 * новая таблица с колонкой `user_id`, её нужно добавить в EXPORT_TABLES либо в
 * EXCLUDED_USER_TABLES с причиной — интеграционный тест «каждая таблица с
 * user_id покрыта» упадёт, пока запись не сделана.
 *
 * Удаление аккаунта на реестр не опирается: оно обходит все таблицы с user_id
 * из information_schema, поэтому остаётся полным даже при отстающем реестре.
 */
export interface ExportTable {
  /** Физическая таблица в PostgreSQL. */
  table: string;
  /** Ключ сущности в документе выгрузки. */
  entity: string;
  /** Колонка владельца: `user_id` (или `id` у самой таблицы users). */
  keyColumn: 'user_id' | 'id';
  /** Дополнительные колонки-секреты, помимо распознанных isSecretColumn. */
  secretColumns?: readonly string[];
  /** Порядок строк в выгрузке (константа, не приходит от клиента). */
  orderBy?: string;
}

/** Таблицы, которые отдаются пользователю (без секретов). */
export const EXPORT_TABLES: readonly ExportTable[] = [
  { table: 'users', entity: 'user', keyColumn: 'id', secretColumns: ['password_hash'] },
  { table: 'accounts', entity: 'accounts', keyColumn: 'user_id', orderBy: '"created_at"' },
  { table: 'categories', entity: 'categories', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Личные магазины пользователя (ТЗ v2 §9): название, шаблон и категория.
  {
    table: 'user_merchants',
    entity: 'userMerchants',
    keyColumn: 'user_id',
    orderBy: '"created_at"',
  },
  {
    table: 'transactions',
    entity: 'transactions',
    keyColumn: 'user_id',
    orderBy: '"date", "created_at"',
  },
  // Баланс счёта по данным банка (сверка): закрывающий остаток выписки или ручной ввод.
  {
    table: 'account_bank_balances',
    entity: 'accountBankBalances',
    keyColumn: 'user_id',
    orderBy: '"created_at"',
  },
  { table: 'budgets', entity: 'budgets', keyColumn: 'user_id', orderBy: '"month"' },
  { table: 'goals', entity: 'goals', keyColumn: 'user_id', orderBy: '"created_at"' },
  { table: 'goal_deposits', entity: 'goalDeposits', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Привычки (ТЗ §4, P2): название, иконка и цель — данные пользователя.
  { table: 'habits', entity: 'habits', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Отметки привычек (ТЗ §4, P2): день и флаг — действия пользователя.
  { table: 'habit_logs', entity: 'habitLogs', keyColumn: 'user_id', orderBy: '"date"' },
  {
    table: 'recurring_payments',
    entity: 'recurringPayments',
    keyColumn: 'user_id',
    orderBy: '"created_at"',
  },
  { table: 'check_ins', entity: 'checkIns', keyColumn: 'user_id', orderBy: '"occurred_at"' },
  {
    table: 'notification_rules',
    entity: 'notificationRules',
    keyColumn: 'user_id',
    orderBy: '"type"',
  },
  { table: 'daily_stats', entity: 'dailyStats', keyColumn: 'user_id', orderBy: '"date"' },
  // Курсы валют (ТЗ §3.2): дата, пара и курс — не секреты, выгружаем.
  {
    table: 'exchange_rates',
    entity: 'exchangeRates',
    keyColumn: 'user_id',
    orderBy: '"date", "base", "quote"',
  },
  // Внешние привязки (Google; для Telegram — прежние записи без пароля): subject не секрет.
  {
    table: 'external_identities',
    entity: 'externalIdentities',
    keyColumn: 'user_id',
    orderBy: '"created_at"',
  },
  // Привязка Telegram-чата (ТЗ §3.6): chat_id — идентификатор чата, выгружается как есть.
  {
    table: 'telegram_links',
    entity: 'telegramLinks',
    keyColumn: 'user_id',
    orderBy: '"linked_at"',
  },
  // Привязка Discord (v2 §5): id аккаунта и личного канала — не секреты.
  {
    table: 'discord_links',
    entity: 'discordLinks',
    keyColumn: 'user_id',
    orderBy: '"linked_at"',
  },
  // Настройки каналов уведомлений (v2 §5): расписание, тихие часы, часовой пояс.
  {
    table: 'notification_channel_settings',
    entity: 'notificationChannelSettings',
    keyColumn: 'user_id',
    orderBy: '"channel"',
  },
  // Журнал доставок уведомлений (v2 §5): тип, статус, ошибка — данные пользователя.
  {
    table: 'notification_deliveries',
    entity: 'notificationDeliveries',
    keyColumn: 'user_id',
    orderBy: '"created_at"',
  },
  // Полученные достижения (ТЗ §4): код бейджа и дата — не секреты, выгружаем.
  {
    table: 'user_achievements',
    entity: 'userAchievements',
    keyColumn: 'user_id',
    orderBy: '"earned_at"',
  },
  // Инсайты и оценки рекомендаций (ТЗ §3.5): тип, ключ текста и параметры — не секреты.
  { table: 'insights', entity: 'insights', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Личный AI-ключ (ТЗ §3.9): сам ключ — секрет, выгружаем провайдера и last4.
  {
    table: 'user_ai_keys',
    entity: 'userAiKeys',
    keyColumn: 'user_id',
    secretColumns: ['api_key_encrypted'],
  },
  // Учёт токенов AI (ТЗ §3.9): месяц, токены и стоимость — не секреты.
  { table: 'ai_usage', entity: 'aiUsage', keyColumn: 'user_id', orderBy: '"month"' },
  // Предложения AI-помощника (ТЗ §3.9): тип, текст и параметры — данные пользователя.
  { table: 'ai_proposals', entity: 'aiProposals', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Капсулы времени (ТЗ §4, P2): тело письма — секрет (расшифровывается только
  // владельцу через API после открытия), поэтому в выгрузке только метаданные.
  {
    table: 'time_capsules',
    entity: 'timeCapsules',
    keyColumn: 'user_id',
    secretColumns: ['body_encrypted'],
    orderBy: '"created_at"',
  },
  // Журнал доставок вебхуков (ТЗ §4): событие, статус и ошибка — данные пользователя.
  {
    table: 'webhook_deliveries',
    entity: 'webhookDeliveries',
    keyColumn: 'user_id',
    orderBy: '"created_at"',
  },
];

/** Таблицы с user_id, которые намеренно не выгружаются (секреты и артефакты). */
export const EXCLUDED_USER_TABLES: readonly { table: string; reason: string }[] = [
  { table: 'sessions', reason: 'секрет: хеш токена серверной сессии' },
  { table: 'email_verification_tokens', reason: 'секрет: одноразовый токен подтверждения email' },
  { table: 'discord_link_codes', reason: 'секрет: хеш одноразового токена привязки Discord' },
  { table: 'telegram_link_codes', reason: 'секрет: хеш одноразового токена привязки Telegram' },
  { table: 'check_in_drafts', reason: 'временный черновик диалога чек-ина (TTL 30 минут)' },
  { table: 'password_tokens', reason: 'секрет: хеш одноразового токена установки/сброса пароля' },
  { table: 'day_summary_links', reason: 'секрет: хеш токена приватной ссылки «Итог дня»' },
  // Токены открытого API (ТЗ §4): секрет — хеш токена.
  { table: 'api_tokens', reason: 'секрет: хеш личного токена доступа' },
  // Вебхуки (ТЗ §4): секрет — зашифрованный ключ подписи.
  { table: 'webhooks', reason: 'секрет: зашифрованный секрет подписи вебхука' },
];

/** Колонки, которые никогда не попадают в выгрузку, в какой бы таблице ни лежали. */
const SECRET_COLUMN_PATTERNS: readonly RegExp[] = [
  /password_hash/,
  /token_hash/,
  /code_hash/,
  /secret/,
  /^auth$/,
  /^p256dh$/,
  /^private_key$/,
  // Зашифрованные ключи (AI, ТЗ §3.9): api_key_encrypted и подобные.
  /_encrypted$/,
];

export function isSecretColumn(column: string): boolean {
  return SECRET_COLUMN_PATTERNS.some((pattern) => pattern.test(column));
}

/** Множество таблиц с user_id, покрытых реестром: выгрузка плюс исключения. */
export function coveredUserTables(): Set<string> {
  const covered = new Set(EXCLUDED_USER_TABLES.map((entry) => entry.table));
  for (const entry of EXPORT_TABLES) {
    if (entry.keyColumn === 'user_id') covered.add(entry.table);
  }
  return covered;
}

/** Таблицы с user_id, которых нет ни в выгрузке, ни в исключениях. */
export function uncoveredUserTables(tables: readonly string[]): string[] {
  const covered = coveredUserTables();
  return tables.filter((table) => !covered.has(table));
}

/** Минимальный контракт Prisma-клиента, нужный реестру (удобно для unit-тестов). */
export interface RawQueryable {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/** Все таблицы текущей схемы, у которых есть колонка user_id. */
export async function listUserTables(db: RawQueryable): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = current_schema()
        AND c.column_name = 'user_id'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  return rows.map((row) => row.table_name);
}

/** Колонки таблицы в порядке объявления (для стабильных заголовков CSV). */
export async function listTableColumns(db: RawQueryable, table: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
    table,
  );
  return rows.map((row) => row.column_name);
}
