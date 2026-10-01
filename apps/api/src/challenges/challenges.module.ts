// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';

/** Челленджи (ТЗ §4, P2): всё под SessionGuard, данные участников челленджа. */
@Module({
  imports: [AuthModule],
  controllers: [ChallengesController],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}
