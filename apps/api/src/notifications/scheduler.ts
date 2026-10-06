// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Планировщик уведомлений (ТЗ §3.6, §9). Тик раз в минуту выбирает
 * «созревшие» плановые уведомления и ставит их в outbox; отдельный воркер
 * (каждые NOTIFICATIONS_WORKER_MS, по умолчанию 15 с) отправляет очередь. В продакшене тик
 * идёт через BullMQ (ioredis/Valkey); если Valkey недоступен или REDIS_URL не
 * задан, планировщик переходит на таймер в процессе — API продолжает работать.
 * В тестах автостарт выключен, тесты вызывают runOnce() напрямую.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { runtimeStats } from '../observability/runtime-stats';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATION_CHANNELS } from '@puls/shared';
import { NotificationDispatcher } from './dispatcher';
import { dueDeliveriesForUser, toChannelConfig, type DueDelivery } from './due';
import { OutboxService } from './outbox.service';

export const NOTIFICATIONS_QUEUE = 'puls-notifications';
export const DEFAULT_TICK_MS = 60_000;
export const DEFAULT_WORKER_MS = 15_000;

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
  private readonly workerMs = Number(process.env.NOTIFICATIONS_WORKER_MS ?? DEFAULT_WORKER_MS);
  private timer: NodeJS.Timeout | null = null;
  private workerTimer: NodeJS.Timeout | null = null;
  private workerRunning = false;
  private lastRunAt: Date | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
    private readonly outbox: OutboxService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.autoStart) {
      this.logger.log('Планировщик уведомлений не стартует автоматически');
      return;
    }
    this.startWorker();
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
        include: {
          notificationRules: true,
          notificationChannelSettings: true,
          telegramLink: true,
          discordLink: true,
        },
      });

      const dispatched: DueDelivery[] = [];
      for (const user of users) {
        // Только каналы, куда можно доставить: привязан и не заблокирован.
        const linked = {
          telegram: user.telegramLink !== null && user.telegramLink.blockedAt === null,
          discord: user.discordLink !== null && user.discordLink.blockedAt === null,
        };
        const channels = NOTIFICATION_CHANNELS.filter((channel) => linked[channel]).map((channel) =>
          toChannelConfig(
            channel,
            user.notificationChannelSettings.find((item) => item.channel === channel),
            user.notificationRules,
          ),
        );
        const deliveries = dueDeliveriesForUser(
          { id: user.id, timezone: user.timezone, channels },
          { from: windowFrom, to },
        );
        for (const delivery of deliveries) {
          const timezone =
            channels.find((item) => item.channel === delivery.channel)?.timezone ?? user.timezone;
          await this.dispatcher.dispatch(delivery, { now, timezone });
          dispatched.push(delivery);
        }
      }

      this.lastRunAt = now;
      runtimeStats.markSchedulerRun(now);
      if (dispatched.length > 0) {
        this.logger.log(`Отправлено уведомлений: ${dispatched.length}`);
      }
      return dispatched;
    } finally {
      this.running = false;
    }
  }

  /** Воркер outbox: раз в workerMs отправляет созревшие записи очереди. */
  private startWorker(): void {
    if (this.workerTimer) return;
    this.workerTimer = setInterval(() => {
      if (this.workerRunning) return;
      this.workerRunning = true;
      void this.outbox
        .processQueue()
        .catch((error: unknown) => {
          this.logger.warn(
            `Ошибка воркера уведомлений: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        })
        .finally(() => {
          this.workerRunning = false;
        });
    }, this.workerMs);
    this.workerTimer.unref?.();
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
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
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
