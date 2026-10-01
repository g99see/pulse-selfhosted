// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import type { ModerationAction as PrismaAction, Report, ReportTargetType } from '@prisma/client';
import type {
  ModerationActionDto,
  ModerationResolveInput,
  ModerationResolveResponse,
  ReportCreateInput,
  ReportDto,
  ReportStatus,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { RateLimitService } from '../auth/rate-limit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Сколько жалоб один пользователь может прислать за окно (ТЗ §3.7). */
export const REPORT_LIMIT = 10;
/** Окно ограничения частоты жалоб, секунды. */
export const REPORT_WINDOW_SECONDS = 60 * 60;
/** Сколько жалоб отдаём в очереди модерации за раз. */
export const REPORTS_PAGE_SIZE = 200;

const REPORTER_SELECT = { select: { id: true, nickname: true } } as const;

type ReportWithReporter = Report & { reporter: { id: string; nickname: string } };
type ActionWithModerator = PrismaAction & { moderator: { id: string; nickname: string } };

/**
 * Жалобы и модерация (ТЗ §3.7, §3.8, §2): приём жалоб от пользователей,
 * очередь модерации, решения модераторов и флаги скрытия контента.
 *
 * Другие модули (профиль, лента, HTML-страница) спрашивают `isHidden()` и
 * прячут помеченные цели, не зная деталей модерации.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Скрыта ли цель модератором (ТЗ §3.8). Единая точка для профиля, ленты и
   * HTML-страницы. Неизвестная цель считается видимой.
   */
  async isHidden(targetType: ReportTargetType, targetId: string): Promise<boolean> {
    const flag = await this.prisma.contentFlag.findUnique({
      where: { targetType_targetId: { targetType, targetId } },
    });
    return flag?.hidden ?? false;
  }

  /** Пожаловаться на профиль или контент (ТЗ §3.7): любой вошедший. */
  async createReport(reporterId: string, input: ReportCreateInput): Promise<ReportDto> {
    // На свой профиль жаловаться нельзя — это спам-самореклама и бессмыслица.
    if (input.targetType === 'profile' && input.targetId === reporterId) {
      throw httpError(400, 'report_self', 'Нельзя пожаловаться на собственный профиль');
    }

    const limit = await this.rateLimit.consume(
      `report:user:${reporterId}`,
      REPORT_LIMIT,
      REPORT_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      throw httpError(429, 'rate_limited', 'Слишком много жалоб — попробуйте позже', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    // Дубль от того же автора на ту же цель блокируем, пока жалоба не отклонена.
    const duplicate = await this.prisma.report.findFirst({
      where: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        status: { not: 'dismissed' },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw httpError(409, 'report_duplicate', 'Вы уже жаловались на эту цель');
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        details: input.details ?? null,
      },
      include: { reporter: REPORTER_SELECT },
    });

    return this.toReportDto(report);
  }

  /** Очередь жалоб для модератора (ТЗ §3.8), свежие сверху. */
  async listReports(status?: ReportStatus): Promise<ReportDto[]> {
    const reports = await this.prisma.report.findMany({
      where: status ? { status } : undefined,
      include: { reporter: REPORTER_SELECT },
      orderBy: { createdAt: 'desc' },
      take: REPORTS_PAGE_SIZE,
    });
    return reports.map((report) => this.toReportDto(report));
  }

  /** Журнал действий модерации (ТЗ §2), свежие сверху. */
  async listActions(): Promise<ModerationActionDto[]> {
    const actions = await this.prisma.moderationAction.findMany({
      include: { moderator: REPORTER_SELECT },
      orderBy: { createdAt: 'desc' },
      take: REPORTS_PAGE_SIZE,
    });
    return actions.map((action) => this.toActionDto(action));
  }

  /**
   * Решение модератора по жалобе (ТЗ §3.8): скрыть/показать цель, заблокировать
   * или разблокировать HTML-страницу, отклонить жалобу. Каждое решение пишется
   * в журнал модерации одной транзакцией с самой жалобой.
   */
  async resolveReport(
    moderatorId: string,
    reportId: string,
    input: ModerationResolveInput,
  ): Promise<ModerationResolveResponse> {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) {
      throw httpError(404, 'report_not_found', 'Жалоба не найдена');
    }
    if (report.status !== 'open') {
      throw httpError(409, 'report_closed', 'Жалоба уже рассмотрена');
    }

    const dismissed = input.action === 'dismiss';
    // hide/ban_html скрывают цель, unhide/unban_html возвращают её в выдачу;
    // dismiss флаг не трогает — жалобу просто отклоняют.
    const hiddenByAction = input.action === 'hide' || input.action === 'ban_html';
    const visibleByAction = input.action === 'unhide' || input.action === 'unban_html';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({
        where: { id: reportId },
        data: {
          status: dismissed ? 'dismissed' : 'resolved',
          resolvedBy: moderatorId,
          resolution: input.note ?? null,
        },
        include: { reporter: REPORTER_SELECT },
      });

      if (hiddenByAction || visibleByAction) {
        await tx.contentFlag.upsert({
          where: {
            targetType_targetId: {
              targetType: report.targetType,
              targetId: report.targetId,
            },
          },
          create: {
            targetType: report.targetType,
            targetId: report.targetId,
            hidden: hiddenByAction,
          },
          update: { hidden: hiddenByAction },
        });
      }

      const action = await tx.moderationAction.create({
        data: {
          moderatorId,
          action: input.action,
          targetType: report.targetType,
          targetId: report.targetId,
          note: input.note ?? null,
        },
        include: { moderator: REPORTER_SELECT },
      });

      return { report: this.toReportDto(updated), action: this.toActionDto(action) };
    });
  }

  private toReportDto(report: ReportWithReporter): ReportDto {
    return {
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      details: report.details,
      status: report.status,
      resolution: report.resolution,
      resolvedBy: report.resolvedBy,
      createdAt: report.createdAt.toISOString(),
      reporter: { id: report.reporter.id, nickname: report.reporter.nickname },
    };
  }

  private toActionDto(action: ActionWithModerator): ModerationActionDto {
    return {
      id: action.id,
      action: action.action,
      targetType: action.targetType,
      targetId: action.targetId,
      note: action.note,
      createdAt: action.createdAt.toISOString(),
      moderator: { id: action.moderator.id, nickname: action.moderator.nickname },
    };
  }
}
