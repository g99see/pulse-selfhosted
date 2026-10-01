// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Локаль интерфейса (ТЗ §6: «русский и английский на старте, архитектура i18n
 * для добавления языков»).
 *
 * Чистые функции выбора локали: cookie пользователя → локаль профиля →
 * заголовок Accept-Language → русский по умолчанию. Словарь строк живёт
 * в src/lib/i18n.ts, React-провайдер — в components/locale-provider.tsx.
 */
import type { Locale } from '@puls/shared';
import { DEFAULT_LOCALE } from './i18n';

/** Cookie с выбранным языком: доступен серверу на первом кадре. */
export const LOCALE_COOKIE = 'puls_locale';

/** Названия языков пишутся на самих языках — это не переводимые строки. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
};

/** Тег BCP-47 для Intl.DateTimeFormat / Intl.NumberFormat. */
const BCP47: Record<Locale, string> = {
  ru: 'ru-RU',
  en: 'en-US',
};

export function isLocale(value: unknown): value is Locale {
  return value === 'ru' || value === 'en';
}

/** Приводит произвольное значение (cookie, localStorage) к поддерживаемой локали. */
export function parseLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function localeToBcp47(locale: Locale): string {
  return BCP47[locale];
}

/** Cookie с выбранным языком: год жизни, доступен серверу на первом кадре. */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** Первая поддерживаемая локаль из Accept-Language с учётом весов q. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const entries = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      let quality = 1;
      for (const param of params) {
        const match = /^\s*q\s*=\s*([0-9.]+)/i.exec(param);
        if (match) quality = Number(match[1]);
      }
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag.length > 0 && entry.tag !== '*')
    .sort((a, b) => b.quality - a.quality);

  for (const entry of entries) {
    const primary = entry.tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }

  return null;
}

/** Локаль из строки `document.cookie`; null, если cookie нет или он испорчен. */
export function localeFromCookieString(cookieString: string): Locale | null {
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`).exec(cookieString);
  const value = match?.[1]?.trim();
  return value !== undefined && isLocale(value) ? value : null;
}

/** Приоритет: cookie → локаль профиля → Accept-Language → ru. */
export function resolveLocale(options: {
  cookie?: unknown;
  acceptLanguage?: string | null | undefined;
  userLocale?: unknown;
}): Locale {
  if (isLocale(options.cookie)) return options.cookie;
  if (isLocale(options.userLocale)) return options.userLocale;
  return localeFromAcceptLanguage(options.acceptLanguage) ?? DEFAULT_LOCALE;
}
