// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import type { Session, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_TTL_DAYS } from './cookies';
import { generateToken, hashToken } from './tokens';

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/** Серверные сессии в БД (ТЗ §6): в базе только хеш токена. */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    context: SessionContext = {},
  ): Promise<{ token: string; session: Session }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        userAgent: context.userAgent?.slice(0, 255),
        ip: context.ip?.slice(0, 64),
        expiresAt,
      },
    });

    return { token, session };
  }

  /** Возвращает активную сессию вместе с пользователем либо null. */
  async resolve(token: string): Promise<{ session: Session; user: User } | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      void this.prisma.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }

    return { session, user: session.user };
  }

  async list(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      current: session.id === currentSessionId,
      userAgent: session.userAgent,
      ip: session.ip,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    }));
  }

  /** Отзывает сессию, только если она принадлежит пользователю. */
  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }
}
