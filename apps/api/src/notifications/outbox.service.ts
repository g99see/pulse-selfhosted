// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Outbox уведомлений: запись NotificationDelivery ставится в очередь и уходит
 * воркером с экспоненциальным backoff (до 5 попыток). Если мессенджер ответил
 * «бот заблокирован» (Telegram 403 / Discord 50007), привязка помечается
 * заблокированной, а оставшиеся записи пользователя в этом канале — blocked.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DELIVERY_STATUSES,
  nextAllowedTime,
  type DeliveryStatus,
  type NotificationChannel,
  type NotificationDeliveryDto,
  type NotificationMetricsResponse,
} from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';
import { moodKeyboard } from '../telegram/commands';
import { TelegramService } from '../telegram/telegram.service';
import { DiscordService } from '../discord/discord.service';
import type { NotificationMessage } from './messages';
import { DeliveryError, stateAfterFailure } from './outbox-logic';

/** Сколько записей воркер берёт за один проход. */
const BATCH_SIZE = 50;
/** Аренда записи на время отправки: упавший процесс не потеряет её навсегда. */
const LEASE_MS = 2 * 60 * 1000;
/** Сколько записей журнала видит пользователь. */
export const DELIVERY_LOG_LIMIT = 20;

export interface EnqueueOptions {
  /** Часовой пояс и тихие часы канала: отправка откладывается до конца тихих часов. */
  timezone?: string;
  quietHours?: { start: number; end: number };
  now?: Date;
}

export interface ProcessResult {
  sent: number;
  failed: number;
  blocked: number;
  retried: number;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly discord: DiscordService,
  ) {}

  async enqueue(
    userId: string,
    channel: NotificationChannel,
    message: NotificationMessage,
    options: EnqueueOptions = {},
  ): Promise<string> {
    const now = options.now ?? new Date();
    const at = options.quietHours
      ? nextAllowedTime(now, options.timezone ?? 'UTC', options.quietHours)
      : now;
    const row = await this.prisma.notificationDelivery.create({
      data: {
        userId,
        channel,
        type: message.type,
        payload: message as unknown as Prisma.InputJsonValue,
        nextAttemptAt: at,
      },
    });
    return row.id;
  }

  /** Обрабатывает созревшие записи; возвращает счётчики исходов. */
  async processQueue(now: Date = new Date()): Promise<ProcessResult> {
    const result: ProcessResult = { sent: 0, failed: 0, blocked: 0, retried: 0 };
    const due = await this.prisma.notificationDelivery.findMany({
      where: { status: 'queued', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const item of due) {
      // Захват записи: параллельные воркеры не отправят одно сообщение дважды.
      const claimed = await this.prisma.notificationDelivery.updateMany({
        where: { id: item.id, status: 'queued', nextAttemptAt: { lte: now } },
        data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
      });
      if (claimed.count === 0) continue;

      try {
        await this.send(item.userId, item.channel as NotificationChannel, toMessage(item.payload));
        await this.prisma.notificationDelivery.update({
          where: { id: item.id },
          data: { status: 'sent', attempts: item.attempts + 1, sentAt: now, lastError: null },
        });
        result.sent += 1;
      } catch (error) {
        const state = stateAfterFailure(item.attempts, error, now);
        await this.prisma.notificationDelivery.update({
          where: { id: item.id },
          data: state,
        });
        if (state.status === 'blocked') {
          result.blocked += 1;
          await this.blockChannel(
            item.userId,
            item.channel as NotificationChannel,
            state.lastError,
          );
        } else if (state.status === 'failed') {
          result.failed += 1;
        } else {
          result.retried += 1;
        }
        this.logger.warn(`Доставка ${item.id} (${item.channel}): ${state.lastError}`);
      }
    }
    return result;
  }

  /** Отправка одной записи через канал; бросает DeliveryError. */
  private async send(
    userId: string,
    channel: NotificationChannel,
    message: NotificationMessage,
  ): Promise<void> {
    const text = `${message.title}\n${message.body}`;
    if (channel === 'telegram') {
      await this.telegram.deliver(
        userId,
        text,
        message.kind === 'checkin' ? moodKeyboard() : undefined,
      );
      return;
    }
    if (channel === 'discord') {
      await this.discord.deliver(userId, text);
      return;
    }
    throw new DeliveryError(`неизвестный канал ${String(channel)}`, { blocked: true });
  }

  /** Привязка закрыта для бота: останавливаем канал и гасим очередь пользователя в нём. */
  private async blockChannel(
    userId: string,
    channel: NotificationChannel,
    reason: string,
  ): Promise<void> {
    if (channel === 'telegram') await this.telegram.markBlocked(userId);
    if (channel === 'discord') await this.discord.markBlocked(userId);
    await this.prisma.notificationDelivery.updateMany({
      where: { userId, channel, status: 'queued' },
      data: { status: 'blocked', lastError: reason },
    });
  }

  /* ----- Журнал и метрики ----- */

  async recent(userId: string): Promise<NotificationDeliveryDto[]> {
    const rows = await this.prisma.notificationDelivery.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: DELIVERY_LOG_LIMIT,
    });
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel as NotificationChannel,
      type: row.type,
      status: row.status as DeliveryStatus,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
    }));
  }

  async metrics(): Promise<NotificationMetricsResponse> {
    const groups = await this.prisma.notificationDelivery.groupBy({
      by: ['channel', 'status'],
      _count: { _all: true },
    });
    const empty = () =>
      Object.fromEntries(DELIVERY_STATUSES.map((status) => [status, 0])) as Record<
        DeliveryStatus,
        number
      >;
    const counts = empty();
    const byChannel: Record<string, Record<DeliveryStatus, number>> = {};
    for (const group of groups) {
      const status = group.status as DeliveryStatus;
      if (!DELIVERY_STATUSES.includes(status)) continue;
      counts[status] += group._count._all;
      byChannel[group.channel] ??= empty();
      byChannel[group.channel]![status] += group._count._all;
    }
    return { counts, byChannel };
  }
}

function toMessage(payload: unknown): NotificationMessage {
  const value = (payload ?? {}) as Partial<NotificationMessage>;
  return {
    type: value.type ?? 'unknown',
    title: value.title ?? '',
    body: value.body ?? '',
    url: value.url,
    kind: value.kind,
  };
}
