// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Предупреждения бюджета: слушает доменное событие transaction.created и при
 * пересечении порога 80% или 100% бюджета категории ставит уведомление. Порог
 * сравнивается «до» и «после» операции, поэтому одно пересечение — одно
 * уведомление без отдельного хранилища состояния.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { budgetLevel, type BudgetLevel } from '@puls/shared';
import { DomainEvents, type DomainEventMessage } from '../api-access/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcher } from './dispatcher';

const RANK: Record<BudgetLevel, number> = { ok: 0, warning: 1, exceeded: 2 };

/** Порог пересечён вверх: уровень «после» выше уровня «до». */
export function crossedBudgetThreshold(
  limit: number,
  spentAfter: number,
  amount: number,
): BudgetLevel | null {
  const before = budgetLevel(limit, spentAfter - amount).level;
  const after = budgetLevel(limit, spentAfter).level;
  return RANK[after] > RANK[before] ? after : null;
}

@Injectable()
export class BudgetAlerts implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BudgetAlerts.name);
  private readonly handler = (message: DomainEventMessage): void => {
    void this.onTransaction(message).catch((error: unknown) => {
      this.logger.warn(
        `Предупреждение бюджета не поставлено: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  onModuleInit(): void {
    DomainEvents.on('transaction.created', this.handler);
  }

  onModuleDestroy(): void {
    DomainEvents.off('transaction.created', this.handler);
  }

  /** Обрабатывает операцию; публично для тестов. */
  async onTransaction(message: DomainEventMessage): Promise<boolean> {
    if (message.data.type !== 'expense' || typeof message.data.id !== 'string') return false;

    const transaction = await this.prisma.transaction.findFirst({
      where: { id: message.data.id, userId: message.userId },
    });
    if (!transaction?.categoryId) return false;

    const month = transaction.date.toISOString().slice(0, 7);
    const budget = await this.prisma.budget.findFirst({
      where: { userId: message.userId, categoryId: transaction.categoryId, month },
      include: { category: true },
    });
    if (!budget) return false;

    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const sum = await this.prisma.transaction.aggregate({
      where: {
        userId: message.userId,
        type: 'expense',
        categoryId: transaction.categoryId,
        date: {
          gte: new Date(Date.UTC(year, monthNumber - 1, 1)),
          lt: new Date(Date.UTC(year, monthNumber, 1)),
        },
      },
      _sum: { amountBase: true },
    });
    const spent = Number(sum._sum.amountBase ?? 0);
    const limit = Number(budget.limit);

    if (!crossedBudgetThreshold(limit, spent, Number(transaction.amountBase))) return false;

    const user = await this.prisma.user.findUnique({
      where: { id: message.userId },
      select: { currency: true },
    });
    return this.dispatcher.notifyBudgetAlert(message.userId, {
      categoryName: budget.category.name,
      limit,
      spent,
      currency: user?.currency ?? 'RUB',
    });
  }
}
