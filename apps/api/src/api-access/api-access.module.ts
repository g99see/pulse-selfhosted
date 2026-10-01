// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CheckinsModule } from '../checkins/checkins.module';
import { CryptoModule } from '../crypto/crypto.module';
import { FinanceModule } from '../finance/finance.module';
import { StatsModule } from '../stats/stats.module';
import { ApiTokenGuard } from './api-token.guard';
import { ApiTokensController } from './api-tokens.controller';
import { ApiTokensService } from './api-tokens.service';
import { PublicApiController } from './public-api.controller';
import { WebhookDispatcher } from './webhook-dispatcher';
import { WebhookRetryScheduler } from './webhook-retry.scheduler';
import { WebhookSender } from './webhook-sender';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Открытый API и вебхуки (ТЗ §4, P2). Свой модуль: токены доступа, публичные
 * эндпоинты `/api/v1/*` и исходящие вебхуки. Переиспользует сервисы финансов,
 * чек-инов и статистики — цикла модулей нет, они не зависят от ApiAccess.
 */
@Module({
  imports: [AuthModule, CryptoModule, FinanceModule, CheckinsModule, StatsModule],
  controllers: [ApiTokensController, WebhooksController, PublicApiController],
  providers: [
    ApiTokensService,
    WebhooksService,
    WebhookSender,
    WebhookDispatcher,
    WebhookRetryScheduler,
    ApiTokenGuard,
  ],
})
export class ApiAccessModule {}
