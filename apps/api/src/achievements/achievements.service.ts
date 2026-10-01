// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACHIEVEMENTS,
  achievementByCode,
  evaluateAchievements,
  isBudgetMonthClosedWithinLimit,
  nextStreakMilestone,
  streakFromInstants,
  todayKeyInTimezone,
  type AchievementCode,
  type AchievementContext,
  type AchievementStatusDto,
  type AchievementsResponse,
  type StreakDto,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { SocialPostsService } from '../social/social-posts.service';
import { DomainEvents } from '../api-access/domain-events';

/** Глубина выборки чек-инов для расчёта стриков — покрывает порог в 100 дней. */
const STREAK_WINDOW_DAYS = 370;

/**
 * Достижения и стрики чек-инов (ТЗ §2, §4, P1). Проверка условий ленива —
 * выполняется при чтении /api/achievements; кроме того, чек-ин-сервис явно
 * дёргает evaluate после записи. Выдача идемпотентна: уникальная пара
 * (user_id, code) защищает от повторной и гонки. Другие модули (цели) вручают
 * бейджи через публичный award(userId, code).
 */
@Injectable()
export class AchievementsService implements OnModuleInit {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posts: SocialPostsService,
  ) {}

  /** Каталог бейджей в БД (модель Achievement: код + условие). Идемпотентно. */
  async onModuleInit(): Promise<void> {
    try {
      await Promise.all(
        ACHIEVEMENTS.map((definition) =>
          this.prisma.achievement.upsert({
            where: { code: definition.code },
            create: {
              code: definition.code,
              position: definition.position,
              condition: {
                group: definition.group,
                threshold: definition.threshold ?? null,
              },
            },
            update: {
              position: definition.position,
              condition: {
                group: definition.group,
                threshold: definition.threshold ?? null,
              },
            },
          }),
        ),
      );
    } catch (error) {
      // Каталог — справочная таблица: чтение достижений от неё не зависит.
      this.logger.warn('Не удалось обновить каталог достижений', error as Error);
    }
  }

  /**
   * Вручает бейдж по коду. Публичный метод для других модулей (цели, ТЗ §4).
   * Возвращает true, если бейдж выдан впервые; false — если уже был (P2002).
   */
  async award(userId: string, code: AchievementCode): Promise<boolean> {
    if (!achievementByCode(code)) {
      throw httpError(400, 'validation_error', 'Неизвестное достижение');
    }

    try {
      await this.prisma.userAchievement.create({ data: { userId, code } });
      // Событие для вебхуков (ТЗ §4): сигнатуру award не меняет.
      DomainEvents.emit('achievement.earned', userId, { code });
      // Пост в ленту о полученном достижении (ТЗ §3.7): виден подписчикам.
      await this.posts.create({ userId, type: 'achievement', payload: { code } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  /** Ленивая проверка условий: выдаёт все заслуженные бейджи. */
  async evaluate(userId: string): Promise<AchievementCode[]> {
    const context = await this.buildContext(userId);
    const satisfied = evaluateAchievements(context);

    const awarded: AchievementCode[] = [];
    for (const code of satisfied) {
      if (await this.award(userId, code)) awarded.push(code);
    }
    return awarded;
  }

  /** Список бейджей с прогрессом и текущий стрик (ТЗ §4). */
  async list(userId: string): Promise<AchievementsResponse> {
    await this.evaluate(userId);

    const [earned, streak] = await Promise.all([
      this.prisma.userAchievement.findMany({
        where: { userId },
        select: { code: true, earnedAt: true },
      }),
      this.streak(userId),
    ]);

    const earnedAt = new Map(earned.map((item) => [item.code, item.earnedAt]));
    const streakValue = Math.max(streak.current, streak.longest);

    const achievements: AchievementStatusDto[] = ACHIEVEMENTS.map((definition) => {
      const at = earnedAt.get(definition.code) ?? null;
      return {
        code: definition.code,
        earned: at !== null,
        earnedAt: at ? at.toISOString() : null,
        progress: this.progressFor(definition.code, at !== null, streakValue),
      };
    });

    return { achievements, streak };
  }

  /** Текущий и самый длинный стрик чек-инов в часовом поясе пользователя. */
  async streak(userId: string): Promise<StreakDto> {
    const timezone = await this.timezoneOf(userId);
    const since = new Date(Date.now() - STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const checkIns = await this.prisma.checkIn.findMany({
      where: { userId, occurredAt: { gte: since } },
      select: { occurredAt: true },
    });

    const result = streakFromInstants(
      checkIns.map((checkIn) => checkIn.occurredAt),
      timezone,
    );

    return {
      current: result.current,
      longest: result.longest,
      checkedToday: result.checkedToday,
      todayKey: result.todayKey,
      lastDayKey: result.lastDayKey,
      nextMilestone: nextStreakMilestone(Math.max(result.current, result.longest)),
    };
  }

  private progressFor(code: AchievementCode, earned: boolean, streak: number): number {
    if (earned) return 1;
    const definition = achievementByCode(code);
    if (definition?.group === 'checkins' && definition.threshold) {
      return Math.min(1, streak / definition.threshold);
    }
    return 0;
  }

  private async timezoneOf(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone ?? 'UTC';
  }

  /** Контекст для проверки условий бейджей (ТЗ §4). */
  private async buildContext(userId: string): Promise<AchievementContext> {
    const timezone = await this.timezoneOf(userId);
    const since = new Date(Date.now() - STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [checkinsCount, recent, transactionsCount, closedBudgetsCount] = await Promise.all([
      this.prisma.checkIn.count({ where: { userId } }),
      this.prisma.checkIn.findMany({
        where: { userId, occurredAt: { gte: since } },
        select: { occurredAt: true },
      }),
      this.prisma.transaction.count({ where: { userId } }),
      this.countClosedBudgets(userId, timezone),
    ]);

    const streak = streakFromInstants(
      recent.map((checkIn) => checkIn.occurredAt),
      timezone,
    );

    return {
      checkinsCount,
      transactionsCount,
      currentStreak: streak.current,
      longestStreak: streak.longest,
      closedBudgetsCount,
    };
  }

  /** Число прошедших месяцев с бюджетом и без превышения (ТЗ §4). */
  private async countClosedBudgets(userId: string, timezone: string): Promise<number> {
    const currentMonth = todayKeyInTimezone(timezone).slice(0, 7);
    const budgets = await this.prisma.budget.findMany({
      where: { userId },
      select: { month: true, limit: true },
    });
    if (budgets.length === 0) return 0;

    const limitsByMonth = new Map<string, number>();
    for (const budget of budgets) {
      limitsByMonth.set(
        budget.month,
        (limitsByMonth.get(budget.month) ?? 0) + Number(budget.limit),
      );
    }

    const pastMonths = [...limitsByMonth.keys()].filter((month) => month < currentMonth);
    if (pastMonths.length === 0) return 0;

    const closed = await Promise.all(
      pastMonths.map(async (month) => {
        const [year, monthNumber] = month.split('-').map(Number);
        const start = new Date(Date.UTC(year!, (monthNumber ?? 1) - 1, 1));
        const end = new Date(Date.UTC(year!, monthNumber ?? 1, 1));
        const spent = await this.prisma.transaction.aggregate({
          _sum: { amount: true },
          where: { userId, type: 'expense', date: { gte: start, lt: end } },
        });
        return isBudgetMonthClosedWithinLimit(
          limitsByMonth.get(month) ?? 0,
          Number(spent._sum.amount ?? 0),
          month,
          currentMonth,
        );
      }),
    );

    return closed.filter(Boolean).length;
  }
}
