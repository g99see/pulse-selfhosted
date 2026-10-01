// SPDX-License-Identifier: AGPL-3.0-or-later
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { httpError } from '../common/http-error';
import { SESSION_COOKIE } from './cookies';
import { SessionService } from './session.service';
import type { AuthenticatedRequest } from './auth.types';

/** Требует активную серверную сессию (ТЗ §6). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[SESSION_COOKIE] as string | undefined;

    if (!token) {
      throw httpError(401, 'unauthorized', 'Требуется вход');
    }

    const resolved = await this.sessions.resolve(token);
    if (!resolved) {
      throw httpError(401, 'unauthorized', 'Сессия истекла или отозвана');
    }

    request.user = resolved.user;
    request.session = resolved.session;
    return true;
  }
}
