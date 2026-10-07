// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_METRICS,
  achievementByCode,
  metricsForEvent,
  nextStreakMilestone,
  progressFor,
  reachedTiers,
  streakFromInstants,
  type AchievementEvent,
  type AchievementLevel,
  type AchievementMetric,
  type AchievementStatusDto,
  type AchievementsResponse,
  type StreakDto,
} from '@puls/shared';
import { DomainEvents } from '../api-access/domain-events';
import { InternalEvents, type InternalEventMap } from '../common/internal-events';
import { PrismaService } from '../prisma/prisma.service';
import { METRICS, MetricData } from './metrics';

/** Глубина выборки чек-инов для плашки стрика — покрывает порог в 100 дней. */
const STREAK_WINDOW_DAYS = 370;
/** Сколько пользователей пересчитывается за одну пачку при backfill. */
const BACKFILL_BATCH = 100;
const INSTANCE_SETTINGS_ID = 'instance';

export interface AwardedTier {
  code: string;
  level: AchievementLevel;
}

export interface EvaluateOptions {
  /** Тихий режим (backfill): без уведомлений и вебхуков. */
  silent?: boolean;
  now?: Date;
}

export interface BackfillResult {
  users: number;
  awarded: number;
}

/** Отпечаток каталога: меняется при добавлении/правке достижений и их порогов. */
export function catalogHash(): string {
  const payload = ACHIEVEMENT_CATALOG.map((item) => [item.code, item.metric, item.tiers]);
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

/**
 * Достижения (ТЗ v2 §4). Каталог декларативный (@puls/shared), вычисление —
 * функции-метрики (./metrics). Выдача по событиям через evaluate/onEvent:
 * идемпотентна — уникальный индекс (user_id, code, level) и INSERT … ON CONFLICT
 * DO NOTHING. Уведомление о получении уходит через внутреннюю шину в outbox
 * Telegram/Discord; тихий пересчёт (backfill) уведомлений не шлёт.
 */
@Injectable()
export class AchievementsService implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap {
  private readonly logger = new Logger(AchievementsService.name);
  /** События из finance/goals/habits приходят через шину — без циклов модулей. */
  private readonly checkHandler = (payload: InternalEventMap['achievement.check']): void => {
    void this.onEvent(payload.userId, payload.event);
  };

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    InternalEvents.on('achievement.check', this.checkHandler);
  }

  onModuleDestroy(): void {
    InternalEvents.off('achievement.check', this.checkHandler);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.syncCatalog();
    // В тестах пересчёт запускается явно; в бою — один раз на версию каталога.
    if (process.env.NODE_ENV === 'test') return;
    void this.backfillIfNeeded().catch((error: unknown) => {
      this.logger.warn(`Пересчёт достижений не выполнен: ${(error as Error).message}`);
    });
  }

  /** Зеркалит каталог в таблицу achievements (справочник). Идемпотентно. */
  async syncCatalog(): Promise<void> {
    try {
      await Promise.all(
        ACHIEVEMENT_CATALOG.map((definition) => {
          const condition = {
            group: definition.group,
            metric: definition.metric,
            rarity: definition.rarity,
            hidden: definition.hidden,
            tiers: definition.tiers.map((tier) => ({ ...tier })),
          };
          return this.prisma.achievement.upsert({
            where: { code: definition.code },
            create: { code: definition.code, position: definition.position, condition },
            update: { position: definition.position, condition },
          });
        }),
      );
    } catch (error) {
      // Справочник вторичен: чтение достижений от него не зависит.
      this.logger.warn('Не удалось обновить каталог достижений', error as Error);
    }
  }

  /** Тихий пересчёт для всех, если каталог изменился с прошлого пересчёта. */
  async backfillIfNeeded(): Promise<BackfillResult | null> {
    const hash = catalogHash();
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { achievementsCatalogHash: true },
    });
    if (settings?.achievementsCatalogHash === hash) return null;
    const result = await this.backfillAll();
    // Строки настроек создаёт мастер установки — здесь только обновляем существующую.
    await this.prisma.instanceSettings.updateMany({
      where: { id: INSTANCE_SETTINGS_ID },
      data: { achievementsCatalogHash: hash },
    });
    this.logger.log(`Пересчёт достижений: пользователей ${result.users}, выдано ${result.awarded}`);
    return result;
  }

  /** Тихий пересчёт всех пользователей пачками; уведомления не отправляются. */
  async backfillAll(): Promise<BackfillResult> {
    let cursor: string | undefined;
    const result: BackfillResult = { users: 0, awarded: 0 };
    for (;;) {
      const batch = await this.prisma.user.findMany({
        take: BACKFILL_BATCH,
        orderBy: { id: 'asc' },
        select: { id: true },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      for (const { id } of batch) {
        try {
          result.awarded += (await this.evaluate(id, undefined, { silent: true })).length;
        } catch (error) {
          this.logger.warn(`Пересчёт достижений пользователя ${id}: ${(error as Error).message}`);
        }
        result.users += 1;
      }
      cursor = batch[batch.length - 1]!.id;
    }
    return result;
  }

  /**
   * Пересчёт по событию (чек-ин, операция, импорт, привычка, сверка, цель…):
   * считает только метрики, на которые событие влияет. Сбой не ломает вызывающего.
   */
  async onEvent(userId: string, event: AchievementEvent): Promise<AwardedTier[]> {
    try {
      return await this.evaluate(userId, metricsForEvent(event));
    } catch (error) {
      this.logger.warn(`Достижения по событию ${event}: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Вычисляет метрики (все или перечисленные) и выдаёт заслуженные уровни.
   * Возвращает только впервые выданные уровни.
   */
  async evaluate(
    userId: string,
    metrics?: readonly AchievementMetric[],
    options: EvaluateOptions = {},
  ): Promise<AwardedTier[]> {
    const { awarded } = await this.run(userId, metrics ?? ACHIEVEMENT_METRICS, options);
    return awarded;
  }

  private async run(
    userId: string,
    metrics: readonly AchievementMetric[],
    options: EvaluateOptions,
  ): Promise<{ values: Map<AchievementMetric, number>; awarded: AwardedTier[] }> {
    const wanted = new Set(metrics);
    const data = new MetricData(this.prisma, userId, options.now);
    const values = new Map<AchievementMetric, number>();
    for (const metric of wanted) values.set(metric, await METRICS[metric](data));

    const awarded: AwardedTier[] = [];
    for (const definition of ACHIEVEMENT_CATALOG) {
      if (!wanted.has(definition.metric)) continue;
      const value = values.get(definition.metric) ?? 0;
      for (const tier of reachedTiers(definition, value)) {
        if (await this.grant(userId, definition.code, tier.level)) {
          awarded.push({ code: definition.code, level: tier.level });
        }
      }
    }

    if (!options.silent) this.announce(userId, awarded);
    return { values, awarded };
  }

  /** Идемпотентная выдача уровня: true — выдан впервые, false — уже был. */
  async grant(userId: string, code: string, level: AchievementLevel): Promise<boolean> {
    if (!achievementByCode(code)) return false;
    const created = await this.prisma.userAchievement.createMany({
      data: [{ userId, code, level }],
      skipDuplicates: true, // INSERT … ON CONFLICT DO NOTHING
    });
    return created.count === 1;
  }

  /** Вебхук и уведомление — по одному на достижение (о высшем новом уровне). */
  private announce(userId: string, awarded: readonly AwardedTier[]): void {
    const order: AchievementLevel[] = ['bronze', 'silver', 'gold'];
    const best = new Map<string, AchievementLevel>();
    for (const item of awarded) {
      DomainEvents.emit('achievement.earned', userId, { code: item.code, level: item.level });
      const known = best.get(item.code);
      if (!known || order.indexOf(item.level) > order.indexOf(known)) {
        best.set(item.code, item.level);
      }
    }
    for (const [code, level] of best) {
      InternalEvents.emit('achievement.earned', { userId, code, level });
    }
  }

  /** Список достижений с прогрессом и текущий стрик. */
  async list(userId: string): Promise<AchievementsResponse> {
    const { values } = await this.run(userId, ACHIEVEMENT_METRICS, {});
    const [rows, streak] = await Promise.all([
      this.prisma.userAchievement.findMany({
        where: { userId },
        select: { code: true, level: true, earnedAt: true },
      }),
      this.streak(userId),
    ]);

    const byCode = new Map<string, Map<string, Date>>();
    for (const row of rows) {
      const levels = byCode.get(row.code) ?? new Map<string, Date>();
      levels.set(row.level, row.earnedAt);
      byCode.set(row.code, levels);
    }

    const achievements: AchievementStatusDto[] = ACHIEVEMENT_CATALOG.map((definition) => {
      const earnedTiers = byCode.get(definition.code) ?? new Map<string, Date>();
      const earned = earnedTiers.size > 0;
      const hiddenLocked = definition.hidden && !earned;
      const value = hiddenLocked ? 0 : (values.get(definition.metric) ?? 0);
      const state = progressFor(definition, value);
      // Уровень, который уже записан, не пропадает, даже если метрика просела (удалили данные).
      const stored = definition.tiers.filter((tier) => earnedTiers.has(tier.level));
      const level = stored.length > 0 ? stored[stored.length - 1]!.level : state.level;
      const firstAt = [...earnedTiers.values()].sort((a, b) => a.getTime() - b.getTime())[0];
      return {
        code: definition.code,
        group: definition.group,
        icon: definition.icon,
        rarity: definition.rarity,
        hidden: definition.hidden,
        earned,
        earnedAt: firstAt ? firstAt.toISOString() : null,
        level,
        value,
        nextThreshold: hiddenLocked ? null : (state.next?.threshold ?? null),
        progress: hiddenLocked ? 0 : state.progress,
        tiers: definition.tiers.map((tier) => ({
          level: tier.level,
          threshold: hiddenLocked ? 0 : tier.threshold,
          earnedAt: earnedTiers.get(tier.level)?.toISOString() ?? null,
        })),
      };
    });

    return { achievements, streak };
  }

  /** Текущий и самый длинный стрик чек-инов в часовом поясе пользователя. */
  async streak(userId: string): Promise<StreakDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timezone = user?.timezone ?? 'UTC';
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
}
