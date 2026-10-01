// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CryptoModule } from '../crypto/crypto.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CapsulesController } from './capsules.controller';
import { CapsulesScheduler } from './capsules.scheduler';
import { CapsulesService } from './capsules.service';

/**
 * Капсулы времени (ТЗ §4, P2): CRUD, снимок статистики и планировщик открытия.
 * Зависит от AuthModule (SessionGuard), CryptoModule (SecretBox) и
 * NotificationsModule (диспетчер уведомлений) — без циклов.
 */
@Module({
  imports: [AuthModule, CryptoModule, NotificationsModule],
  controllers: [CapsulesController],
  providers: [CapsulesService, CapsulesScheduler],
  exports: [CapsulesService],
})
export class CapsulesModule {}
