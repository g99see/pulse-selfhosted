// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  crossedMilestones,
  forecastGoalDate,
  goalPacePerMonth,
  goalProgress,
  reachedMilestones,
  requiredMonthlyContribution,
  type GoalCreateInput,
  type GoalDepositDto,
  type GoalDepositInput,
  type GoalDepositResult,
  type GoalDto,
  type GoalMilestoneEvent,
  type GoalUpdateInput,
  type GoalVisibility,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { SocialPostsService } from '../social/social-posts.service';
import { DomainEvents } from '../api-access/domain-events';

type GoalWithDeposits = Prisma.GoalGetPayload<{ include: { deposits: true } }>;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Приводит дату к UTC-полуночи (колонка @db.Date), по умолчанию — сегодня. */
function toDateOnly(value?: string | null): Date | null {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

/** Модель → DTO: прогресс, нужный взнос, прогноз даты и достигнутые вехи. */
export function toGoalDto(goal: GoalWithDeposits, from: Date = new Date()): GoalDto {
  const targetAmount = Number(goal.targetAmount);
  const savedAmount = Number(goal.savedAmount);
  const percent = goalProgress(savedAmount, targetAmount);
  const pace = goalPacePerMonth(
    goal.deposits.map((deposit) => ({ amount: Number(deposit.amount), date: deposit.date })),
    from,
  );
  const forecast = forecastGoalDate(savedAmount, targetAmount, pace, from);

  return {
    id: goal.id,
    title: goal.title,
    targetAmount,
    savedAmount,
    remaining: round2(Math.max(0, targetAmount - savedAmount)),
    percent,
    deadline: goal.deadline ? goal.deadline.toISOString() : null,
    image: goal.image,
    visibility: goal.visibility as GoalVisibility,
    accountId: goal.accountId,
    currency: goal.currency,
    requiredMonthly: requiredMonthlyContribution(targetAmount, savedAmount, goal.deadline, from),
    forecastDate: forecast ? forecast.toISOString() : null,
    milestones: reachedMilestones(percent),
    createdAt: goal.createdAt.toISOString(),
  };
}

function toDepositDto(deposit: Prisma.GoalDepositGetPayload<object>): GoalDepositDto {
  return {
    id: deposit.id,
    amount: Number(deposit.amount),
    date: deposit.date.toISOString(),
    accountId: deposit.accountId,
    createdAt: deposit.createdAt.toISOString(),
  };
}

/** Цели накоплений (ТЗ §3.2, сценарий 2): CRUD, пополнения и вехи прогресса. */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posts: SocialPostsService,
  ) {}

  async list(userId: string): Promise<GoalDto[]> {
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      include: { deposits: true },
      orderBy: { createdAt: 'asc' },
    });
    return goals.map((goal) => toGoalDto(goal));
  }

  /** Возвращает цель пользователя либо 404 (чужая цель не видна). */
  async resolveOwned(userId: string, id: string): Promise<GoalWithDeposits> {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId }, include: { deposits: true } });
    if (!goal) {
      throw httpError(404, 'goal_not_found', 'Цель не найдена');
    }
    return goal;
  }

  async get(userId: string, id: string): Promise<GoalDto> {
    return toGoalDto(await this.resolveOwned(userId, id));
  }

  private async resolveOwnedAccount(userId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) {
      throw httpError(404, 'account_not_found', 'Счёт не найден');
    }
  }

  async create(userId: string, input: GoalCreateInput): Promise<GoalDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (input.accountId) await this.resolveOwnedAccount(userId, input.accountId);

    const goal = await this.prisma.goal.create({
      data: {
        userId,
        title: input.title,
        targetAmount: new Prisma.Decimal(input.targetAmount),
        savedAmount: new Prisma.Decimal(input.savedAmount ?? 0),
        deadline: input.deadline ? toDateOnly(input.deadline) : null,
        image: input.image ?? null,
        visibility: input.visibility,
        accountId: input.accountId ?? null,
        currency: user.currency,
      },
      include: { deposits: true },
    });
    const dto = toGoalDto(goal);
    // Пост в ленту о новой цели (ТЗ §3.7): приватность берём у самой цели.
    await this.posts.create({
      userId,
      type: 'goal',
      visibility: goal.visibility as GoalVisibility,
      payload: { goalId: goal.id, title: goal.title, image: goal.image, percent: dto.percent },
    });
    return dto;
  }

  async update(userId: string, id: string, input: GoalUpdateInput): Promise<GoalDto> {
    await this.resolveOwned(userId, id);
    if (input.accountId) await this.resolveOwnedAccount(userId, input.accountId);

    const goal = await this.prisma.goal.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.targetAmount !== undefined ? { targetAmount: new Prisma.Decimal(input.targetAmount) } : {}),
        ...(input.savedAmount !== undefined ? { savedAmount: new Prisma.Decimal(input.savedAmount) } : {}),
        ...(input.deadline !== undefined ? { deadline: input.deadline ? toDateOnly(input.deadline) : null } : {}),
        ...(input.image !== undefined ? { image: input.image } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        ...(input.accountId !== undefined ? { accountId: input.accountId ?? null } : {}),
      },
      include: { deposits: true },
    });
    return toGoalDto(goal);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.goal.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw httpError(404, 'goal_not_found', 'Цель не найдена');
    }
  }

  /**
   * Пополнение цели (ТЗ §3.2, сценарий 2): увеличивает накопленное, при
   * указанном счёте-сбережений списывает сумму с него, и отдаёт событие
   * milestone с вехами 25/50/75/100%, пересечёнными этим пополнением.
   */
  async deposit(userId: string, id: string, input: GoalDepositInput): Promise<GoalDepositResult> {
    const goal = await this.resolveOwned(userId, id);
    const accountId = input.accountId ?? goal.accountId ?? null;
    if (accountId) await this.resolveOwnedAccount(userId, accountId);

    const previousPercent = goalProgress(Number(goal.savedAmount), Number(goal.targetAmount));
    const amount = new Prisma.Decimal(input.amount);

    const { deposit, updated } = await this.prisma.$transaction(async (db) => {
      const created = await db.goalDeposit.create({
        data: {
          goalId: goal.id,
          userId,
          accountId,
          amount,
          date: toDateOnly(input.date) ?? toDateOnly()!,
        },
      });
      const next = await db.goal.update({
        where: { id: goal.id },
        data: { savedAmount: { increment: amount } },
        include: { deposits: true },
      });
      if (accountId) {
        await db.account.update({ where: { id: accountId }, data: { balance: { decrement: amount } } });
      }
      return { deposit: created, updated: next };
    });

    const dto = toGoalDto(updated);
    const milestone: GoalMilestoneEvent = {
      percent: dto.percent,
      reached: crossedMilestones(previousPercent, dto.percent),
    };

    // Пост-веха в ленту (ТЗ §3.7): только когда пополнение пересекло 25/50/75/100%.
    if (milestone.reached.length > 0) {
      // Событие для вебхуков (ТЗ §4): сигнатуру deposit не меняет.
      DomainEvents.emit('goal.milestone', userId, {
        goalId: goal.id,
        title: goal.title,
        percent: dto.percent,
        reached: milestone.reached,
      });
      await this.posts.create({
        userId,
        type: 'milestone',
        visibility: updated.visibility as GoalVisibility,
        payload: {
          goalId: goal.id,
          title: goal.title,
          percent: dto.percent,
          reached: milestone.reached,
        },
      });
    }

    return { goal: dto, deposit: toDepositDto(deposit), milestone };
  }
}
