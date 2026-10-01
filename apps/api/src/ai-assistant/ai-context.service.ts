// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Чтение данных пользователя для инструментов AI-помощника (ТЗ §3.9).
 *
 * Все методы принимают `userId` первым аргументом и читают только его данные:
 * аргументы модели никогда не выбирают пользователя. Заметки чек-инов и имя не
 * возвращаются инструментам чата — они не должны попадать в модель.
 */
import { Injectable } from '@nestjs/common';
import { addDays, todayKeyInTimezone, type StreakDto } from '@puls/shared';
import { AchievementsService } from '../achievements/achievements.service';
import { PrismaService } from '../prisma/prisma.service';

export interface SpendingSummary {
  from: string;
  to: string;
  total: number;
  byCategory: { categoryId: string; categoryName: string; total: number; count: number }[];
}

export interface TransactionRow {
  date: string;
  type: string;
  amount: number;
  categoryName: string | null;
}

export interface MoodSeries {
  days: { day: string; avgMood: number | null; avgEnergy: number | null; count: number }[];
  avgMood: number | null;
  avgEnergy: number | null;
}

export interface GoalSummary {
  title: string;
  targetAmount: number;
  savedAmount: number;
  percent: number;
  deadline: string | null;
}

export interface BudgetSummary {
  categoryId: string;
  categoryName: string;
  month: string;
  limit: number;
  spent: number;
  percent: number;
}

export interface AchievementsSummary {
  streak: StreakDto;
  earned: string[];
}

/** UTC-полночь дня «YYYY-MM-DD» (колонка @db.Date). */
function dateOnly(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
}

@Injectable()
export class AiContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly achievementsService: AchievementsService,
  ) {}

  /** Часовой пояс пользователя — для границ дней по умолчанию. */
  async timezoneOf(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    return user.timezone;
  }

  /** Сводка трат по категориям за период; по умолчанию — текущий месяц. */
  async spendingSummary(
    userId: string,
    options: { from?: string; to?: string; categoryId?: string } = {},
  ): Promise<SpendingSummary> {
    const timezone = await this.timezoneOf(userId);
    const today = todayKeyInTimezone(timezone);
    const from = options.from ?? `${today.slice(0, 7)}-01`;
    const to = options.to ?? today;

    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        type: 'expense',
        date: { gte: dateOnly(from), lte: dateOnly(to) },
        ...(options.categoryId ? { categoryId: options.categoryId } : {}),
      },
      _sum: { amountBase: true },
      _count: { _all: true },
    });

    const categoryIds = grouped
      .map((row) => row.categoryId)
      .filter((id): id is string => id !== null);
    const categories = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(categories.map((category) => [category.id, category.name]));

    const byCategory = grouped
      .map((row) => ({
        categoryId: row.categoryId ?? 'none',
        categoryName: row.categoryId
          ? (nameById.get(row.categoryId) ?? 'Без категории')
          : 'Без категории',
        total: round2(Number(row._sum.amountBase ?? 0)),
        count: row._count._all,
      }))
      .sort((left, right) => right.total - left.total);

    return {
      from,
      to,
      total: round2(byCategory.reduce((sum, row) => sum + row.total, 0)),
      byCategory,
    };
  }

  /** Последние транзакции пользователя за период (без комментариев-заметок). */
  async listTransactions(
    userId: string,
    options: { limit?: number; from?: string; to?: string; type?: string } = {},
  ): Promise<TransactionRow[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        ...(options.type ? { type: options.type } : {}),
        ...(options.from || options.to
          ? {
              date: {
                ...(options.from ? { gte: dateOnly(options.from) } : {}),
                ...(options.to ? { lte: dateOnly(options.to) } : {}),
              },
            }
          : {}),
      },
      include: { category: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    return rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      type: row.type,
      amount: round2(Number(row.amountBase)),
      categoryName: row.category?.name ?? null,
    }));
  }

  /** Настроение и энергия по дням за период (без заметок). */
  async moodSeries(
    userId: string,
    options: { from?: string; to?: string } = {},
  ): Promise<MoodSeries> {
    const timezone = await this.timezoneOf(userId);
    const today = todayKeyInTimezone(timezone);
    const from = options.from ?? addDays(today, -13);
    const to = options.to ?? today;

    const checkIns = await this.prisma.checkIn.findMany({
      where: { userId, occurredAt: { gte: dateOnly(from), lt: dateOnly(addDays(to, 1)) } },
      select: { mood: true, energy: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });

    const byDay = new Map<string, { mood: number[]; energy: number[] }>();
    for (const checkIn of checkIns) {
      const day = todayKeyInTimezone(timezone, checkIn.occurredAt);
      const bucket = byDay.get(day) ?? { mood: [], energy: [] };
      if (checkIn.mood !== null) bucket.mood.push(checkIn.mood);
      if (checkIn.energy !== null) bucket.energy.push(checkIn.energy);
      byDay.set(day, bucket);
    }

    const days: MoodSeries['days'] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const bucket = byDay.get(day);
      days.push({
        day,
        avgMood: bucket ? average(bucket.mood) : null,
        avgEnergy: bucket ? average(bucket.energy) : null,
        count: bucket ? bucket.mood.length + bucket.energy.length : 0,
      });
    }

    return {
      days,
      avgMood: average(checkIns.map((checkIn) => checkIn.mood)),
      avgEnergy: average(
        checkIns
          .map((checkIn) => checkIn.energy)
          .filter((value): value is number => value !== null),
      ),
    };
  }

  /** Цели накоплений пользователя с прогрессом. */
  async goals(userId: string): Promise<GoalSummary[]> {
    const rows = await this.prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((goal) => {
      const target = Number(goal.targetAmount);
      const saved = Number(goal.savedAmount);
      const percent =
        target > 0 ? Math.min(100, Math.max(0, Math.round((saved / target) * 100))) : 0;
      return {
        title: goal.title,
        targetAmount: round2(target),
        savedAmount: round2(saved),
        percent,
        deadline: goal.deadline ? goal.deadline.toISOString().slice(0, 10) : null,
      };
    });
  }

  /** Бюджеты месяца с тратами. */
  async budgets(userId: string, month?: string): Promise<BudgetSummary[]> {
    const today = todayKeyInTimezone(await this.timezoneOf(userId));
    const targetMonth = month ?? today.slice(0, 7);
    const start = dateOnly(`${targetMonth}-01`);
    const end = new Date(
      Date.UTC(Number(targetMonth.slice(0, 4)), Number(targetMonth.slice(5, 7)), 0),
    );

    const rows = await this.prisma.budget.findMany({
      where: { userId, month: targetMonth },
      include: { category: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 0) return [];

    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        type: 'expense',
        categoryId: { in: rows.map((row) => row.categoryId) },
        date: { gte: start, lte: end },
      },
      _sum: { amountBase: true },
    });
    const spentByCategory = new Map(
      grouped
        .filter((row): row is typeof row & { categoryId: string } => row.categoryId !== null)
        .map((row) => [row.categoryId, Number(row._sum.amountBase ?? 0)]),
    );

    return rows.map((row) => {
      const limit = Number(row.limit);
      const spent = round2(spentByCategory.get(row.categoryId) ?? 0);
      return {
        categoryId: row.categoryId,
        categoryName: row.category.name,
        month: row.month,
        limit: round2(limit),
        spent,
        percent: limit > 0 ? Math.round((spent / limit) * 100) : 0,
      };
    });
  }

  /** Стрик чек-инов пользователя (только чтение). */
  async streak(userId: string): Promise<StreakDto> {
    return this.achievementsService.streak(userId);
  }

  /** Стрик чек-инов и полученные достижения (только чтение). */
  async achievements(userId: string): Promise<AchievementsSummary> {
    const [streak, earned] = await Promise.all([
      this.achievementsService.streak(userId),
      this.prisma.userAchievement.findMany({
        where: { userId },
        select: { code: true },
        orderBy: { earnedAt: 'asc' },
      }),
    ]);
    return { streak, earned: earned.map((row) => row.code) };
  }
}
