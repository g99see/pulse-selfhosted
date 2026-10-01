// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Планировщик уведомлений (ТЗ §3.6, §9). Тик раз в минуту выбирает
 * «созревшие» уведомления и отправляет их через диспетчер. В продакшене тик
 * идёт через BullMQ (ioredis/Valkey); если Valkey недоступен или REDIS_URL не
 * задан, планировщик переходит на таймер в процессе — API продолжает работать.
 * В тестах автостарт выключен, тесты вызывают runOnce() напрямую.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcher } from './dispatcher';
import { dueDeliveriesForUser, type DueDelivery } from './due';

export const NOTIFICATIONS_QUEUE = 'puls-notifications';
export const DEFAULT_TICK_MS = 60_000;

@Injectable()
export class NotificationsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsScheduler.name);
  private readonly redisUrl = process.env.REDIS_URL ?? '';
  private readonly tickMs = Number(process.env.NOTIFICATIONS_TICK_MS ?? DEFAULT_TICK_MS);
  /** В тестах автостарт выключен: тесты сами вызывают runOnce(). */
  private readonly autoStart =
    process.env.NODE_ENV !== 'test' && (process.env.NOTIFICATIONS_SCHEDULER ?? 'on') !== 'off';

  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private probe: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastRunAt: Date | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.autoStart) {
      this.logger.log('Планировщик уведомлений не стартует автоматически');
      return;
    }
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** Выбирает и отправляет уведомления за окно (from, to]. Идемпотентно по времени. */
  async runOnce(now: Date = new Date(), from?: Date): Promise<DueDelivery[]> {
    if (this.running) return [];
    this.running = true;

    try {
      const to = now;
      const windowFrom = from ?? this.lastRunAt ?? new Date(now.getTime() - this.tickMs);

      const users = await this.prisma.user.findMany({
        where: { notificationsEnabled: true },
        include: { notificationRules: true },
      });

      const dispatched: DueDelivery[] = [];
      for (const user of users) {
        const deliveries = dueDeliveriesForUser(user, {
          from: windowFrom,
          to,
          timezone: user.timezone,
        });
        for (const delivery of deliveries) {
          await this.dispatcher.dispatch(delivery, {
            now,
            email: user.email,
            timezone: user.timezone,
          });
          dispatched.push(delivery);
        }
      }

      this.lastRunAt = now;
      if (dispatched.length > 0) {
        this.logger.log(`Отправлено уведомлений: ${dispatched.length}`);
      }
      return dispatched;
    } finally {
      this.running = false;
    }
  }

  private async start(): Promise<void> {
    if (this.redisUrl.length === 0) {
      this.logger.warn('REDIS_URL не задан — планировщик работает по таймеру в процессе');
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

      this.queue = new Queue(NOTIFICATIONS_QUEUE, { connection: { url: this.redisUrl } });
      this.worker = new Worker(
        NOTIFICATIONS_QUEUE,
        async () => {
          await this.runOnce();
        },
        { connection: { url: this.redisUrl } },
      );
      this.worker.on('error', () => undefined);
      this.worker.on('failed', (job, error) => {
        this.logger.warn(`Тик уведомлений не прошёл: ${error.message}`);
      });

      await this.queue.upsertJobScheduler(
        'notifications-tick',
        { every: this.tickMs },
        { name: 'tick', data: {} },
      );
      this.logger.log('Планировщик уведомлений: BullMQ/Valkey');
    } catch (error) {
      this.logger.warn(
        `Valkey недоступен (${
          error instanceof Error ? error.message : 'unknown'
        }) — планировщик переходит на таймер в процессе`,
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
          `Ошибка тика планировщика: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
    }, this.tickMs);
    // Таймер не должен удерживать процесс при завершении.
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
