// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import {
  buildWrapped,
  dayKeyInTimezone,
  todayKeyInTimezone,
  zonedDayBounds,
  type WrappedCheckin,
  type WrappedResponse,
  type WrappedTransaction,
} from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Дата-колонка @db.Date: UTC-полночь дня «YYYY-MM-DD». */
function dateOnly(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

/**
 * «Год в цифрах» (ТЗ §3.4, J1): агрегация за календарный год — траты и доходы,
 * топ категорий, самый дорогой день, частый день недели, настроение по месяцам,
 * стрик и достижения. Данные только текущего пользователя.
 */
@Injectable()
export class WrappedService {
  constructor(private readonly prisma: PrismaService) {}

  /** Собирает сводку за год; без параметра — текущий год в поясе пользователя. */
  async year(userId: string, year?: number): Promise<WrappedResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const timezone = user.timezone;
    const currency = user.currency;
    // Целевой год: явный параметр, иначе — текущий год пользователя по его поясу.
    const targetYear = year ?? Number(todayKeyInTimezone(timezone).slice(0, 4));

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: { in: ['expense', 'income'] },
        date: { gte: dateOnly(`${targetYear}-01-01`), lte: dateOnly(`${targetYear}-12-31`) },
      },
      select: { type: true, amountBase: true, date: true, categoryId: true },
    });

    const categoryIds = [
      ...new Set(
        transactions
          .map((transaction) => transaction.categoryId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const categories =
      categoryIds.length > 0
        ? await this.prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : [];
    const names = new Map(categories.map((category) => [category.id, category.name]));

    const wrappedTransactions: WrappedTransaction[] = transactions.map((transaction) => ({
      type: transaction.type as WrappedTransaction['type'],
      amount: Number(transaction.amountBase),
      day: transaction.date.toISOString().slice(0, 10),
      categoryId: transaction.categoryId,
      categoryName: transaction.categoryId ? (names.get(transaction.categoryId) ?? null) : null,
    }));

    const yearStart = zonedDayBounds(`${targetYear}-01-01`, timezone).start;
    const yearEnd = zonedDayBounds(`${targetYear}-12-31`, timezone).end;
    const checkIns = await this.prisma.checkIn.findMany({
      where: { userId, occurredAt: { gte: yearStart, lt: yearEnd } },
      select: { mood: true, occurredAt: true },
    });
    const wrappedCheckins: WrappedCheckin[] = checkIns.map((checkIn) => ({
      mood: checkIn.mood,
      day: dayKeyInTimezone(checkIn.occurredAt, timezone),
    }));

    const yearStartUtc = new Date(`${targetYear}-01-01T00:00:00.000Z`);
    const nextYearStartUtc = new Date(`${targetYear + 1}-01-01T00:00:00.000Z`);

    // Завершённые цели: цель обновлялась в этом году и накопления покрыли цель.
    // Завершение приближено моментом последнего обновления (updatedAt) — точной
    // даты закрытия модель Goal не хранит.
    const goals = await this.prisma.goal.findMany({
      where: { userId, updatedAt: { gte: yearStartUtc, lt: nextYearStartUtc } },
      select: { savedAmount: true, targetAmount: true },
    });
    const closedGoals = goals.filter(
      (goal) => Number(goal.savedAmount) >= Number(goal.targetAmount),
    ).length;

    const achievements = await this.prisma.userAchievement.findMany({
      where: { userId, earnedAt: { gte: yearStartUtc, lt: nextYearStartUtc } },
      select: { earnedAt: true },
    });

    return buildWrapped(
      {
        year: targetYear,
        transactions: wrappedTransactions,
        checkins: wrappedCheckins,
        closedGoals,
        achievements: achievements.map((achievement) => achievement.earnedAt.toISOString()),
      },
      { timezone, currency },
    );
  }
}
