// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDays,
  budgetRemaining,
  buildMoodCalendar,
  comparePeriods,
  dayKeyInTimezone,
  daysInMonth,
  moodAverage,
  periodRangeFromDay,
  previousPeriodRange,
  roundMoney,
  todayKeyInTimezone,
  zonedDayBounds,
  type CategorySpend,
  type MoodCalendarResponse,
  type PeriodRange,
  type PeriodTotals,
  type StatsDayResponse,
  type StatsPeriod,
  type StatsReportResponse,
  type StatsSeriesPoint,
} from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Дата-колонка @db.Date: UTC-полночь дня «YYYY-MM-DD». */
function dateOnly(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

/** Ключ дня из значения колонки @db.Date. */
function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Все дни диапазона включительно. */
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Первый и последний день месяца «YYYY-MM». */
function monthBounds(month: string): [string, string] {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return [`${month}-01`, `${month}-${String(daysInMonth(year, monthNumber)).padStart(2, '0')}`];
}

/**
 * Статистика (ТЗ §3.4, §6): дневные агрегаты с кешем в DailyStat, отчёты за
 * период, тепловая карта настроения и сравнение периодов. Пересчёт ленивый —
 * выполняется при чтении (минимально-инвазивно, не трогая модуль финансов).
 * Часовой пояс пользователя задаёт границы дней.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Пересчитывает кеш DailyStat за диапазон дней (только дни с данными + сегодня). */
  async recomputeRange(userId: string, timezone: string, from: string, to: string): Promise<void> {
    const start = zonedDayBounds(from, timezone).start;
    const endExclusive = zonedDayBounds(to, timezone).end;

    const [transactions, checkIns] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          userId,
          type: { in: ['expense', 'income'] },
          date: { gte: dateOnly(from), lte: dateOnly(to) },
        },
        select: { type: true, amountBase: true, date: true },
      }),
      this.prisma.checkIn.findMany({
        where: { userId, createdAt: { gte: start, lt: endExclusive } },
        select: { mood: true, createdAt: true },
      }),
    ]);

    const buckets = new Map<string, { spent: number; earned: number; moods: number[] }>();
    const bucket = (day: string): { spent: number; earned: number; moods: number[] } => {
      const existing = buckets.get(day);
      if (existing) return existing;
      const created = { spent: 0, earned: 0, moods: [] as number[] };
      buckets.set(day, created);
      return created;
    };

    for (const transaction of transactions) {
      const target = bucket(dayKeyOf(transaction.date));
      if (transaction.type === 'income') target.earned += Number(transaction.amountBase);
      else target.spent += Number(transaction.amountBase);
    }

    for (const checkIn of checkIns) {
      bucket(dayKeyInTimezone(checkIn.createdAt, timezone)).moods.push(checkIn.mood);
    }

    // Сегодняшний день кешируем всегда — дашборд должен быть готов к пустому дню.
    const today = todayKeyInTimezone(timezone);
    if (today >= from && today <= to) bucket(today);

    const days = [...buckets.keys()];

    // Экран статистики запрашивает отчёт и календарь параллельно, и их диапазоны
    // пересекаются: без блокировки пачки upsert'ов взаимно блокировались (deadlock → 500).
    // Блокировка на пользователя сериализует пересчёт; дни без данных удаляются из кеша,
    // иначе после удаления операций там оставались старые суммы.
    await this.prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily_stats:${userId}`}))`;
      await db.dailyStat.deleteMany({
        where: { userId, date: { gte: dateOnly(from), lte: dateOnly(to) } },
      });
      if (days.length === 0) return;
      await db.dailyStat.createMany({
        data: days.map((day) => {
          const values = buckets.get(day)!;
          return {
            userId,
            date: dateOnly(day),
            spent: new Prisma.Decimal(roundMoney(values.spent)),
            earned: new Prisma.Decimal(roundMoney(values.earned)),
            avgMood: moodAverage(values.moods),
            checkinsCount: values.moods.length,
          };
        }),
      });
    });
  }

  /** Дашборд дня (ТЗ §3.4): траты, остаток бюджета, среднее настроение, чек-ины. */
  async day(userId: string, day?: string): Promise<StatsDayResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const timezone = user.timezone;
    const dayKey = day ?? todayKeyInTimezone(timezone);

    await this.recomputeRange(userId, timezone, dayKey, dayKey);

    const month = dayKey.slice(0, 7);
    const [from, to] = monthBounds(month);
    const [stat, budgets, monthStats] = await Promise.all([
      this.prisma.dailyStat.findUnique({
        where: { userId_date: { userId, date: dateOnly(dayKey) } },
      }),
      this.prisma.budget.findMany({ where: { userId, month }, select: { limit: true } }),
      this.prisma.dailyStat.findMany({
        where: { userId, date: { gte: dateOnly(from), lte: dateOnly(to) } },
        select: { spent: true },
      }),
    ]);

    const spent = Number(stat?.spent ?? 0);
    const earned = Number(stat?.earned ?? 0);
    const budgetLimit = roundMoney(
      budgets.reduce((total, budget) => total + Number(budget.limit), 0),
    );
    const monthSpent = roundMoney(
      monthStats.reduce((total, entry) => total + Number(entry.spent), 0),
    );

    return {
      day: dayKey,
      timezone,
      currency: user.currency,
      spent,
      earned,
      net: roundMoney(earned - spent),
      budgetLimit,
      budgetRemaining: budgetRemaining(budgetLimit, monthSpent),
      avgMood: stat?.avgMood ?? null,
      checkins: stat?.checkinsCount ?? 0,
    };
  }

  /** Отчёт за период (ТЗ §3.4): категории, доходы против расходов, сравнение. */
  async report(userId: string, period: StatsPeriod, date?: string): Promise<StatsReportResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const timezone = user.timezone;

    const range = periodRangeFromDay(period, date ?? todayKeyInTimezone(timezone));
    const previous = previousPeriodRange(range);

    await this.recomputeRange(userId, timezone, range.from, range.to);
    await this.recomputeRange(userId, timezone, previous.from, previous.to);

    const [current, previousTotals, byCategory, series] = await Promise.all([
      this.periodTotals(userId, timezone, range),
      this.periodTotals(userId, timezone, previous),
      this.categoryBreakdown(userId, range),
      this.series(userId, range),
    ]);

    return {
      period,
      from: range.from,
      to: range.to,
      previousFrom: previous.from,
      previousTo: previous.to,
      timezone,
      currency: user.currency,
      spent: current.spent,
      earned: current.earned,
      net: roundMoney(current.earned - current.spent),
      avgMood: current.avgMood,
      checkins: current.checkins,
      byCategory,
      series,
      comparison: comparePeriods(current, previousTotals),
    };
  }

  /** Календарь-тепловая карта настроения за месяц (ТЗ §3.4). */
  async moodCalendar(userId: string, month: string): Promise<MoodCalendarResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const timezone = user.timezone;

    const [from, to] = monthBounds(month);
    await this.recomputeRange(userId, timezone, from, to);

    const start = zonedDayBounds(from, timezone).start;
    const endExclusive = zonedDayBounds(to, timezone).end;

    const [stats, moods] = await Promise.all([
      this.prisma.dailyStat.findMany({
        where: { userId, date: { gte: dateOnly(from), lte: dateOnly(to) } },
        select: { date: true, avgMood: true },
      }),
      this.prisma.checkIn.findMany({
        where: { userId, createdAt: { gte: start, lt: endExclusive } },
        select: { mood: true },
      }),
    ]);

    const averages: Record<string, number | null> = {};
    for (const stat of stats) {
      if (stat.avgMood !== null) averages[dayKeyOf(stat.date)] = stat.avgMood;
    }

    const days = buildMoodCalendar(month, averages);
    let best: { day: string; mood: number } | null = null;
    for (const entry of days) {
      if (entry.mood === null) continue;
      if (!best || entry.mood > best.mood) best = { day: entry.day, mood: entry.mood };
    }

    return {
      month,
      timezone,
      average: moodAverage(moods.map((checkIn) => checkIn.mood)),
      best,
      days,
    };
  }

  /** Итоги периода: траты, доходы, чек-ины и среднее настроение. */
  private async periodTotals(
    userId: string,
    timezone: string,
    range: PeriodRange,
  ): Promise<PeriodTotals> {
    const start = zonedDayBounds(range.from, timezone).start;
    const endExclusive = zonedDayBounds(range.to, timezone).end;

    const [stats, moods] = await Promise.all([
      this.prisma.dailyStat.findMany({
        where: { userId, date: { gte: dateOnly(range.from), lte: dateOnly(range.to) } },
        select: { spent: true, earned: true },
      }),
      this.prisma.checkIn.findMany({
        where: { userId, createdAt: { gte: start, lt: endExclusive } },
        select: { mood: true },
      }),
    ]);

    return {
      spent: roundMoney(stats.reduce((total, stat) => total + Number(stat.spent), 0)),
      earned: roundMoney(stats.reduce((total, stat) => total + Number(stat.earned), 0)),
      checkins: moods.length,
      avgMood: moodAverage(moods.map((checkIn) => checkIn.mood)),
    };
  }

  /** Траты по категориям за период — только расходы (переводы не расход). */
  private async categoryBreakdown(userId: string, range: PeriodRange): Promise<CategorySpend[]> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        type: 'expense',
        date: { gte: dateOnly(range.from), lte: dateOnly(range.to) },
      },
      _sum: { amountBase: true },
      _count: { _all: true },
    });

    if (grouped.length === 0) return [];

    const categoryIds = grouped
      .map((group) => group.categoryId)
      .filter((id): id is string => id !== null);
    const categories = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });
    const names = new Map(categories.map((category) => [category.id, category.name]));

    return grouped
      .map((group) => ({
        categoryId: group.categoryId,
        categoryName: group.categoryId ? (names.get(group.categoryId) ?? null) : null,
        total: roundMoney(Number(group._sum.amountBase ?? 0)),
        count: group._count._all,
      }))
      .sort(
        (left, right) =>
          right.total - left.total ||
          (left.categoryName ?? '').localeCompare(right.categoryName ?? '', 'ru'),
      );
  }

  /** Ряд по дням для графиков отчёта. */
  private async series(userId: string, range: PeriodRange): Promise<StatsSeriesPoint[]> {
    const stats = await this.prisma.dailyStat.findMany({
      where: { userId, date: { gte: dateOnly(range.from), lte: dateOnly(range.to) } },
      select: { date: true, spent: true, earned: true, avgMood: true },
    });
    const byDay = new Map(stats.map((stat) => [dayKeyOf(stat.date), stat]));

    return eachDay(range.from, range.to).map((day) => {
      const stat = byDay.get(day);
      return {
        day,
        spent: Number(stat?.spent ?? 0),
        earned: Number(stat?.earned ?? 0),
        mood: stat?.avgMood ?? null,
      };
    });
  }
}
