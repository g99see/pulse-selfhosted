// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CheckinsModule } from './checkins/checkins.module';
import { FinanceModule } from './finance/finance.module';
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
    CheckinsModule,
    NotificationsModule,
    StatsModule,
  ],
})
export class AppModule {}
