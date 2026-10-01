// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { Prisma, type Budget, type Category } from '@prisma/client';
import { budgetLevel, type BudgetDto, type BudgetUpsertInput } from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

type BudgetWithCategory = Budget & { category: Category };

export function toBudgetDto(budget: BudgetWithCategory, spent: number): BudgetDto {
  const limit = Number(budget.limit);
  const status = budgetLevel(limit, spent);
  return {
    id: budget.id,
    categoryId: budget.categoryId,
    categoryName: budget.category.name,
    categoryIcon: budget.category.icon,
    categoryColor: budget.category.color,
    month: budget.month,
    limit,
    spent: Math.round(spent * 100) / 100,
    percent: status.percent,
    level: status.level,
  };
}

/** Границы месяца «YYYY-MM» в UTC (для колонки @db.Date). */
export function monthRange(month: string): { start: Date; end: Date } {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1)),
  };
}

/** Бюджеты на месяц по категориям (ТЗ §3.2) с уровнями 80% и 100%. */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  async list(userId: string, month: string): Promise<BudgetDto[]> {
    const budgets = await this.prisma.budget.findMany({
      where: { userId, month },
      include: { category: true },
      orderBy: { createdAt: 'asc' },
    });
    if (budgets.length === 0) return [];

    const spentByCategory = await this.spentByCategory(
      userId,
      budgets.map((budget) => budget.categoryId),
      month,
    );

    return budgets.map((budget) =>
      toBudgetDto(budget, spentByCategory.get(budget.categoryId) ?? 0),
    );
  }

  async upsert(userId: string, input: BudgetUpsertInput): Promise<BudgetDto> {
    await this.categories.resolveOwned(userId, input.categoryId);

    const budget = await this.prisma.budget.upsert({
      where: {
        userId_categoryId_month: { userId, categoryId: input.categoryId, month: input.month },
      },
      update: { limit: new Prisma.Decimal(input.limit) },
      create: {
        userId,
        categoryId: input.categoryId,
        month: input.month,
        limit: new Prisma.Decimal(input.limit),
      },
      include: { category: true },
    });

    const spent =
      (await this.spentByCategory(userId, [input.categoryId], input.month)).get(input.categoryId) ??
      0;
    return toBudgetDto(budget, spent);
  }

  async update(userId: string, id: string, limit: number): Promise<BudgetDto> {
    const existing = await this.prisma.budget.findFirst({ where: { id, userId } });
    if (!existing) {
      throw httpError(404, 'budget_not_found', 'Бюджет не найден');
    }

    const budget = await this.prisma.budget.update({
      where: { id: existing.id },
      data: { limit: new Prisma.Decimal(limit) },
      include: { category: true },
    });

    const spent =
      (await this.spentByCategory(userId, [budget.categoryId], budget.month)).get(
        budget.categoryId,
      ) ?? 0;
    return toBudgetDto(budget, spent);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.budget.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw httpError(404, 'budget_not_found', 'Бюджет не найден');
    }
  }

  private async spentByCategory(
    userId: string,
    categoryIds: string[],
    month: string,
  ): Promise<Map<string, number>> {
    const { start, end } = monthRange(month);
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        type: 'expense',
        categoryId: { in: categoryIds },
        date: { gte: start, lt: end },
      },
      _sum: { amountBase: true },
    });

    return new Map(
      grouped
        .filter((row): row is typeof row & { categoryId: string } => row.categoryId !== null)
        .map((row) => [row.categoryId, Number(row._sum.amountBase ?? 0)]),
    );
  }
}
