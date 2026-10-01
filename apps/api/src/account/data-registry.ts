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
  { table: 'users', entity: 'user', keyColumn: 'id', secretColumns: ['two_fa_secret'] },
  { table: 'accounts', entity: 'accounts', keyColumn: 'user_id', orderBy: '"created_at"' },
  { table: 'categories', entity: 'categories', keyColumn: 'user_id', orderBy: '"created_at"' },
  { table: 'transactions', entity: 'transactions', keyColumn: 'user_id', orderBy: '"date", "created_at"' },
  { table: 'budgets', entity: 'budgets', keyColumn: 'user_id', orderBy: '"month"' },
  {
    table: 'recurring_payments',
    entity: 'recurringPayments',
    keyColumn: 'user_id',
    orderBy: '"created_at"',
  },
  { table: 'check_ins', entity: 'checkIns', keyColumn: 'user_id', orderBy: '"occurred_at"' },
  { table: 'notification_rules', entity: 'notificationRules', keyColumn: 'user_id', orderBy: '"type"' },
  { table: 'daily_stats', entity: 'dailyStats', keyColumn: 'user_id', orderBy: '"date"' },
  // Курсы валют (ТЗ §3.2): дата, пара и курс — не секреты, выгружаем.
  { table: 'exchange_rates', entity: 'exchangeRates', keyColumn: 'user_id', orderBy: '"date", "base", "quote"' },
  // Внешние привязки входа (ТЗ §3.1, §7): subject не секрет, выгружаем как есть.
  { table: 'external_identities', entity: 'externalIdentities', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Привязка Telegram-чата (ТЗ §3.6): chat_id — идентификатор чата, выгружается как есть.
  { table: 'telegram_links', entity: 'telegramLinks', keyColumn: 'user_id', orderBy: '"linked_at"' },
  // Полученные достижения (ТЗ §4): код бейджа и дата — не секреты, выгружаем.
  { table: 'user_achievements', entity: 'userAchievements', keyColumn: 'user_id', orderBy: '"earned_at"' },
];

/** Таблицы с user_id, которые намеренно не выгружаются (секреты и артефакты). */
export const EXCLUDED_USER_TABLES: readonly { table: string; reason: string }[] = [
  { table: 'sessions', reason: 'секрет: хеш токена серверной сессии' },
  { table: 'email_verification_tokens', reason: 'секрет: одноразовый токен подтверждения email' },
  { table: 'push_subscriptions', reason: 'секрет: endpoint и ключи шифрования web push' },
  { table: 'telegram_link_codes', reason: 'секрет: хеш одноразового кода привязки Telegram' },
  { table: 'two_factor_backup_codes', reason: 'секрет: хеши одноразовых резервных кодов 2FA' },
  { table: 'two_factor_challenges', reason: 'секрет: хеш временного пропуска шага 2FA' },
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
