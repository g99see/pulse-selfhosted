// SPDX-License-Identifier: AGPL-3.0-or-later
/** Адрес API (ТЗ §7): web-контейнер общается с api по внутренней сети. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Адрес API для запросов с сервера Next (серверный guard кабинета).
 * В контейнере это внутренний адрес сервиса api, а не браузерный.
 */
export const SERVER_API_URL = process.env.API_INTERNAL_URL ?? API_BASE_URL;

export function healthUrl(): string {
  return `${API_BASE_URL.replace(/\/+$/, '')}/health`;
}
