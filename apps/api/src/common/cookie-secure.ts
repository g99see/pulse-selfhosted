// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Нужно ли ставить флаг Secure на cookie (ТЗ §6).
 *
 * Порядок: явный COOKIE_SECURE (true/false/1/0) → схема WEB_APP_URL/PUBLIC_ORIGIN
 * (https → true, http → false) → NODE_ENV === 'production'.
 * Схема нужна для установки по обычному http в локальной сети: браузер молча
 * отбрасывает Secure-cookie с http-страницы, и войти было бы невозможно.
 */
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
