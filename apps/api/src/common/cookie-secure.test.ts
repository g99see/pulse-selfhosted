// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { cookieSecure, isCookieSecureAuto, requestIsHttps } from './cookie-secure';

const env = (v: Record<string, string>) => v as NodeJS.ProcessEnv;

describe('cookieSecure', () => {
  it('COOKIE_SECURE побеждает всё остальное', () => {
    expect(
      cookieSecure(
        env({ COOKIE_SECURE: 'false', NODE_ENV: 'production', WEB_APP_URL: 'https://a.b' }),
      ),
    ).toBe(false);
    expect(cookieSecure(env({ COOKIE_SECURE: 'true', NODE_ENV: 'development' }))).toBe(true);
    expect(cookieSecure(env({ COOKIE_SECURE: '0', NODE_ENV: 'production' }))).toBe(false);
    expect(cookieSecure(env({ COOKIE_SECURE: '1' }))).toBe(true);
  });

  it('выводится из схемы WEB_APP_URL / PUBLIC_ORIGIN', () => {
    expect(cookieSecure(env({ NODE_ENV: 'production', WEB_APP_URL: 'http://192.168.1.50' }))).toBe(
      false,
    );
    expect(
      cookieSecure(env({ NODE_ENV: 'development', WEB_APP_URL: 'https://puls.example.com' })),
    ).toBe(true);
    expect(
      cookieSecure(env({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://10.0.0.5:8081' })),
    ).toBe(false);
  });

  it('без подсказок — по NODE_ENV', () => {
    expect(cookieSecure(env({ NODE_ENV: 'production' }))).toBe(true);
    expect(cookieSecure(env({ NODE_ENV: 'development' }))).toBe(false);
    expect(cookieSecure(env({}))).toBe(false);
  });

  it('мусор в COOKIE_SECURE игнорируется', () => {
    expect(cookieSecure(env({ COOKIE_SECURE: 'maybe', NODE_ENV: 'production' }))).toBe(true);
  });

  it('auto: распознаётся и не ломает вывод по схеме', () => {
    expect(isCookieSecureAuto(env({ COOKIE_SECURE: 'AUTO' }))).toBe(true);
    expect(isCookieSecureAuto(env({ COOKIE_SECURE: 'true' }))).toBe(false);
    expect(isCookieSecureAuto(env({}))).toBe(false);
    expect(cookieSecure(env({ COOKIE_SECURE: 'auto', PUBLIC_ORIGIN: 'http://10.0.0.5' }))).toBe(
      false,
    );
  });

  it('requestIsHttps читает X-Forwarded-Proto', () => {
    expect(requestIsHttps({ 'x-forwarded-proto': 'https' })).toBe(true);
    expect(requestIsHttps({ 'x-forwarded-proto': 'HTTPS, http' })).toBe(true);
    expect(requestIsHttps({ 'x-forwarded-proto': ['https'] })).toBe(true);
    expect(requestIsHttps({ 'x-forwarded-proto': 'http' })).toBe(false);
    expect(requestIsHttps({})).toBe(false);
  });
});
