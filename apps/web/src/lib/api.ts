// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Адрес API для браузера (ТЗ §7). `/` или пусто = тот же origin, что и сайт
 * (запросы идут на `/api/...`): так один стенд работает по нескольким адресам
 * (LAN по http и Tailscale по https). Не задан вовсе — dev-адрес localhost:3001.
 * Только для браузера: на сервере Next относительный адрес не работает —
 * там используйте SERVER_API_URL.
 */
export function normalizeApiBase(raw: string | undefined): string {
  return (raw ?? 'http://localhost:3001').trim().replace(/\/+$/, '');
}

export const API_BASE_URL = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL);

/**
 * Адрес API для запросов с сервера Next (серверный guard кабинета).
 * В контейнере это внутренний адрес сервиса api, а не браузерный.
 */
export const SERVER_API_URL =
  process.env.API_INTERNAL_URL ?? (API_BASE_URL || 'http://localhost:3001');

export function healthUrl(): string {
  return `${SERVER_API_URL.replace(/\/+$/, '')}/health`;
}
