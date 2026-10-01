// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';

/** Семейный режим (ТЗ §4): всё под SessionGuard, общие данные одной семьи. */
@Module({
  imports: [AuthModule],
  controllers: [FamilyController],
  providers: [FamilyService],
  exports: [FamilyService],
})
export class FamilyModule {}
