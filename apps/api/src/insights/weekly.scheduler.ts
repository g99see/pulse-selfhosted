// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Планировщик недельного разбора (ТЗ §3.5). По образцу планировщика
 * уведомлений: тик раз в минуту, в продакшене через BullMQ (Valkey), иначе
 * таймер в процессе. Разбор собирается в воскресенье 19:00 по часовому поясу
 * пользователя; генерация идемпотентна по ISO-неделе, поэтому повторные тики и
 * рестарты не создают дублей. В тестах автостарт выключен — тесты вызывают
 * runOnce() напрямую.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { isWeeklyReportDue } from '@puls/shared';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { InsightsService } from './insights.service';

export const INSIGHTS_QUEUE = 'puls-insights';
export const DEFAULT_TICK_MS = 60_000;

export interface WeeklyRunResult {
  userId: string;
  insights: number;
  suggestion: boolean;
}

@Injectable()
export class InsightsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InsightsScheduler.name);
  private readonly redisUrl = process.env.REDIS_URL ?? '';
  private readonly tickMs = Number(process.env.INSIGHTS_TICK_MS ?? DEFAULT_TICK_MS);
  private readonly autoStart =
    process.env.NODE_ENV !== 'test' && (process.env.INSIGHTS_SCHEDULER ?? 'on') !== 'off';

  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private probe: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastRunAt: Date | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: InsightsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.autoStart) {
      this.logger.log('Планировщик инсайтов не стартует автоматически');
      return;
    }
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** Собирает недельный разбор у всех, у кого наступил слот (окно (from, now]). */
  async runOnce(now: Date = new Date(), from?: Date): Promise<WeeklyRunResult[]> {
    if (this.running) return [];
    this.running = true;

    try {
      const windowFrom = from ?? this.lastRunAt ?? new Date(now.getTime() - this.tickMs);
      const users = await this.prisma.user.findMany({
        where: { onboardingCompletedAt: { not: null } },
        select: { id: true, timezone: true },
      });

      const results: WeeklyRunResult[] = [];
      for (const user of users) {
        if (!isWeeklyReportDue(now, user.timezone, windowFrom)) continue;
        const { report, created } = await this.insights.weekly(user.id, now);
        if (created) {
          results.push({ userId: user.id, insights: report.insights.length, suggestion: report.suggestion !== null });
        }
      }

      this.lastRunAt = now;
      if (results.length > 0) this.logger.log(`Недельный разбор собран для ${results.length} пользователей`);
      return results;
    } finally {
      this.running = false;
    }
  }

  private async start(): Promise<void> {
    if (this.redisUrl.length === 0) {
      this.logger.warn('REDIS_URL не задан — планировщик инсайтов работает по таймеру в процессе');
      this.startInterval();
      return;
    }

    try {
      this.probe = new Redis(this.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      this.probe.on('error', () => undefined);
      await this.probe.connect();
      await this.probe.ping();

      this.queue = new Queue(INSIGHTS_QUEUE, { connection: { url: this.redisUrl } });
      this.worker = new Worker(
        INSIGHTS_QUEUE,
        async () => {
          await this.runOnce();
        },
        { connection: { url: this.redisUrl } },
      );
      this.worker.on('error', () => undefined);
      this.worker.on('failed', (job, error) => {
        this.logger.warn(`Тик недельного разбора не прошёл: ${error.message}`);
      });

      await this.queue.upsertJobScheduler('insights-tick', { every: this.tickMs }, { name: 'tick', data: {} });
      this.logger.log('Планировщик инсайтов: BullMQ/Valkey');
    } catch (error) {
      this.logger.warn(
        `Valkey недоступен (${
          error instanceof Error ? error.message : 'unknown'
        }) — планировщик инсайтов переходит на таймер в процессе`,
      );
      await this.stopQueue();
      this.startInterval();
    }
  }

  private startInterval(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        this.logger.warn(
          `Ошибка тика недельного разбора: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
    }, this.tickMs);
    this.timer.unref?.();
  }

  private async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.stopQueue();
  }

  private async stopQueue(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
    if (this.probe) {
      this.probe.disconnect();
      this.probe = null;
    }
  }
}
