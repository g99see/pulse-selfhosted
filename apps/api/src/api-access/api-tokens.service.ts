// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import type { ApiToken } from '@prisma/client';
import type { ApiScope, ApiTokenCreatedDto, ApiTokenDto, ApiTokensResponse } from '@puls/shared';
import { httpError } from '../common/http-error';
import { hashToken } from '../auth/tokens';
import { PrismaService } from '../prisma/prisma.service';
import { apiTokenPrefix, generateApiToken } from './api-token';

/** Личные токены доступа к открытому API (ТЗ §4): в БД только хэш. */
@Injectable()
export class ApiTokensService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(record: ApiToken): ApiTokenDto {
    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      scopes: record.scopes as ApiScope[],
      lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
      expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
      revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async list(userId: string): Promise<ApiTokensResponse> {
    const tokens = await this.prisma.apiToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { tokens: tokens.map((token) => this.toDto(token)) };
  }

  /** Создаёт токен и возвращает его полное значение ровно один раз. */
  async create(
    userId: string,
    input: { name: string; scopes: ApiScope[]; expiresAt?: string | null },
  ): Promise<ApiTokenCreatedDto> {
    const token = generateApiToken();
    const scopes = [...new Set(input.scopes)] as ApiScope[];

    const record = await this.prisma.apiToken.create({
      data: {
        userId,
        name: input.name,
        tokenHash: hashToken(token),
        prefix: apiTokenPrefix(token),
        scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });

    return { ...this.toDto(record), token };
  }

  /** Отзыв токена: помечает revoked_at, только для владельца. */
  async revoke(userId: string, id: string): Promise<void> {
    const result = await this.prisma.apiToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw httpError(404, 'token_not_found', 'Токен не найден');
    }
  }
}
