// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ProfileUpdateSchema, type ProfileUpdateInput } from '@puls/shared';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProfileService } from './profile.service';

/** Свой публичный профиль (ТЗ §3.7): чтение и редактирование под SessionGuard. */
@Controller('profile')
@UseGuards(SessionGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  async get(@Req() req: AuthenticatedRequest) {
    return { profile: await this.profile.getOwn(req.user!.id) };
  }

  @Put()
  async update(
    @Body(new ZodValidationPipe(ProfileUpdateSchema)) body: ProfileUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return { profile: await this.profile.update(req.user!.id, body) };
  }
}
