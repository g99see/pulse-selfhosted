// SPDX-License-Identifier: AGPL-3.0-or-later
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { httpError } from '../common/http-error';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ROLES_KEY } from './roles.decorator';

/**
 * Проверка роли пользователя (ТЗ §2, §9 п.7). Читает метадату `@Roles(...)`.
 * Обязательно идёт после SessionGuard: роль берётся из `request.user`, который
 * заполняет SessionGuard. Без `@Roles` пропускает запрос.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;

    if (!role || !required.includes(role)) {
      throw httpError(403, 'forbidden', 'Недостаточно прав');
    }

    return true;
  }
}
