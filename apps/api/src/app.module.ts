// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { CheckinsModule } from './checkins/checkins.module';
import { FinanceModule } from './finance/finance.module';
import { GoalsModule } from './goals/goals.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    FinanceModule,
    GoalsModule,
    CheckinsModule,
    NotificationsModule,
    StatsModule,
    AccountModule,
  ],
})
export class AppModule {}
