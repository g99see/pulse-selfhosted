// SPDX-License-Identifier: AGPL-3.0-or-later
import { cookies, headers } from 'next/headers';
import type { Locale } from '@puls/shared';
import { LOCALE_COOKIE, resolveLocale } from './locale';

/**
 * Локаль текущего запроса для серверных компонентов (ТЗ §6): cookie выбора →
 * Accept-Language → ru. Используется в корневом layout, metadata и лендинге.
 */
export async function getRequestLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  return resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });
}
