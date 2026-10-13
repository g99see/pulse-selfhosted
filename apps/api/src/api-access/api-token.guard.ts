// SPDX-License-Identifier: AGPL-3.0-or-later
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { parseApiToken, type ApiScope } from '@puls/shared';
import { httpError } from '../common/http-error';
import { hashToken } from '../auth/tokens';
import { RateLimitService } from '../auth/rate-limit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from '../auth/auth.types';

/** Метаданные требуемых областей доступа эндпоинта. */
export const API_SCOPES_KEY = 'api-access-scopes';

/** Помечает обработчик обязательными областями токена (ТЗ §4). */
export const RequireApiScopes = (...scopes: ApiScope[]) => SetMetadata(API_SCOPES_KEY, scopes);

const DEFAULT_RATE_LIMIT = Number(process.env.API_TOKEN_RATE_LIMIT ?? 120);
const DEFAULT_RATE_WINDOW = Number(process.env.API_TOKEN_RATE_WINDOW ?? 60);

/**
 * Guard открытого API (ТЗ §4): аутентифицирует по `Authorization: Bearer
 * puls_…`, проверяет срок/отзыв, области доступа и частоту запросов на токен.
 * Cookie и CSRF не участвуют — токен не привязан к браузерной сессии.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    const token = parseApiToken(value);
    if (!token) {
      throw httpError(401, 'unauthorized', 'Требуется заголовок Authorization: Bearer puls_…');
    }

    const record = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (
      !record ||
      record.revokedAt !== null ||
      (record.expiresAt !== null && record.expiresAt.getTime() <= Date.now())
    ) {
      throw httpError(401, 'unauthorized', 'Токен недействителен, отозван или просрочен');
    }

    const required =
      this.reflector.getAllAndOverride<ApiScope[]>(API_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const scopes = record.scopes as ApiScope[];
    // Область write включает чтение: держателю полного токена не нужно
    // отдельно просить read. Область read записи не даёт (403).
    const missing = required.filter((scope) =>
      scope === 'read'
        ? !(scopes.includes('read') || scopes.includes('write'))
        : !scopes.includes(scope),
    );
    if (missing.length > 0) {
      throw httpError(
        403,
        'insufficient_scope',
        `Токену не хватает области: ${missing.join(', ')}`,
      );
    }

    const limit = await this.rateLimit.consume(
      `api-token:${record.id}`,
      DEFAULT_RATE_LIMIT,
      DEFAULT_RATE_WINDOW,
    );
    if (!limit.allowed) {
      throw httpError(429, 'rate_limited', 'Слишком много запросов по токену', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    // Момент последнего использования — информационно, сбой не мешает запросу.
    void this.prisma.apiToken
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    request.user = user;
    request.apiToken = { id: record.id, scopes: record.scopes };
    return true;
  }
}
