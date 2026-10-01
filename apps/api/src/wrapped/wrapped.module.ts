// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WrappedController } from './wrapped.controller';
import { WrappedService } from './wrapped.service';

/** Модуль «Год в цифрах» (ТЗ §3.4, J1): ежегодная сводка. */
@Module({
  imports: [AuthModule],
  controllers: [WrappedController],
  providers: [WrappedService],
  exports: [WrappedService],
})
export class WrappedModule {}
