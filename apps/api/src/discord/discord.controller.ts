// SPDX-License-Identifier: AGPL-3.0-or-later
/** HTTP-точки Discord-канала: состояние, одноразовый код привязки и отвязка. */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { DiscordService } from './discord.service';

@Controller('discord')
@UseGuards(SessionGuard)
export class DiscordController {
  constructor(private readonly discord: DiscordService) {}

  @Get('status')
  status(@Req() req: AuthenticatedRequest) {
    return this.discord.status(req.user!.id);
  }

  @Post('link-code')
  @HttpCode(HttpStatus.CREATED)
  linkCode(@Req() req: AuthenticatedRequest) {
    return this.discord.createLinkCode(req.user!.id);
  }

  @Delete('link')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlink(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.discord.unlink(req.user!.id);
  }
}
