// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Планировщик повторных доставок вебхуков (ТЗ §4). В продакшене задержанные
 * задачи идут через BullMQ (ioredis/Valkey); если Valkey недоступен или
 * REDIS_URL не задан — планировщик переходит на setTimeout в процессе, и
 * доставка продолжает работать. В тестах автостарт выключен.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { WEBHOOK_RETRY_BASE_MS } from '@puls/shared';

export const WEBHOOK_RETRY_QUEUE = 'puls-webhooks';

/** Экспоненциальная пауза перед попыткой N (1-based), мс. */
export function webhookRetryDelayMs(
  attempt: number,
  baseMs = Number(process.env.WEBHOOK_RETRY_BASE_MS ?? WEBHOOK_RETRY_BASE_MS),
): number {
  const exponent = Math.max(0, attempt - 1);
  return baseMs * 2 ** exponent;
}

type RetryHandler = (deliveryId: string) => Promise<void>;

@Injectable()
export class WebhookRetryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetryScheduler.name);
  private readonly redisUrl = process.env.REDIS_URL ?? '';
  private readonly autoStart =
    process.env.NODE_ENV !== 'test' && (process.env.WEBHOOK_SCHEDULER ?? 'on') !== 'off';

  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private probe: Redis | null = null;
  private readonly timers = new Set<NodeJS.Timeout>();
  private handler: RetryHandler | null = null;

  setHandler(handler: RetryHandler): void {
    this.handler = handler;
  }

  async onModuleInit(): Promise<void> {
    if (!this.autoStart) {
      this.logger.log('Планировщик вебхуков не стартует автоматически');
      return;
    }
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await this.stop();
  }

  /** Ставит повторную попытку с экспоненциальной задержкой. */
  schedule(deliveryId: string, attempt: number): void {
    const delay = webhookRetryDelayMs(attempt);

    if (this.queue) {
      void this.queue
        .add('retry', { deliveryId }, { delay, removeOnComplete: true, attempts: 1 })
        .catch(() => undefined);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.run(deliveryId);
    }, delay);
    timer.unref?.();
    this.timers.add(timer);
  }

  private async run(deliveryId: string): Promise<void> {
    try {
      await this.handler?.(deliveryId);
    } catch (error) {
      this.logger.warn(
        `Повторная доставка не удалась: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async start(): Promise<void> {
    if (this.redisUrl.length === 0) {
      this.logger.warn('REDIS_URL не задан — повторные доставки через таймер в процессе');
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

      this.queue = new Queue(WEBHOOK_RETRY_QUEUE, { connection: { url: this.redisUrl } });
      this.worker = new Worker(
        WEBHOOK_RETRY_QUEUE,
        async (job) => {
          const deliveryId = (job.data as { deliveryId?: string }).deliveryId;
          if (deliveryId) await this.run(deliveryId);
        },
        { connection: { url: this.redisUrl } },
      );
      this.worker.on('error', () => undefined);
      this.worker.on('failed', (job, error) => {
        this.logger.warn(`Задача вебхука не прошла: ${error.message}`);
      });
      this.logger.log('Планировщик вебхуков: BullMQ/Valkey');
    } catch (error) {
      this.logger.warn(
        `Valkey недоступен (${
          error instanceof Error ? error.message : 'unknown'
        }) — повторные доставки через таймер в процессе`,
      );
      await this.stop();
    }
  }

  private async stop(): Promise<void> {
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
