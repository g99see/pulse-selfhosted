// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Модуль Telegram-бота (ТЗ §3.6, §4). Клиент Telegram создаётся фабрикой по
 * переменной окружения: без токена — заглушка, модуль неактивен и это видно в
 * логах, но API продолжает работать (ТЗ §10).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CheckinsModule } from '../checkins/checkins.module';
import { FinanceModule } from '../finance/finance.module';
import { StatsModule } from '../stats/stats.module';
import { TelegramController } from './telegram.controller';
import { TelegramPoller } from './telegram-poller';
import { createTelegramApi, TELEGRAM_API } from './telegram-api';
import { TelegramService } from './telegram.service';

@Module({
  imports: [AuthModule, CheckinsModule, FinanceModule, StatsModule],
  controllers: [TelegramController],
  providers: [
    TelegramService,
    TelegramPoller,
    { provide: TELEGRAM_API, useFactory: createTelegramApi },
  ],
  exports: [TelegramService],
})
export class TelegramModule {}
