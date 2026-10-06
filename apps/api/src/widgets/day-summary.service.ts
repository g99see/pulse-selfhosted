// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DAY_SUMMARY_TOKEN_PATTERN,
  type DaySummaryLinkCreatedDto,
  type DaySummaryLinkDto,
  type DaySummaryPublicDto,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { StatsService } from '../stats/stats.service';

/** SHA-256 токена: в БД лежит только хеш, поэтому утечка базы не раскрывает ссылки. */
export function hashDayToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Приватная ссылка «Итог дня» (ТЗ v2 §7): секретный токен в URL `/d/<токен>`
 * открывает итоги сегодняшнего дня без входа. Одна ссылка на пользователя;
 * повторное создание заменяет токен (старая ссылка перестаёт работать),
 * отзыв удаляет её. Показываются только суммы, настроение и число чек-инов.
 */
@Injectable()
export class DaySummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsService,
  ) {}

  async status(userId: string): Promise<DaySummaryLinkDto> {
    const link = await this.prisma.daySummaryLink.findUnique({ where: { userId } });
    return { active: link !== null, createdAt: link?.createdAt.toISOString() ?? null };
  }

  /** Создаёт ссылку или перевыпускает токен; сам токен возвращается один раз. */
  async create(userId: string): Promise<DaySummaryLinkCreatedDto> {
    const token = randomBytes(32).toString('base64url');
    const link = await this.prisma.daySummaryLink.upsert({
      where: { userId },
      create: { userId, tokenHash: hashDayToken(token) },
      update: { tokenHash: hashDayToken(token), createdAt: new Date() },
    });
    return {
      active: true,
      createdAt: link.createdAt.toISOString(),
      token,
      path: `/d/${token}`,
    };
  }

  async revoke(userId: string): Promise<void> {
    await this.prisma.daySummaryLink.deleteMany({ where: { userId } });
  }

  /** Итоги сегодняшнего дня владельца токена либо 404 (без различия причин). */
  async publicSummary(token: string): Promise<DaySummaryPublicDto> {
    const notFound = () => httpError(404, 'day_summary_not_found', 'Ссылка недействительна');
    if (!DAY_SUMMARY_TOKEN_PATTERN.test(token)) throw notFound();

    const link = await this.prisma.daySummaryLink.findUnique({
      where: { tokenHash: hashDayToken(token) },
      include: { user: { select: { nickname: true } } },
    });
    if (!link) throw notFound();

    const day = await this.stats.day(link.userId);
    return {
      day: day.day,
      currency: day.currency,
      spent: day.spent,
      earned: day.earned,
      avgMood: day.avgMood,
      checkins: day.checkins,
      nickname: link.user.nickname,
    };
  }
}
