// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  FAMILY_INVITE_HOURS_DEFAULT,
  FAMILY_MAX_MEMBERS,
  familyBalanceDelta,
  familyGoalSummary,
  isFamilyInviteActive,
  type FamilyAccountCreateInput,
  type FamilyAccountDto,
  type FamilyAccountUpdateInput,
  type FamilyAccountsResponse,
  type FamilyAccountType,
  type FamilyCreateInput,
  type FamilyDto,
  type FamilyGoalCreateInput,
  type FamilyGoalDepositDto,
  type FamilyGoalDepositInput,
  type FamilyGoalDepositResult,
  type FamilyGoalDto,
  type FamilyGoalUpdateInput,
  type FamilyInviteCreateInput,
  type FamilyInviteDto,
  type FamilyJoinInput,
  type FamilyMemberDto,
  type FamilyRole,
  type FamilyTransactionCreateInput,
  type FamilyTransactionDto,
  type FamilyTransactionKind,
  type FamilyTransactionResult,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';

type FamilyMemberRow = Prisma.FamilyMemberGetPayload<object>;
type MemberWithUser = Prisma.FamilyMemberGetPayload<{ include: { user: true } }>;
type FamilyWithMembers = Prisma.FamilyGetPayload<{
  include: { members: { include: { user: true } } };
}>;
type GoalWithDeposits = Prisma.FamilyGoalGetPayload<{
  include: { deposits: { include: { user: true } } };
}>;

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

function toFamilyAccountDto(account: Prisma.FamilyAccountGetPayload<object>): FamilyAccountDto {
  return {
    id: account.id,
    name: account.name,
    type: (account.type as FamilyAccountType) ?? 'card',
    balance: Number(account.balance),
    currency: account.currency,
  };
}

function toTransactionDto(
  transaction: Prisma.FamilyTransactionGetPayload<{ include: { user: true } }>,
): FamilyTransactionDto {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    userId: transaction.userId,
    nickname: transaction.user?.nickname ?? null,
    kind: transaction.kind as FamilyTransactionKind,
    amount: Number(transaction.amount),
    note: transaction.note,
    date: transaction.date.toISOString(),
    createdAt: transaction.createdAt.toISOString(),
  };
}

function toGoalDepositDto(
  deposit: Prisma.FamilyGoalDepositGetPayload<{ include: { user: true } }>,
): FamilyGoalDepositDto {
  return {
    id: deposit.id,
    goalId: deposit.goalId,
    userId: deposit.userId,
    nickname: deposit.user?.nickname ?? null,
    amount: Number(deposit.amount),
    date: deposit.date.toISOString(),
    createdAt: deposit.createdAt.toISOString(),
  };
}

/** Семейная цель → DTO: прогресс, взнос, прогноз и вехи считаются как у личных. */
export function toFamilyGoalDto(goal: GoalWithDeposits, from: Date = new Date()): FamilyGoalDto {
  const targetAmount = Number(goal.targetAmount);
  const savedAmount = Number(goal.savedAmount);
  const summary = familyGoalSummary(
    savedAmount,
    targetAmount,
    goal.deadline,
    goal.deposits.map((deposit) => ({ amount: Number(deposit.amount), date: deposit.date })),
    from,
  );
  return {
    id: goal.id,
    title: goal.title,
    targetAmount,
    savedAmount,
    remaining: summary.remaining,
    percent: summary.percent,
    deadline: goal.deadline ? goal.deadline.toISOString() : null,
    image: goal.image,
    currency: goal.currency,
    requiredMonthly: summary.requiredMonthly,
    forecastDate: summary.forecastDate,
    milestones: summary.milestones,
    deposits: goal.deposits.map(toGoalDepositDto),
    createdAt: goal.createdAt.toISOString(),
  };
}

function toMemberDto(member: MemberWithUser): FamilyMemberDto {
  return {
    userId: member.userId,
    nickname: member.user.nickname,
    role: member.role as FamilyRole,
    joinedAt: member.joinedAt.toISOString(),
  };
}

/**
 * Семейный режим (ТЗ §4): семья на домашнем сервере, общие счета и цели, у
 * каждого участника приватный дневник. Все методы работают только в пределах
 * семьи пользователя: чужой идентификатор даёт 404, личные данные не читаются.
 */
@Injectable()
export class FamilyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Членство пользователя либо 404 (нет семьи — нечего показывать). */
  private async requireMember(userId: string): Promise<FamilyMemberRow> {
    const member = await this.prisma.familyMember.findUnique({ where: { userId } });
    if (!member) throw httpError(404, 'family_not_found', 'Семья не найдена');
    return member;
  }

  /** Членство владельца либо 403 (составом управляет только владелец). */
  private async requireOwner(userId: string): Promise<FamilyMemberRow> {
    const member = await this.requireMember(userId);
    if (member.role !== 'owner') {
      throw httpError(403, 'family_forbidden', 'Действие доступно только владельцу семьи');
    }
    return member;
  }

  private async familyDto(family: FamilyWithMembers, viewerId: string): Promise<FamilyDto> {
    const viewer = family.members.find((member) => member.userId === viewerId);
    return {
      id: family.id,
      name: family.name,
      ownerId: family.ownerId,
      role: (viewer?.role as FamilyRole) ?? 'member',
      members: family.members.map(toMemberDto),
      createdAt: family.createdAt.toISOString(),
    };
  }

  /** GET /api/family: моя семья с участниками или null, если семьи нет. */
  async getFamily(userId: string): Promise<FamilyDto | null> {
    const member = await this.prisma.familyMember.findUnique({ where: { userId } });
    if (!member) return null;
    const family = await this.prisma.family.findUniqueOrThrow({
      where: { id: member.familyId },
      include: { members: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
    });
    return this.familyDto(family, userId);
  }

  /** POST /api/family: создать семью; создатель становится владельцем. */
  async create(userId: string, input: FamilyCreateInput): Promise<FamilyDto> {
    const existing = await this.prisma.familyMember.findUnique({ where: { userId } });
    if (existing) throw httpError(409, 'family_already_member', 'Вы уже состоите в семье');

    const familyId = await this.prisma.$transaction(async (db) => {
      const family = await db.family.create({ data: { name: input.name, ownerId: userId } });
      await db.familyMember.create({ data: { familyId: family.id, userId, role: 'owner' } });
      return family.id;
    });
    return (await this.getFamily(userId))!;
  }

  private async generateCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `FAM-${randomBytes(6).toString('hex').toUpperCase()}`;
      const clash = await this.prisma.familyInvite.findUnique({ where: { code } });
      if (!clash) return code;
    }
    throw httpError(500, 'invite_code_failed', 'Не удалось создать код приглашения');
  }

  /** POST /api/family/invites: владелец создаёт одноразовый код со сроком. */
  async createInvite(userId: string, input: FamilyInviteCreateInput): Promise<FamilyInviteDto> {
    const member = await this.requireOwner(userId);
    const hours = input.expiresInHours ?? FAMILY_INVITE_HOURS_DEFAULT;
    const invite = await this.prisma.familyInvite.create({
      data: {
        familyId: member.familyId,
        code: await this.generateCode(),
        createdBy: userId,
        expiresAt: new Date(Date.now() + hours * 3_600_000),
      },
    });
    return {
      code: invite.code,
      familyId: invite.familyId,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  /**
   * POST /api/family/join: вступить по коду. Код одноразовый и срочный; один
   * пользователь состоит только в одной семье.
   */
  async join(userId: string, input: FamilyJoinInput): Promise<FamilyDto> {
    const existing = await this.prisma.familyMember.findUnique({ where: { userId } });
    if (existing) throw httpError(409, 'family_already_member', 'Вы уже состоите в семье');

    const invite = await this.prisma.familyInvite.findUnique({
      where: { code: input.code.trim().toUpperCase() },
    });
    if (!invite || !isFamilyInviteActive(invite)) {
      throw httpError(404, 'invite_not_found', 'Приглашение не найдено или просрочено');
    }

    const count = await this.prisma.familyMember.count({ where: { familyId: invite.familyId } });
    if (count >= FAMILY_MAX_MEMBERS) {
      throw httpError(409, 'family_full', 'В семье уже максимум участников');
    }

    await this.prisma.$transaction(async (db) => {
      // Одноразовость: помечаем код использованным, иначе кто-то успел раньше.
      const consumed = await db.familyInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date(), usedBy: userId },
      });
      if (consumed.count === 0) {
        throw httpError(404, 'invite_not_found', 'Приглашение уже использовано');
      }
      await db.familyMember.create({ data: { familyId: invite.familyId, userId, role: 'member' } });
    });

    return (await this.getFamily(userId))!;
  }

  /** DELETE /api/family/members/:userId: владелец исключает участника. */
  async removeMember(actorId: string, targetUserId: string): Promise<void> {
    const actor = await this.requireOwner(actorId);
    const target = await this.prisma.familyMember.findUnique({ where: { userId: targetUserId } });
    if (!target || target.familyId !== actor.familyId) {
      throw httpError(404, 'member_not_found', 'Участник не найден');
    }
    if (target.role === 'owner') {
      throw httpError(409, 'family_owner_cannot_remove', 'Нельзя исключить владельца семьи');
    }
    await this.prisma.familyMember.delete({ where: { id: target.id } });
  }

  /** POST /api/family/leave: участник выходит сам; владелец сначала удаляет семью. */
  async leave(userId: string): Promise<void> {
    const member = await this.requireMember(userId);
    if (member.role === 'owner') {
      throw httpError(409, 'family_owner_cannot_leave', 'Владелец не может выйти — удалите семью');
    }
    await this.prisma.familyMember.delete({ where: { id: member.id } });
  }

  /** DELETE /api/family: владелец удаляет семью вместе с общими данными. */
  async deleteFamily(userId: string): Promise<void> {
    const member = await this.requireOwner(userId);
    await this.prisma.family.delete({ where: { id: member.familyId } });
  }

  private async resolveFamilyAccount(
    userId: string,
    accountId: string,
  ): Promise<Prisma.FamilyAccountGetPayload<object>> {
    const member = await this.requireMember(userId);
    const account = await this.prisma.familyAccount.findFirst({
      where: { id: accountId, familyId: member.familyId },
    });
    if (!account) throw httpError(404, 'account_not_found', 'Счёт не найден');
    return account;
  }

  /** GET /api/family/accounts: общие счета семьи. */
  async listAccounts(userId: string): Promise<FamilyAccountsResponse> {
    const member = await this.requireMember(userId);
    const accounts = await this.prisma.familyAccount.findMany({
      where: { familyId: member.familyId },
      orderBy: { createdAt: 'asc' },
    });
    const currency = accounts[0]?.currency ?? 'RUB';
    // Итог складываем как есть: счета семьи ведут в одной основной валюте.
    const totalBalance = round2(
      accounts.reduce((sum, account) => sum + Number(account.balance), 0),
    );
    return { accounts: accounts.map(toFamilyAccountDto), totalBalance, currency };
  }

  /** POST /api/family/accounts: общий счёт семьи. */
  async createAccount(userId: string, input: FamilyAccountCreateInput): Promise<FamilyAccountDto> {
    const member = await this.requireMember(userId);
    const account = await this.prisma.familyAccount.create({
      data: {
        familyId: member.familyId,
        name: input.name,
        type: input.type,
        balance: new Prisma.Decimal(input.balance ?? 0),
        currency: input.currency ?? 'RUB',
      },
    });
    return toFamilyAccountDto(account);
  }

  /** PUT /api/family/accounts/:id: правка общего счёта. */
  async updateAccount(
    userId: string,
    accountId: string,
    input: FamilyAccountUpdateInput,
  ): Promise<FamilyAccountDto> {
    await this.resolveFamilyAccount(userId, accountId);
    const account = await this.prisma.familyAccount.update({
      where: { id: accountId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.balance !== undefined ? { balance: new Prisma.Decimal(input.balance) } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      },
    });
    return toFamilyAccountDto(account);
  }

  /** DELETE /api/family/accounts/:id: удалить общий счёт. */
  async removeAccount(userId: string, accountId: string): Promise<void> {
    const member = await this.requireMember(userId);
    const result = await this.prisma.familyAccount.deleteMany({
      where: { id: accountId, familyId: member.familyId },
    });
    if (result.count === 0) throw httpError(404, 'account_not_found', 'Счёт не найден');
  }

  async listTransactions(userId: string, accountId: string): Promise<FamilyTransactionDto[]> {
    await this.resolveFamilyAccount(userId, accountId);
    const transactions = await this.prisma.familyTransaction.findMany({
      where: { accountId },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return transactions.map(toTransactionDto);
  }

  /**
   * POST /api/family/accounts/:id/transactions: доход или расход. Кто внёс —
   * user_id сессии; баланс счёта пересчитывается в одной транзакции БД.
   */
  async createTransaction(
    userId: string,
    accountId: string,
    input: FamilyTransactionCreateInput,
  ): Promise<FamilyTransactionResult> {
    const account = await this.resolveFamilyAccount(userId, accountId);
    const delta = new Prisma.Decimal(familyBalanceDelta(input.kind, input.amount));

    const { transaction, updated } = await this.prisma.$transaction(async (db) => {
      const created = await db.familyTransaction.create({
        data: {
          accountId: account.id,
          userId,
          kind: input.kind,
          amount: new Prisma.Decimal(input.amount),
          note: input.note ?? null,
          date: toDateOnly(input.date) ?? toDateOnly()!,
        },
        include: { user: true },
      });
      const next = await db.familyAccount.update({
        where: { id: account.id },
        data: { balance: { increment: delta } },
      });
      return { transaction: created, updated: next };
    });

    return { account: toFamilyAccountDto(updated), transaction: toTransactionDto(transaction) };
  }

  private async resolveFamilyGoal(userId: string, goalId: string): Promise<GoalWithDeposits> {
    const member = await this.requireMember(userId);
    const goal = await this.prisma.familyGoal.findFirst({
      where: { id: goalId, familyId: member.familyId },
      include: { deposits: { include: { user: true }, orderBy: { date: 'asc' } } },
    });
    if (!goal) throw httpError(404, 'goal_not_found', 'Цель не найдена');
    return goal;
  }

  /** GET /api/family/goals: общие цели семьи с прогрессом. */
  async listGoals(userId: string): Promise<FamilyGoalDto[]> {
    const member = await this.requireMember(userId);
    const goals = await this.prisma.familyGoal.findMany({
      where: { familyId: member.familyId },
      include: { deposits: { include: { user: true }, orderBy: { date: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return goals.map((goal) => toFamilyGoalDto(goal));
  }

  /** POST /api/family/goals: общая цель семьи. */
  async createGoal(userId: string, input: FamilyGoalCreateInput): Promise<FamilyGoalDto> {
    const member = await this.requireMember(userId);
    const goal = await this.prisma.familyGoal.create({
      data: {
        familyId: member.familyId,
        title: input.title,
        targetAmount: new Prisma.Decimal(input.targetAmount),
        savedAmount: new Prisma.Decimal(input.savedAmount ?? 0),
        deadline: input.deadline ? toDateOnly(input.deadline) : null,
        image: input.image ?? null,
      },
      include: { deposits: { include: { user: true } } },
    });
    return toFamilyGoalDto(goal);
  }

  /** PUT /api/family/goals/:id: правка общей цели. */
  async updateGoal(
    userId: string,
    goalId: string,
    input: FamilyGoalUpdateInput,
  ): Promise<FamilyGoalDto> {
    await this.resolveFamilyGoal(userId, goalId);
    const goal = await this.prisma.familyGoal.update({
      where: { id: goalId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.targetAmount !== undefined
          ? { targetAmount: new Prisma.Decimal(input.targetAmount) }
          : {}),
        ...(input.deadline !== undefined
          ? { deadline: input.deadline ? toDateOnly(input.deadline) : null }
          : {}),
        ...(input.image !== undefined ? { image: input.image } : {}),
      },
      include: { deposits: { include: { user: true }, orderBy: { date: 'asc' } } },
    });
    return toFamilyGoalDto(goal);
  }

  /** DELETE /api/family/goals/:id: удалить общую цель. */
  async removeGoal(userId: string, goalId: string): Promise<void> {
    const member = await this.requireMember(userId);
    const result = await this.prisma.familyGoal.deleteMany({
      where: { id: goalId, familyId: member.familyId },
    });
    if (result.count === 0) throw httpError(404, 'goal_not_found', 'Цель не найдена');
  }

  /** POST /api/family/goals/:id/deposit: взнос участника в общую цель. */
  async depositGoal(
    userId: string,
    goalId: string,
    input: FamilyGoalDepositInput,
  ): Promise<FamilyGoalDepositResult> {
    await this.resolveFamilyGoal(userId, goalId);
    const amount = new Prisma.Decimal(input.amount);

    const { deposit, updated } = await this.prisma.$transaction(async (db) => {
      const created = await db.familyGoalDeposit.create({
        data: {
          goalId,
          userId,
          amount,
          date: toDateOnly(input.date) ?? toDateOnly()!,
        },
        include: { user: true },
      });
      const next = await db.familyGoal.update({
        where: { id: goalId },
        data: { savedAmount: { increment: amount } },
        include: { deposits: { include: { user: true }, orderBy: { date: 'asc' } } },
      });
      return { deposit: created, updated: next };
    });

    return { goal: toFamilyGoalDto(updated), deposit: toGoalDepositDto(deposit) };
  }
}
