// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Нужно ли ставить флаг Secure на cookie (ТЗ §6).
 *
 * Порядок: явный COOKIE_SECURE (true/false/1/0) → схема WEB_APP_URL/PUBLIC_ORIGIN
 * (https → true, http → false) → NODE_ENV === 'production'.
 * COOKIE_SECURE=auto — флаг решается по каждому запросу (см. requestIsHttps):
 * здесь для auto берётся обычная схема-вывод, а middleware перекрывает её.
 * Схема нужна для установки по обычному http в локальной сети: браузер молча
 * отбрасывает Secure-cookie с http-страницы, и войти было бы невозможно.
 */
export function isCookieSecureAuto(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COOKIE_SECURE?.trim().toLowerCase() === 'auto';
}

/**
 * Пришёл ли запрос по https (для COOKIE_SECURE=auto). Доверяем только
 * X-Forwarded-Proto: его выставляет наш Caddy (listeners :8081/:8082 принудительно
 * `https`, а :80 перезаписывает значением реальной схемы).
 */
export function requestIsHttps(headers: Record<string, string | string[] | undefined>): boolean {
  const raw = headers['x-forwarded-proto'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.split(',')[0]?.trim().toLowerCase() === 'https';
}

export function cookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.COOKIE_SECURE?.trim().toLowerCase();
  if (explicit) {
    if (['true', '1', 'yes', 'on'].includes(explicit)) return true;
    if (['false', '0', 'no', 'off'].includes(explicit)) return false;
  }

  for (const raw of [env.WEB_APP_URL, env.PUBLIC_ORIGIN]) {
    const value = raw?.trim().toLowerCase();
    if (!value) continue;
    if (value.startsWith('https://')) return true;
    if (value.startsWith('http://')) return false;
  }

  return env.NODE_ENV === 'production';
}
