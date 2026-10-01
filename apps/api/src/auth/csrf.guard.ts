// SPDX-License-Identifier: AGPL-3.0-or-later
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { httpError } from '../common/http-error';
import { CSRF_COOKIE, CSRF_HEADER } from './cookies';
import { constantTimeEqual } from './tokens';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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

    const cookie = request.cookies?.[CSRF_COOKIE] as string | undefined;
    const header = request.headers[CSRF_HEADER];
    const headerValue = Array.isArray(header) ? header[0] : header;

    if (!cookie || !headerValue || !constantTimeEqual(cookie, headerValue)) {
      throw httpError(403, 'csrf_failed', 'Недействительный CSRF-токен: обновите страницу');
    }

    return true;
  }
}
