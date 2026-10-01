// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Доставка «созревших» уведомлений (ТЗ §3.6, §9): push — по всем подпискам
 * пользователя (просроченные удаляются), email — через существующий MailService.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, NotificationType } from '@puls/shared';
import { MailService } from '../auth/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { moodKeyboard } from '../telegram/commands';
import { TelegramService } from '../telegram/telegram.service';
import type { DueDelivery } from './due';
import {
  buildCapsuleOpenedNotification,
  buildNotificationEmail,
  buildPostActivityNotification,
  buildPushPayload,
  buildRecurringReminder,
  type CapsuleOpenedInfo,
  type PostActivityInfo,
  type RecurringReminderInfo,
} from './messages';
import { PushService, type PushPayload } from './push.service';

export interface DeliveryContext {
  now: Date;
  email: string;
  timezone: string;
}

export interface DeliveryDispatcher {
  dispatch(delivery: DueDelivery, context: DeliveryContext): Promise<boolean>;
}

@Injectable()
export class NotificationDispatcher implements DeliveryDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
  ) {}

  async dispatch(delivery: DueDelivery, context: DeliveryContext): Promise<boolean> {
    if (delivery.channel === 'email') {
      return this.sendEmail(delivery.type, context);
    }
    if (delivery.channel === 'telegram') {
      return this.sendTelegram(delivery, context);
    }
    return this.sendPush(delivery, context);
  }

  private async sendEmail(type: NotificationType, context: DeliveryContext): Promise<boolean> {
    const message = buildNotificationEmail(type, {
      now: context.now,
      timezone: context.timezone,
    });
    await this.mail.sendNotification(context.email, message);
    return true;
  }

  private async sendPush(delivery: DueDelivery, context: DeliveryContext): Promise<boolean> {
    const payload = buildPushPayload(delivery.type, {
      now: context.now,
      timezone: context.timezone,
    });
    return this.deliverPush(delivery.userId, payload);
  }

  /**
   * Канал telegram (ТЗ §3.6): отправка в привязанный чат. Чек-ин-вопрос несёт
   * inline-кнопки 1–5, чтобы ответить прямо из сообщения (ТЗ §3.3).
   */
  private async sendTelegram(delivery: DueDelivery, context: DeliveryContext): Promise<boolean> {
    const payload = buildPushPayload(delivery.type, {
      now: context.now,
      timezone: context.timezone,
    });
    const buttons = delivery.type === 'checkins' ? moodKeyboard() : undefined;
    return this.telegram.sendToUser(
      delivery.userId,
      `${payload.title}\n${payload.body}`,
      buttons,
    );
  }

  /**
   * Напоминание о конкретном регулярном платеже за день до списания (ТЗ §3.2).
   * Канал берётся из правил пользователя; текст — из buildRecurringReminder.
   */
  async sendRecurringReminder(
    userId: string,
    context: DeliveryContext & { channel: NotificationChannel },
    info: RecurringReminderInfo,
  ): Promise<boolean> {
    const reminder = buildRecurringReminder(info);
    if (context.channel === 'email') {
      await this.mail.sendNotification(context.email, {
        subject: `Пульс: ${reminder.title}`,
        text: `${reminder.title}\n\n${reminder.body}`,
        kind: 'notification:payments',
        link: reminder.url,
      });
      return true;
    }
    const payload: PushPayload = {
      type: 'payments',
      title: reminder.title,
      body: reminder.body,
      data: { url: reminder.url },
    };
    return this.deliverPush(userId, payload);
  }

  /**
   * Уведомление владельцу поста о реакции или комментарии (ТЗ §3.7). Уважает
   * общий переключатель уведомлений пользователя; тип — reactions.
   */
  async notifyPostActivity(userId: string, info: PostActivityInfo): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationsEnabled: true },
    });
    if (!user?.notificationsEnabled) return false;

    return this.deliverPush(userId, buildPostActivityNotification(info));
  }

  /**
   * Уведомление владельцу об открытии капсулы времени (ТЗ §4, P2). Уважает
   * общий переключатель уведомлений; ссылка ведёт на экран капсул.
   */
  async notifyCapsuleOpened(userId: string, info: CapsuleOpenedInfo): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationsEnabled: true },
    });
    if (!user?.notificationsEnabled) return false;

    return this.deliverPush(userId, buildCapsuleOpenedNotification(info));
  }

  /** Отправляет payload по всем подпискам пользователя, удаляя просроченные. */
  private async deliverPush(userId: string, payload: PushPayload): Promise<boolean> {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) return false;

    let delivered = false;
    for (const subscription of subscriptions) {
      const result = await this.push.send(
        {
          id: subscription.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        payload,
      );

      if (result.expired) {
        await this.prisma.pushSubscription
          .delete({ where: { id: subscription.id } })
          .catch(() => undefined);
        this.logger.log(`Удалена просроченная подписка ${subscription.id}`);
      } else if (result.ok) {
        delivered = true;
      } else {
        this.logger.warn(`Push не доставлен (${subscription.id}): ${result.error ?? 'unknown'}`);
      }
    }

    return delivered;
  }
}
