// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../auth/roles.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/** Логи и метрики экземпляра (ТЗ v2 §8). */
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [MetricsController],
  providers: [MetricsService, RolesGuard],
})
export class ObservabilityModule {}
