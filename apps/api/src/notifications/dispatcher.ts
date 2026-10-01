// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Доставка «созревших» уведомлений (ТЗ §3.6, §9): push — по всем подпискам
 * пользователя (просроченные удаляются), email — через существующий MailService.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@puls/shared';
import { MailService } from '../auth/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { DueDelivery } from './due';
import { buildNotificationEmail, buildPushPayload } from './messages';
import { PushService } from './push.service';

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
  ) {}

  async dispatch(delivery: DueDelivery, context: DeliveryContext): Promise<boolean> {
    if (delivery.channel === 'email') {
      return this.sendEmail(delivery.type, context);
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
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: delivery.userId },
    });
    if (subscriptions.length === 0) return false;

    const payload = buildPushPayload(delivery.type, {
      now: context.now,
      timezone: context.timezone,
    });

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
