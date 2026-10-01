// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты реестра таблиц: ни одна таблица с user_id не должна остаться без
// записи в выгрузке или в явном списке исключений (ТЗ §3.1, §6).
import { describe, expect, it } from 'vitest';
import {
  EXCLUDED_USER_TABLES,
  EXPORT_TABLES,
  coveredUserTables,
  isSecretColumn,
  uncoveredUserTables,
} from './data-registry';

describe('isSecretColumn', () => {
  it('распознаёт пароли, хеши токенов и ключи', () => {
    expect(isSecretColumn('password_hash')).toBe(true);
    expect(isSecretColumn('token_hash')).toBe(true);
    expect(isSecretColumn('code_hash')).toBe(true);
    expect(isSecretColumn('two_fa_secret')).toBe(true);
    expect(isSecretColumn('p256dh')).toBe(true);
    expect(isSecretColumn('auth')).toBe(true);
    expect(isSecretColumn('api_key_encrypted')).toBe(true);
  });

  it('не трогает обычные поля', () => {
    expect(isSecretColumn('name')).toBe(false);
    expect(isSecretColumn('email')).toBe(false);
    expect(isSecretColumn('created_at')).toBe(false);
    expect(isSecretColumn('amount')).toBe(false);
    expect(isSecretColumn('is_system')).toBe(false);
  });
});

describe('реестр выгрузки', () => {
  it('таблицы-владельцы покрыты: выгрузка либо явное исключение', () => {
    expect(
      uncoveredUserTables(['accounts', 'sessions', 'check_ins', 'budgets', 'daily_stats']),
    ).toEqual([]);
    expect(uncoveredUserTables(['accounts', 'daily_stat'])).toEqual(['daily_stat']);
    expect(uncoveredUserTables([])).toEqual([]);
    // Telegram: привязка выгружается, одноразовые коды — секрет и исключены.
    expect(uncoveredUserTables(['telegram_links', 'telegram_link_codes'])).toEqual([]);
  });

  it('Telegram: привязка в выгрузке, коды привязки исключены как секрет', () => {
    const links = EXPORT_TABLES.find((entry) => entry.table === 'telegram_links');
    expect(links?.entity).toBe('telegramLinks');
    expect(links?.keyColumn).toBe('user_id');

    const codes = EXCLUDED_USER_TABLES.find((entry) => entry.table === 'telegram_link_codes');
    expect(codes).toBeDefined();
    expect(codes?.reason.length).toBeGreaterThan(0);
    expect(coveredUserTables().has('telegram_links')).toBe(true);
    expect(coveredUserTables().has('telegram_link_codes')).toBe(true);
  });

  it('сессии, токены подтверждения и push-подписки исключены из выгрузки', () => {
    const excluded = EXCLUDED_USER_TABLES.map((entry) => entry.table);
    expect(excluded).toEqual(
      expect.arrayContaining([
        'sessions',
        'email_verification_tokens',
        'push_subscriptions',
        'two_factor_backup_codes',
        'two_factor_challenges',
      ]),
    );
    for (const entry of EXCLUDED_USER_TABLES) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('2FA: резервные коды и пропуски исключены как секреты, секрет на users скрыт', () => {
    expect(uncoveredUserTables(['two_factor_backup_codes', 'two_factor_challenges'])).toEqual([]);
    expect(coveredUserTables().has('two_factor_backup_codes')).toBe(true);
    expect(coveredUserTables().has('two_factor_challenges')).toBe(true);

    const users = EXPORT_TABLES.find((entry) => entry.table === 'users');
    expect(users?.secretColumns).toContain('two_fa_secret');
  });

  it('coveredUserTables перечисляет выгрузку и исключения', () => {
    const covered = coveredUserTables();
    expect(covered.has('accounts')).toBe(true);
    expect(covered.has('push_subscriptions')).toBe(true);
    expect(covered.has('daily_stats')).toBe(true);
  });

  it('таблица пользователя описана колонкой id, остальные — user_id', () => {
    const users = EXPORT_TABLES.find((entry) => entry.table === 'users');
    expect(users?.keyColumn).toBe('id');
    for (const entry of EXPORT_TABLES.filter((item) => item.table !== 'users')) {
      expect(entry.keyColumn).toBe('user_id');
    }
  });

  it('нет дублей таблиц и сущностей', () => {
    const tables = EXPORT_TABLES.map((entry) => entry.table);
    const entities = EXPORT_TABLES.map((entry) => entry.entity);
    expect(new Set(tables).size).toBe(tables.length);
    expect(new Set(entities).size).toBe(entities.length);
  });

  it('секретные колонки не названы в реестре как обычные', () => {
    for (const entry of EXPORT_TABLES) {
      for (const column of entry.secretColumns ?? []) {
        expect(isSecretColumn(column)).toBe(true);
      }
    }
  });
});
