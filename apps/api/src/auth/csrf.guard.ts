// SPDX-License-Identifier: AGPL-3.0-or-later
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { httpError } from '../common/http-error';
import { CSRF_COOKIE, CSRF_HEADER } from './cookies';
import { constantTimeEqual } from './tokens';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Пути со своей проверкой подлинности вместо CSRF-cookie: вебхук Telegram
 * приходит от сервера Telegram и защищён заголовком X-Telegram-Bot-Api-Secret-Token.
 */
const CSRF_EXEMPT_PATHS = new Set(['/api/telegram/webhook']);

/**
 * Защита от CSRF для cookie-аутентификации (ТЗ §6), схема double-submit:
 * значение cookie puls_csrf должно совпасть с заголовком X-CSRF-Token.
 * Сторонний сайт cookie прочитать не может, поэтому подделать заголовок не выйдет.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    if (CSRF_EXEMPT_PATHS.has(request.path.replace(/\/+$/, ''))) return true;

    // Bearer-токен открытого API (ТЗ §4) не опирается на cookie, поэтому CSRF
    // к нему неприменим: запрос аутентифицируется самим токеном, а не сессией.
    const authorization = request.headers['authorization'];
    const authValue = Array.isArray(authorization) ? authorization[0] : authorization;
    if (authValue && /^Bearer\s+/i.test(authValue)) return true;

    const cookie = request.cookies?.[CSRF_COOKIE] as string | undefined;
    const header = request.headers[CSRF_HEADER];
    const headerValue = Array.isArray(header) ? header[0] : header;

    if (!cookie || !headerValue || !constantTimeEqual(cookie, headerValue)) {
      throw httpError(403, 'csrf_failed', 'Недействительный CSRF-токен: обновите страницу');
    }

    return true;
  }
}
