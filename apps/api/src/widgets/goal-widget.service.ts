// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import {
  canViewProfile,
  goalProgress,
  reachedMilestones,
  type GoalWidgetDto,
  type ProfileVisibility,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Публичный виджет цели (ТЗ §4, P3): прогресс-бар для блога или портфолио.
 * Отдаётся анонимно и только для цели с visibility=public, владелец которой
 * тоже открыл профиль. Суммы не публикуются — только проценты и вехи.
 */
@Injectable()
export class GoalWidgetService {
  constructor(private readonly prisma: PrismaService) {}

  /** Виджет цели либо 404 (не раскрываем существование закрытой цели). */
  async get(goalId: string, from: Date = new Date()): Promise<GoalWidgetDto> {
    const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) {
      throw httpError(404, 'goal_not_found', 'Цель не найдена');
    }

    const owner = await this.prisma.user.findUnique({ where: { id: goal.userId } });
    if (!owner) {
      throw httpError(404, 'goal_not_found', 'Цель не найдена');
    }

    // Виджет публичен, только если публичны и цель, и профиль владельца:
    // анонимный смотрящий видит лишь уровень public (ТЗ §3.7).
    const profileOpen = canViewProfile(owner.profileVisibility as ProfileVisibility);
    if (goal.visibility !== 'public' || !profileOpen) {
      throw httpError(404, 'goal_not_found', 'Цель не найдена');
    }

    const percent = goalProgress(Number(goal.savedAmount), Number(goal.targetAmount));
    return {
      id: goal.id,
      title: goal.title,
      percent,
      image: goal.image,
      milestones: reachedMilestones(percent),
      deadline: goal.deadline ? goal.deadline.toISOString() : null,
      nickname: owner.nickname,
    };
  }
}
