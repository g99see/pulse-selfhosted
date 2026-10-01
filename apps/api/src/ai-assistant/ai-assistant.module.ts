// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { GoalsModule } from '../goals/goals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StatsModule } from '../stats/stats.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AiChatService } from './ai-chat.service';
import { AiContextService } from './ai-context.service';
import { AiProposalsService } from './ai-proposals.service';
import { AiReviewService } from './ai-review.service';
import { AiToolsService } from './ai-tools.service';

/**
 * AI-помощник (ТЗ §3.9): чат с инструментами чтения, предложения «Применить» и
 * разборы недели/месяца. Свой модуль; берёт сервисы существующих модулей, чтобы
 * не дублировать логику бюджетов, целей и уведомлений.
 */
@Module({
  imports: [
    AuthModule,
    AiModule,
    FinanceModule,
    GoalsModule,
    NotificationsModule,
    StatsModule,
    AchievementsModule,
  ],
  controllers: [AiAssistantController],
  providers: [AiContextService, AiToolsService, AiProposalsService, AiChatService, AiReviewService],
})
export class AiAssistantModule {}
