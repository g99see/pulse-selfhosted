// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Настройки уведомлений (ТЗ §3.6, v2 §5): состояние каналов Telegram/Discord
 * (привязка, включение, расписание, тихие часы, часовой пояс, типы) и правила
 * по типам. Всё привязано к пользователю.
 */
import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type ChannelSettingsUpdateInput,
  type NotificationChannel,
  type NotificationChannelStatus,
  type NotificationType,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { scheduleJson, toChannelConfig, scheduleSummaryTime, scheduleTimes } from './due';

export interface RuleUpdate {
  type: NotificationType;
  enabled: boolean;
  times?: string[];
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Статус всех каналов: настройки + привязка. */
  async listChannels(userId: string): Promise<NotificationChannelStatus[]> {
    const [rules, settings, telegram, discord] = await Promise.all([
      this.prisma.notificationRule.findMany({ where: { userId } }),
      this.prisma.notificationChannelSetting.findMany({ where: { userId } }),
      this.prisma.telegramLink.findUnique({ where: { userId } }),
      this.prisma.discordLink.findUnique({ where: { userId } }),
    ]);

    return NOTIFICATION_CHANNELS.map((channel) => {
      const config = toChannelConfig(
        channel,
        settings.find((item) => item.channel === channel),
        rules,
      );
      const link = channel === 'telegram' ? telegram : discord;
      const configured =
        channel === 'telegram'
          ? (process.env.TELEGRAM_BOT_TOKEN ?? '').length > 0
          : (process.env.DISCORD_BOT_TOKEN ?? '').length > 0;
      return {
        ...config,
        configured,
        linked: link !== null,
        blocked: link?.blockedAt != null,
        accountLabel: link?.username ?? null,
      };
    });
  }

  /** Частичное обновление настроек канала и включения типов. */
  async updateChannel(
    userId: string,
    channel: NotificationChannel,
    input: ChannelSettingsUpdateInput,
  ): Promise<NotificationChannelStatus[]> {
    if (input.timezone && !isValidTimezone(input.timezone)) {
      throw httpError(400, 'invalid_timezone', 'Неизвестный часовой пояс');
    }

    const existing = await this.prisma.notificationChannelSetting.findUnique({
      where: { userId_channel: { userId, channel } },
    });
    const times = input.times ?? scheduleTimes(existing?.schedule);
    const summaryTime = input.summaryTime ?? scheduleSummaryTime(existing?.schedule);

    const data = {
      enabled: input.enabled ?? existing?.enabled ?? true,
      schedule: scheduleJson(times, summaryTime),
      quietStart: input.quietHours?.start ?? existing?.quietStart ?? 22,
      quietEnd: input.quietHours?.end ?? existing?.quietEnd ?? 8,
      timezone: input.timezone === undefined ? (existing?.timezone ?? null) : input.timezone,
    };
    await this.prisma.notificationChannelSetting.upsert({
      where: { userId_channel: { userId, channel } },
      create: { userId, channel, ...data },
      update: data,
    });

    for (const [type, enabled] of Object.entries(input.types ?? {})) {
      if (!(NOTIFICATION_TYPES as readonly string[]).includes(type)) continue;
      await this.prisma.notificationRule.upsert({
        where: { userId_type_channel: { userId, type, channel } },
        create: { userId, type, channel, enabled },
        update: { enabled },
      });
    }

    return this.listChannels(userId);
  }

  /**
   * Правило по типу для ИИ-помощника («напомни про бюджет»): включает или
   * выключает тип в привязанных каналах (если привязок нет — в Telegram), а
   * времена применяет к расписанию чек-инов канала.
   */
  async updateRules(userId: string, inputs: readonly RuleUpdate[]): Promise<void> {
    const [telegram, discord] = await Promise.all([
      this.prisma.telegramLink.findUnique({ where: { userId } }),
      this.prisma.discordLink.findUnique({ where: { userId } }),
    ]);
    const targets: NotificationChannel[] = [];
    if (telegram) targets.push('telegram');
    if (discord) targets.push('discord');
    if (targets.length === 0) targets.push('telegram');

    for (const channel of targets) {
      for (const input of inputs) {
        await this.updateChannel(userId, channel, {
          types: { [input.type]: input.enabled },
          ...(input.type === 'checkins' && input.times ? { times: input.times } : {}),
        });
      }
    }
  }
}
