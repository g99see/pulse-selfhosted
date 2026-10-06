// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DiscordModule } from '../discord/discord.module';
import { FinanceModule } from '../finance/finance.module';
import { RolesGuard } from '../moderation/roles.guard';
import { StatsModule } from '../stats/stats.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BudgetAlerts } from './budget-alerts';
import { NotificationDispatcher } from './dispatcher';
import { NotificationsAdminController, NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ReconciliationAlerts } from './reconciliation-alerts';
import { OutboxService } from './outbox.service';
import { NotificationsScheduler } from './scheduler';

/** Уведомления (ТЗ §3.6, v2 §5): каналы, outbox, планировщик и воркер доставки. */
@Module({
  imports: [AuthModule, TelegramModule, DiscordModule, StatsModule, FinanceModule],
  controllers: [NotificationsController, NotificationsAdminController],
  providers: [
    NotificationsService,
    OutboxService,
    NotificationDispatcher,
    NotificationsScheduler,
    BudgetAlerts,
    ReconciliationAlerts,
    RolesGuard,
  ],
  exports: [NotificationsService, OutboxService, NotificationDispatcher, NotificationsScheduler],
})
export class NotificationsModule {}
