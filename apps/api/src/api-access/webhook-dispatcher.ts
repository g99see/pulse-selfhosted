// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WEBHOOK_EVENTS, WEBHOOK_MAX_ATTEMPTS, type WebhookEvent } from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SecretBoxService } from '../crypto/secret-box';
import { DomainEvents, type DomainEventMessage, type DomainEventHandler } from './domain-events';
import { WebhookSender } from './webhook-sender';
import { WebhookRetryScheduler } from './webhook-retry.scheduler';

const DELIVERY_KEEP = 50;

/** Сериализует данные события в JSON-значение Prisma (без undefined). */
function toJsonValue(data: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
}

/**
 * Подписчик доменных событий → исходящие вебхуки (ТЗ §4). На каждое событие
 * создаёт записи доставки для подходящих подписок и делает первую попытку;
 * неудачные попытки повторяются планировщиком с экспоненциальной паузой.
 */
@Injectable()
export class WebhookDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private readonly handlers = new Map<WebhookEvent, DomainEventHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBoxService,
    private readonly sender: WebhookSender,
    private readonly scheduler: WebhookRetryScheduler,
  ) {}

  onModuleInit(): void {
    this.scheduler.setHandler((deliveryId) => this.attempt(deliveryId));
    for (const event of WEBHOOK_EVENTS) {
      const handler: DomainEventHandler = (message) => {
        void this.dispatchMessage(message).catch((error) => {
          this.logger.warn(
            `Не удалось разослать событие ${event}: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        });
      };
      this.handlers.set(event, handler);
      DomainEvents.on(event, handler);
    }
  }

  onModuleDestroy(): void {
    for (const [event, handler] of this.handlers) {
      DomainEvents.off(event, handler);
    }
    this.handlers.clear();
  }

  /** Создаёт доставки для всех включённых подписок пользователя на событие. */
  async dispatchMessage(message: DomainEventMessage): Promise<void> {
    const webhooks = await this.prisma.webhook.findMany({
      where: {
        userId: message.userId,
        enabled: true,
        events: { has: message.event },
      },
    });
    for (const webhook of webhooks) {
      await this.enqueue(webhook.id, webhook.userId, message);
    }
  }

  private async enqueue(
    webhookId: string,
    userId: string,
    message: DomainEventMessage,
  ): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        webhookId,
        userId,
        event: message.event,
        status: 'pending',
        payload: toJsonValue(message.data),
      },
    });
    await this.trimDeliveries(webhookId);
    await this.attempt(delivery.id);
  }

  /**
   * Одна попытка доставки записи журнала. Публичный: планировщик ретраев и
   * тесты вызывают его напрямую.
   */
  async attempt(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });
    if (!delivery || delivery.status === 'success') return;

    const secret = this.secretBox.decrypt(delivery.webhook.secret);
    const body = JSON.stringify({
      event: delivery.event,
      deliveryId: delivery.id,
      occurredAt: delivery.createdAt.toISOString(),
      data: delivery.payload,
    });

    const result = await this.sender.send({
      url: delivery.webhook.url,
      secret,
      event: delivery.event,
      deliveryId: delivery.id,
      body,
    });
    const attempts = delivery.attempts + 1;

    if (result.ok) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'success', attempts, lastError: null },
      });
      return;
    }

    if (attempts >= WEBHOOK_MAX_ATTEMPTS) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed', attempts, lastError: result.error },
      });
      return;
    }

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'pending', attempts, lastError: result.error },
    });
    this.scheduler.schedule(delivery.id, attempts);
  }

  /** Хранит последние 50 доставок на вебхук. */
  private async trimDeliveries(webhookId: string): Promise<void> {
    const stale = await this.prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      skip: DELIVERY_KEEP,
      select: { id: true },
    });
    if (stale.length === 0) return;
    await this.prisma.webhookDelivery.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
  }
}
