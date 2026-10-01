// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Webhook } from '@prisma/client';
import {
  WEBHOOK_EVENTS,
  type WebhookCreatedDto,
  type WebhookDeliveriesResponse,
  type WebhookDeliveryDto,
  type WebhookDto,
  type WebhookEvent,
  type WebhooksResponse,
  type WebhookTestResponse,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { SecretBoxService } from '../crypto/secret-box';
import { assertSafeWebhookUrl, allowPrivateWebhooks } from './ssrf';
import { WebhookSender } from './webhook-sender';

const DELIVERY_PAGE_SIZE = 50;

/** Подписки на вебхуки (ТЗ §4): CRUD, проверка и журнал доставок. */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBoxService,
    private readonly sender: WebhookSender,
  ) {}

  private toDto(webhook: Webhook): WebhookDto {
    return {
      id: webhook.id,
      url: webhook.url,
      events: (webhook.events as WebhookEvent[]).filter((event) =>
        WEBHOOK_EVENTS.includes(event),
      ),
      enabled: webhook.enabled,
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt.toISOString(),
    };
  }

  async list(userId: string): Promise<WebhooksResponse> {
    const webhooks = await this.prisma.webhook.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { webhooks: webhooks.map((webhook) => this.toDto(webhook)) };
  }

  /** Создаёт подписку: секрет подписи возвращается ровно один раз. */
  async create(
    userId: string,
    input: { url: string; events: WebhookEvent[]; enabled: boolean },
  ): Promise<WebhookCreatedDto> {
    await assertSafeWebhookUrl(input.url, { allowPrivate: allowPrivateWebhooks() });

    const secret = randomBytes(32).toString('base64url');
    const created = await this.prisma.webhook.create({
      data: {
        userId,
        url: input.url,
        secret: this.secretBox.encrypt(secret),
        events: input.events,
        enabled: input.enabled,
      },
    });

    return { ...this.toDto(created), secret };
  }

  /** Возвращает вебхук владельца либо 404. */
  async resolveOwned(userId: string, id: string): Promise<Webhook> {
    const webhook = await this.prisma.webhook.findFirst({ where: { id, userId } });
    if (!webhook) {
      throw httpError(404, 'webhook_not_found', 'Вебхук не найден');
    }
    return webhook;
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.webhook.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw httpError(404, 'webhook_not_found', 'Вебхук не найден');
    }
  }

  /** Журнал последних доставок вебхука (до 50). */
  async deliveries(userId: string, id: string): Promise<WebhookDeliveriesResponse> {
    await this.resolveOwned(userId, id);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: DELIVERY_PAGE_SIZE,
    });
    const deliveries: WebhookDeliveryDto[] = rows.map((row) => ({
      id: row.id,
      event: row.event as WebhookEvent,
      status: row.status as WebhookDeliveryDto['status'],
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    }));
    return { deliveries };
  }

  /** Кнопка «Проверить»: отправляет ping тем же способом, что и события. */
  async test(userId: string, id: string): Promise<WebhookTestResponse> {
    const webhook = await this.resolveOwned(userId, id);
    const secret = this.secretBox.decrypt(webhook.secret);
    const deliveryId = `test-${randomBytes(6).toString('hex')}`;
    const body = JSON.stringify({
      event: 'ping',
      deliveryId,
      occurredAt: new Date().toISOString(),
      data: {},
    });

    const result = await this.sender.send({
      url: webhook.url,
      secret,
      event: 'ping',
      deliveryId,
      body,
    });
    return { ok: result.ok, status: result.status, error: result.error };
  }
}
