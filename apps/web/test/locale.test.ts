// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  LOCALE_COOKIE,
  LOCALE_NAMES,
  isLocale,
  localeCookie,
  localeFromAcceptLanguage,
  localeFromCookieString,
  localeToBcp47,
  parseLocale,
  resolveLocale,
} from '../src/lib/locale';

describe('локаль: чистая логика', () => {
  it('поддерживает ru и en, по умолчанию ru', () => {
    expect(LOCALE_NAMES).toEqual({ ru: 'Русский', en: 'English' });
    expect(parseLocale(undefined)).toBe('ru');
    expect(parseLocale('de')).toBe('ru');
    expect(isLocale('en')).toBe(true);
    expect(isLocale('EN')).toBe(false);
  });

  it('называет cookie локали', () => {
    expect(LOCALE_COOKIE).toBe('puls_locale');
    expect(localeCookie('en')).toContain('puls_locale=en');
    expect(localeCookie('en')).toContain('Path=/');
  });

  it('переводит локаль в BCP-47 для Intl', () => {
    expect(localeToBcp47('ru')).toBe('ru-RU');
    expect(localeToBcp47('en')).toBe('en-US');
  });

  it('разбирает Accept-Language с весами q', () => {
    expect(localeFromAcceptLanguage('ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('ru');
    expect(localeFromAcceptLanguage('en-US,en;q=0.9,ru;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('ru;q=0.5, en;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9')).toBeNull();
    expect(localeFromAcceptLanguage('')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
    expect(localeFromAcceptLanguage('*')).toBeNull();
  });

  it('ставит cookie пользователя выше заголовка и профиля', () => {
    expect(
      resolveLocale({ cookie: 'en', acceptLanguage: 'ru-RU,ru;q=0.9', userLocale: 'ru' }),
    ).toBe('en');
  });

  it('использует locale профиля, если cookie нет или он испорчен', () => {
    expect(resolveLocale({ acceptLanguage: 'ru-RU', userLocale: 'en' })).toBe('en');
    expect(resolveLocale({ cookie: 'klingon', acceptLanguage: 'ru-RU' })).toBe('ru');
  });

  it('определяет локаль из Accept-Language, когда выбора нет', () => {
    expect(resolveLocale({ acceptLanguage: 'en-GB,en;q=0.9' })).toBe('en');
    expect(resolveLocale({})).toBe('ru');
  });

  it('читает локаль из строки cookie браузера', () => {
    expect(localeFromCookieString('puls_locale=en; other=1')).toBe('en');
    expect(localeFromCookieString('a=1; puls_locale=ru')).toBe('ru');
    expect(localeFromCookieString('puls_locale=de')).toBeNull();
    expect(localeFromCookieString('')).toBeNull();
  });
});
