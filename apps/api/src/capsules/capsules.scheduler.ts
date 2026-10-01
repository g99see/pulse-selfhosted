// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Планировщик открытия капсул времени (ТЗ §4, P2). По образцу планировщика
 * уведомлений: в продакшене тик идёт через BullMQ (ioredis/Valkey), при
 * недоступности Valkey или без REDIS_URL — таймер в процессе. В момент open_at
 * капсула захватывается CAS-обновлением (opened_at: null → now), собирается
 * снимок статистики и через существующий NotificationDispatcher уходит
 * уведомление «капсула открылась». В тестах автостарт выключен — тесты зовут
 * runOnce() сами.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { NotificationDispatcher } from '../notifications/dispatcher';
import { PrismaService } from '../prisma/prisma.service';
import { CapsulesService, type CapsuleRow } from './capsules.service';

export const CAPSULES_QUEUE = 'puls-capsules';
export const DEFAULT_CAPSULES_TICK_MS = 60_000;

@Injectable()
export class CapsulesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CapsulesScheduler.name);
  private readonly redisUrl = process.env.REDIS_URL ?? '';
  private readonly tickMs = Number(process.env.CAPSULES_TICK_MS ?? DEFAULT_CAPSULES_TICK_MS);
  /** В тестах автостарт выключен: тесты сами вызывают runOnce(). */
  private readonly autoStart =
    process.env.NODE_ENV !== 'test' && (process.env.CAPSULES_SCHEDULER ?? 'on') !== 'off';

  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private probe: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly capsules: CapsulesService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.autoStart) {
      this.logger.log('Планировщик капсул не стартует автоматически');
      return;
    }
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** Открывает все созревшие капсулы; возвращает id открытых этим тиком. */
  async runOnce(now: Date = new Date()): Promise<string[]> {
    if (this.running) return [];
    this.running = true;

    try {
      const due = await this.prisma.timeCapsule.findMany({
        where: { openedAt: null, openAt: { lte: now } },
        orderBy: { openAt: 'asc' },
      });

      const opened: string[] = [];
      for (const row of due) {
        const capsule = row as CapsuleRow;
        const snapshot = await this.capsules.snapshotFor(capsule);

        // CAS-захват: открывает только тот, кто увидел opened_at = null.
        const result = await this.prisma.timeCapsule.updateMany({
          where: { id: capsule.id, openedAt: null },
          data: { openedAt: now, snapshot: snapshot as unknown as Prisma.InputJsonValue },
        });
        if (result.count === 0) continue; // гонку проиграли — уведомление уже ушло

        await this.dispatcher
          .notifyCapsuleOpened(capsule.userId, { title: capsule.title })
          .catch((error) => {
            this.logger.warn(
              `Уведомление об открытии капсулы не доставлено: ${
                error instanceof Error ? error.message : 'unknown'
              }`,
            );
          });
        opened.push(capsule.id);
      }

      if (opened.length > 0) {
        this.logger.log(`Открыто капсул времени: ${opened.length}`);
      }
      return opened;
    } finally {
      this.running = false;
    }
  }

  private async start(): Promise<void> {
    if (this.redisUrl.length === 0) {
      this.logger.warn('REDIS_URL не задан — планировщик капсул работает по таймеру в процессе');
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

      this.queue = new Queue(CAPSULES_QUEUE, { connection: { url: this.redisUrl } });
      this.worker = new Worker(
        CAPSULES_QUEUE,
        async () => {
          await this.runOnce();
        },
        { connection: { url: this.redisUrl } },
      );
      this.worker.on('error', () => undefined);
      this.worker.on('failed', (_job, error) => {
        this.logger.warn(`Тик капсул не прошёл: ${error.message}`);
      });

      await this.queue.upsertJobScheduler(
        'capsules-tick',
        { every: this.tickMs },
        { name: 'tick', data: {} },
      );
      this.logger.log('Планировщик капсул: BullMQ/Valkey');
    } catch (error) {
      this.logger.warn(
        `Valkey недоступен (${
          error instanceof Error ? error.message : 'unknown'
        }) — планировщик капсул переходит на таймер в процессе`,
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
          `Ошибка тика капсул: ${error instanceof Error ? error.message : 'unknown'}`,
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
