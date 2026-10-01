// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { DataExportService } from './data-export.service';

/** Экспорт JSON/CSV и удаление аккаунта (ТЗ §3.1, §6, §9). */
@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [AccountService, DataExportService],
})
export class AccountModule {}
