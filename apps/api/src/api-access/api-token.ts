// SPDX-License-Identifier: AGPL-3.0-or-later
/** Генерация и отображение личных токенов доступа (ТЗ §4). */
import { randomBytes } from 'node:crypto';
import { API_TOKEN_PREFIX } from '@puls/shared';

/**
 * 32 случайных байта в URL-safe base64 (43 символа) с префиксом `puls_`.
 * Полное значение показывается пользователю ровно один раз при создании.
 */
export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Префикс для списка: `puls_xxxxxxxx…` — не раскрывает токен. */
export function apiTokenPrefix(token: string): string {
  return token.slice(0, 12);
}
