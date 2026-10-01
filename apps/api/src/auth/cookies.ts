// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CookieOptions } from 'express';
import { cookieSecure } from '../common/cookie-secure';

export const SESSION_COOKIE = 'puls_session';
export const CSRF_COOKIE = 'puls_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);
export const EMAIL_VERIFY_TTL_HOURS = Number(process.env.EMAIL_VERIFY_TTL_HOURS ?? 24);

/** Secure только когда сайт открывается по HTTPS (см. common/cookie-secure.ts). */
function secure(): boolean {
  return cookieSecure();
}

/** httpOnly-сессия (ТЗ §6): JS её не читает. */
export function sessionCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    path: '/',
    expires: expiresAt,
  };
}

/** CSRF-токен по схеме double-submit: читается клиентом, сверяется с заголовком. */
export function csrfCookieOptions(): CookieOptions {
  return {
    httpOnly: false,
    sameSite: 'lax',
    secure: secure(),
    path: '/',
  };
}

export function clearCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    path: '/',
  };
}
