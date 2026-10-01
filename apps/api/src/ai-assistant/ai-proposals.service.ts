// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Предложения AI-помощника «Применить» (ТЗ §3.9).
 *
 * Модель может только предложить бюджет, цель или напоминание — строка
 * сохраняется как pending и ни на что не влияет. Реальную сущность создаёт
 * пользователь кнопкой «Применить»: payload валидируется Zod-схемой, а
 * создание идёт через существующие сервисы (финансы, цели, уведомления),
 * логика не дублируется. Повторное применение идемпотентно.
 */
import { Injectable } from '@nestjs/common';
import type { AiProposal } from '@prisma/client';
import {
  AiBudgetProposalPayloadSchema,
  AiGoalProposalPayloadSchema,
  AiReminderProposalPayloadSchema,
  type AiProposalApplyResponse,
  type AiProposalDto,
  type AiProposalKind,
  type AiProposalStatus,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetsService } from '../finance/budgets.service';
import { GoalsService } from '../goals/goals.service';
import { NotificationsService } from '../notifications/notifications.service';

export function toAiProposalDto(row: AiProposal): AiProposalDto {
  return {
    id: row.id,
    kind: row.kind as AiProposalKind,
    summary: row.summary,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as AiProposalStatus,
  };
}

@Injectable()
export class AiProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: BudgetsService,
    private readonly goals: GoalsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Сохраняет предложение модели как pending (без побочных эффектов). */
  async create(input: {
    userId: string;
    kind: AiProposalKind;
    summary: string;
    payload: Record<string, unknown>;
  }): Promise<AiProposalDto> {
    const row = await this.prisma.aiProposal.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        summary: input.summary,
        payload: input.payload as object,
      },
    });
    return toAiProposalDto(row);
  }

  /**
   * Применяет предложение: проверяет владельца, валидирует payload Zod-схемой
   * по виду и создаёт сущность через её сервис. Повторный вызов возвращает
   * прежний результат (идемпотентно). Побочных эффектов до валидации нет.
   */
  async apply(userId: string, id: string): Promise<AiProposalApplyResponse> {
    const proposal = await this.prisma.aiProposal.findFirst({ where: { id, userId } });
    if (!proposal) throw httpError(404, 'ai_proposal_not_found', 'Предложение не найдено');

    if (proposal.status === 'applied' && proposal.result) {
      const stored = proposal.result as { kind: AiProposalKind; id: string };
      return { proposal: toAiProposalDto(proposal), applied: stored };
    }

    const applied = await this.createFromPayload(
      userId,
      proposal.kind as AiProposalKind,
      proposal.payload,
    );
    const updated = await this.prisma.aiProposal.update({
      where: { id: proposal.id },
      data: { status: 'applied', appliedAt: new Date(), result: applied as object },
    });
    return { proposal: toAiProposalDto(updated), applied };
  }

  private async createFromPayload(
    userId: string,
    kind: AiProposalKind,
    payload: unknown,
  ): Promise<{ kind: AiProposalKind; id: string }> {
    if (kind === 'budget') {
      const parsed = AiBudgetProposalPayloadSchema.safeParse(payload);
      if (!parsed.success)
        throw httpError(400, 'ai_proposal_invalid_payload', 'Некорректные параметры бюджета');
      const budget = await this.budgets.upsert(userId, {
        categoryId: parsed.data.categoryId,
        month: parsed.data.month,
        limit: parsed.data.limit,
      });
      return { kind, id: budget.id };
    }

    if (kind === 'goal') {
      const parsed = AiGoalProposalPayloadSchema.safeParse(payload);
      if (!parsed.success)
        throw httpError(400, 'ai_proposal_invalid_payload', 'Некорректные параметры цели');
      const goal = await this.goals.create(userId, {
        title: parsed.data.title,
        targetAmount: parsed.data.targetAmount,
        savedAmount: parsed.data.savedAmount ?? 0,
        visibility: parsed.data.visibility ?? 'private',
        ...(parsed.data.deadline ? { deadline: parsed.data.deadline } : {}),
      });
      return { kind, id: goal.id };
    }

    const parsed = AiReminderProposalPayloadSchema.safeParse(payload);
    if (!parsed.success)
      throw httpError(400, 'ai_proposal_invalid_payload', 'Некорректные параметры напоминания');
    await this.notifications.updateRules(userId, [
      {
        type: parsed.data.notificationType,
        enabled: parsed.data.enabled ?? true,
        ...(parsed.data.times ? { times: parsed.data.times } : {}),
      },
    ]);
    return { kind, id: parsed.data.notificationType };
  }
}
