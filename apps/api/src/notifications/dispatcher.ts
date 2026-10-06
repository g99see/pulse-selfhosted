// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Постановка уведомлений в outbox (ТЗ §3.6, v2 §5). Диспетчер выбирает каналы
 * пользователя (привязан, не заблокирован, включён, тип включён), собирает
 * сообщение и кладёт его в очередь; фактическая отправка — воркер OutboxService.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_CHANNELS,
  type ChannelSettingsConfig,
  type NotificationChannel,
  type NotificationType,
} from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StatsService } from '../stats/stats.service';
import { channelTimezone, toChannelConfig, type DueDelivery } from './due';
import {
  buildBudgetAlert,
  buildCapsuleOpenedNotification,
  buildDailySummary,
  buildMessage,
  buildPostActivityNotification,
  buildReconciliationMismatch,
  buildRecurringReminder,
  type BudgetAlertInfo,
  type CapsuleOpenedInfo,
  type NotificationMessage,
  type PostActivityInfo,
  type ReconciliationMismatchInfo,
  type RecurringReminderInfo,
} from './messages';
import { OutboxService } from './outbox.service';

export interface DeliveryContext {
  now: Date;
  timezone: string;
}

export interface DeliveryDispatcher {
  dispatch(delivery: DueDelivery, context: DeliveryContext): Promise<boolean>;
}

/** Канал пользователя, готовый к доставке. */
export interface ActiveChannel {
  config: ChannelSettingsConfig;
  timezone: string;
}

@Injectable()
export class NotificationDispatcher implements DeliveryDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly stats: StatsService,
  ) {}

  /** Каналы, куда можно доставлять: привязан, не заблокирован и включён. */
  async activeChannels(userId: string): Promise<ActiveChannel[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        notificationRules: true,
        notificationChannelSettings: true,
        telegramLink: true,
        discordLink: true,
      },
    });
    if (!user || !user.notificationsEnabled) return [];

    const linked: Record<NotificationChannel, boolean> = {
      telegram: user.telegramLink !== null && user.telegramLink.blockedAt === null,
      discord: user.discordLink !== null && user.discordLink.blockedAt === null,
    };

    return NOTIFICATION_CHANNELS.filter((channel) => linked[channel])
      .map((channel) => {
        const stored = user.notificationChannelSettings.find((item) => item.channel === channel);
        const config = toChannelConfig(channel, stored, user.notificationRules);
        return { config, timezone: channelTimezone(config, user.timezone) };
      })
      .filter((item) => item.config.enabled);
  }

  /** Ставит сообщение во все подходящие каналы; возвращает число записей. */
  async notify(
    userId: string,
    type: NotificationType,
    message: NotificationMessage,
    now?: Date,
  ): Promise<number> {
    const channels = await this.activeChannels(userId);
    let queued = 0;
    for (const { config, timezone } of channels) {
      if (!config.types[type]) continue;
      await this.outbox.enqueue(userId, config.channel, message, {
        timezone,
        quietHours: config.quietHours,
        now,
      });
      queued += 1;
    }
    return queued;
  }

  /** Плановое уведомление (чек-ин, итог дня) в конкретный канал — из планировщика. */
  async dispatch(delivery: DueDelivery, context: DeliveryContext): Promise<boolean> {
    const message =
      delivery.type === 'daily_summary'
        ? buildDailySummary(await this.stats.day(delivery.userId))
        : buildMessage(delivery.type, { now: context.now, timezone: context.timezone });

    // Слот уже вне тихих часов (due.ts сдвигает), поэтому отправляем сразу.
    await this.outbox.enqueue(delivery.userId, delivery.channel, message, { now: context.now });
    return true;
  }

  /** Напоминание о регулярном платеже за день до списания (ТЗ §3.2). */
  async sendRecurringReminder(userId: string, info: RecurringReminderInfo): Promise<boolean> {
    const reminder = buildRecurringReminder(info);
    const queued = await this.notify(userId, 'payments', {
      type: 'payments',
      title: reminder.title,
      body: reminder.body,
      url: reminder.url,
    });
    return queued > 0;
  }

  /** Реакция или комментарий к посту (ТЗ §3.7). */
  async notifyPostActivity(userId: string, info: PostActivityInfo): Promise<boolean> {
    return (await this.notify(userId, 'reactions', buildPostActivityNotification(info))) > 0;
  }

  /** Открылась капсула времени (ТЗ §4, P2): тип вне переключателей — идёт в любой активный канал. */
  async notifyCapsuleOpened(userId: string, info: CapsuleOpenedInfo): Promise<boolean> {
    const channels = await this.activeChannels(userId);
    const message = buildCapsuleOpenedNotification(info);
    for (const { config, timezone } of channels) {
      await this.outbox.enqueue(userId, config.channel, message, {
        timezone,
        quietHours: config.quietHours,
      });
    }
    return channels.length > 0;
  }

  /** Бюджет достиг 80% или превышен. */
  async notifyBudgetAlert(userId: string, info: BudgetAlertInfo): Promise<boolean> {
    const message = buildBudgetAlert(info);
    return message ? (await this.notify(userId, 'budget', message)) > 0 : false;
  }

  /** Недельный отчёт готов. */
  async notifyWeeklyReport(userId: string, now: Date, timezone: string): Promise<boolean> {
    return (
      (await this.notify(
        userId,
        'weekly_report',
        buildMessage('weekly_report', { now, timezone }),
        now,
      )) > 0
    );
  }

  /**
   * Хук для сверки счетов: любой код может сообщить о расхождении баланса и
   * суммы операций — уведомление уйдёт в каналы с включённым типом
   * reconciliation_mismatch.
   */
  async notifyReconciliationMismatch(
    userId: string,
    info: ReconciliationMismatchInfo,
  ): Promise<boolean> {
    return (
      (await this.notify(userId, 'reconciliation_mismatch', buildReconciliationMismatch(info))) > 0
    );
  }
}
