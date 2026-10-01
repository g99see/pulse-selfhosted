// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Модуль регулярных платежей (ТЗ §3.2). Вынесен отдельно, чтобы не замыкать
 * цикл модулей: FinanceModule предоставляет счета/транзакции, NotificationsModule
 * — диспетчер напоминаний; сам FinanceModule NotificationsModule не импортирует.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from './finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecurringController } from './recurring.controller';
import { RecurringScheduler } from './recurring.scheduler';
import { RecurringService } from './recurring.service';

@Module({
  imports: [AuthModule, FinanceModule, NotificationsModule],
  controllers: [RecurringController],
  providers: [RecurringService, RecurringScheduler],
  exports: [RecurringService, RecurringScheduler],
})
export class RecurringModule {}
