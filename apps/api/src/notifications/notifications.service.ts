// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Правила уведомлений и web-push-подписки (ТЗ §3.6, §7). Всё привязано к
 * пользователю: чтение и запись идут только по его userId.
 */
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_CHANNELS,
  DEFAULT_QUIET_HOURS,
  NOTIFICATION_TYPES,
  defaultNotificationRule,
  type NotificationRuleConfig,
  type NotificationRuleInput,
  type NotificationType,
  type PushSubscriptionInput,
} from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scheduleJson, scheduleTimes, toRuleConfig } from './due';

export interface SubscriptionDto {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ----- Правила ----- */

  /** Эффективные правила: сохранённые значения поверх значений по умолчанию. */
  async listRules(userId: string): Promise<NotificationRuleConfig[]> {
    const stored = await this.prisma.notificationRule.findMany({ where: { userId } });

    return NOTIFICATION_TYPES.map((type) => {
      const row = stored.find((rule) => rule.type === type);
      const config = row ? toRuleConfig(row) : null;
      return config ?? defaultNotificationRule(type);
    });
  }

  /** Включает/выключает типы, правит расписание и тихие часы (bulk-upsert). */
  async updateRules(
    userId: string,
    inputs: readonly NotificationRuleInput[],
  ): Promise<NotificationRuleConfig[]> {
    for (const input of inputs) {
      const existing = await this.prisma.notificationRule.findFirst({
        where: { userId, type: input.type },
      });

      const channel = input.channel ?? existing?.channel ?? DEFAULT_CHANNELS[input.type];
      const times = input.times ?? scheduleTimes(existing?.schedule);
      const quietHours = input.quietHours ?? {
        start: existing?.quietHoursStart ?? DEFAULT_QUIET_HOURS.start,
        end: existing?.quietHoursEnd ?? DEFAULT_QUIET_HOURS.end,
      };

      const data = {
        channel,
        enabled: input.enabled,
        schedule: scheduleJson(times),
        quietHoursStart: quietHours.start,
        quietHoursEnd: quietHours.end,
      };

      if (existing) {
        await this.prisma.notificationRule.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.notificationRule.create({
          data: { userId, type: input.type as NotificationType, ...data },
        });
      }
    }

    return this.listRules(userId);
  }

  /* ----- Подписки ----- */

  async listSubscriptions(userId: string): Promise<SubscriptionDto[]> {
    const rows = await this.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSubscriptionDto);
  }

  /** Сохраняет подписку; повторная подписка на тот же endpoint обновляет её. */
  async saveSubscription(userId: string, input: PushSubscriptionInput): Promise<SubscriptionDto> {
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
      },
      update: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
      },
    });
    return toSubscriptionDto(row);
  }

  /** Удаляет подписку только владельца; false — если чужая или отсутствует. */
  async deleteSubscription(userId: string, endpoint: string): Promise<boolean> {
    const row = await this.prisma.pushSubscription.findUnique({ where: { endpoint } });
    if (!row || row.userId !== userId) return false;

    await this.prisma.pushSubscription.delete({ where: { endpoint } });
    return true;
  }
}

function toSubscriptionDto(row: {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: Date;
}): SubscriptionDto {
  return {
    id: row.id,
    endpoint: row.endpoint,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}
