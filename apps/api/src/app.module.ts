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
import { ChallengesModule } from './challenges/challenges.module';
import { CheckinsModule } from './checkins/checkins.module';
import { FamilyModule } from './family/family.module';
import { FinanceModule } from './finance/finance.module';
import { GoalsModule } from './goals/goals.module';
import { HabitsModule } from './habits/habits.module';
import { HealthModule } from './health/health.module';
import { HtmlPageModule } from './html-page/html-page.module';
import { InsightsModule } from './insights/insights.module';
import { ModerationModule } from './moderation/moderation.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './profile/profile.module';
import { RecurringModule } from './finance/recurring.module';
import { SetupModule } from './setup/setup.module';
import { ShareModule } from './share/share.module';
import { SocialModule } from './social/social.module';
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
    ChallengesModule,
    CheckinsModule,
    CapsulesModule,
    FamilyModule,
    NotificationsModule,
    StatsModule,
    AccountModule,
    AchievementsModule,
    TelegramModule,
    SetupModule,
    InsightsModule,
    ProfileModule,
    ModerationModule,
    ShareModule,
    HtmlPageModule,
    SocialModule,
    ApiAccessModule,
    WidgetsModule,
    WrappedModule,
  ],
})
export class AppModule {}
