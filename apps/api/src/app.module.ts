// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { AchievementsModule } from './achievements/achievements.module';
import { AiAssistantModule } from './ai-assistant/ai-assistant.module';
import { AiModule } from './ai/ai.module';
import { ApiAccessModule } from './api-access/api-access.module';
import { AuthModule } from './auth/auth.module';
import { ExternalAuthModule } from './auth/external/external-auth.module';
import { CapsulesModule } from './capsules/capsules.module';
import { CheckinsModule } from './checkins/checkins.module';
import { FinanceModule } from './finance/finance.module';
import { GoalsModule } from './goals/goals.module';
import { HabitsModule } from './habits/habits.module';
import { HealthModule } from './health/health.module';
import { InsightsModule } from './insights/insights.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';
import { RecurringModule } from './finance/recurring.module';
import { SetupModule } from './setup/setup.module';
import { StatsModule } from './stats/stats.module';
import { TelegramModule } from './telegram/telegram.module';
import { WrappedModule } from './wrapped/wrapped.module';
import { WidgetsModule } from './widgets/widgets.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    ExternalAuthModule,
    AiModule,
    AiAssistantModule,
    FinanceModule,
    RecurringModule,
    GoalsModule,
    HabitsModule,
    CheckinsModule,
    CapsulesModule,
    NotificationsModule,
    StatsModule,
    AccountModule,
    AchievementsModule,
    TelegramModule,
    SetupModule,
    InsightsModule,
    ApiAccessModule,
    WidgetsModule,
    ObservabilityModule,
    WrappedModule,
  ],
})
export class AppModule {}
