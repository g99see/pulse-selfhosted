// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationDispatcher } from './dispatcher';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { NotificationsScheduler } from './scheduler';

/** Уведомления (ТЗ §3.6, §9): правила, подписки web push и планировщик. */
@Module({
  imports: [AuthModule, TelegramModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushService, NotificationDispatcher, NotificationsScheduler],
  exports: [NotificationsService, PushService, NotificationDispatcher, NotificationsScheduler],
})
export class NotificationsModule {}
