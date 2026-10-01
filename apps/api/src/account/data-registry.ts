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
  {
    table: 'transactions',
    entity: 'transactions',
    keyColumn: 'user_id',
    orderBy: '"date", "created_at"',
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
  // Внешние привязки входа (ТЗ §3.1, §7): subject не секрет, выгружаем как есть.
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
  // Полученные достижения (ТЗ §4): код бейджа и дата — не секреты, выгружаем.
  {
    table: 'user_achievements',
    entity: 'userAchievements',
    keyColumn: 'user_id',
    orderBy: '"earned_at"',
  },
  // Инсайты и оценки рекомендаций (ТЗ §3.5): тип, ключ текста и параметры — не секреты.
  { table: 'insights', entity: 'insights', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Публичный профиль (ТЗ §3.7): описание, аватар и обложка — не секреты, выгружаем.
  { table: 'profiles', entity: 'profiles', keyColumn: 'user_id' },
  // Карточки профиля (ТЗ §3.7): тип, приватность, режим и HTML — данные пользователя.
  { table: 'profile_cards', entity: 'profileCards', keyColumn: 'user_id', orderBy: '"position"' },
  // Жалобы, поданные пользователем (ТЗ §3.7): цель, причина и пояснение — его данные.
  { table: 'reports', entity: 'reports', keyColumn: 'user_id', orderBy: '"created_at"' },
  // HTML-страница профиля (ТЗ §3.8): флаг публикации и текущая версия — данные пользователя.
  { table: 'html_pages', entity: 'htmlPages', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Версии HTML-страницы (ТЗ §3.8): код, заметка и результат проверки — его данные.
  {
    table: 'html_page_versions',
    entity: 'htmlPageVersions',
    keyColumn: 'user_id',
    orderBy: '"created_at"',
  },
  // Посты ленты (ТЗ §3.7): тип, payload и приватность — не секреты, выгружаем.
  { table: 'posts', entity: 'posts', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Реакции пользователя (ТЗ §3.7): post_id и эмодзи — его действия, выгружаем.
  { table: 'reactions', entity: 'reactions', keyColumn: 'user_id', orderBy: '"created_at"' },
  // Комментарии пользователя (ТЗ §3.7): тело — собственная запись, выгружаем.
  { table: 'comments', entity: 'comments', keyColumn: 'user_id', orderBy: '"created_at"' },
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
  // Участие в семье (ТЗ §4): семья, роль и дата вступления — данные пользователя.
  {
    table: 'family_members',
    entity: 'familyMembers',
    keyColumn: 'user_id',
    orderBy: '"joined_at"',
  },
  // Операции по семейным счетам (ТЗ §4): вид, сумма и счёт — действия пользователя.
  {
    table: 'family_transactions',
    entity: 'familyTransactions',
    keyColumn: 'user_id',
    orderBy: '"date", "created_at"',
  },
  // Взносы в общие цели семьи (ТЗ §4): сумма и дата — действия пользователя.
  {
    table: 'family_goal_deposits',
    entity: 'familyGoalDeposits',
    keyColumn: 'user_id',
    orderBy: '"date", "created_at"',
  },
  // Участие в челленджах (ТЗ §4, P2): челлендж и дата вступления — данные пользователя.
  {
    table: 'challenge_participants',
    entity: 'challengeParticipants',
    keyColumn: 'user_id',
    orderBy: '"joined_at"',
  },
  // Отметки «держусь» (ТЗ §4, P2): день и флаг — действия пользователя.
  {
    table: 'challenge_checks',
    entity: 'challengeChecks',
    keyColumn: 'user_id',
    orderBy: '"date"',
  },
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
  { table: 'push_subscriptions', reason: 'секрет: endpoint и ключи шифрования web push' },
  { table: 'telegram_link_codes', reason: 'секрет: хеш одноразового кода привязки Telegram' },
  { table: 'two_factor_backup_codes', reason: 'секрет: хеши одноразовых резервных кодов 2FA' },
  { table: 'two_factor_challenges', reason: 'секрет: хеш временного пропуска шага 2FA' },
  // Журнал модерации (ТЗ §2, §3.8): внутренний аудит экземпляра, не данные автора.
  { table: 'moderation_actions', reason: 'внутренний журнал модерации экземпляра' },
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
