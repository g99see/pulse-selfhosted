// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ChallengeCheckSchema,
  ChallengeCreateSchema,
  ChallengeInviteSchema,
  ChallengeJoinSchema,
  ChallengeUpdateSchema,
  type ChallengeCheckInput,
  type ChallengeCreateInput,
  type ChallengeInviteInput,
  type ChallengeJoinInput,
  type ChallengeUpdateInput,
} from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ChallengesService } from './challenges.service';

/**
 * Челленджи (ТЗ §4, P2): CRUD, вступление по коду, приглашение из подписок,
 * ежедневная отметка «держусь» и рейтинг участников. Всё под SessionGuard.
 */
@Controller('challenges')
@UseGuards(SessionGuard)
export class ChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    return { challenges: await this.challenges.list(req.user!.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(ChallengeCreateSchema)) body: ChallengeCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.challenges.create(req.user!.id, body);
  }

  @Post('join')
  @HttpCode(HttpStatus.OK)
  join(
    @Body(new ZodValidationPipe(ChallengeJoinSchema)) body: ChallengeJoinInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.challenges.join(req.user!.id, body);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.challenges.get(req.user!.id, id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChallengeUpdateSchema)) body: ChallengeUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.challenges.update(req.user!.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.challenges.remove(req.user!.id, id);
  }

  @Post(':id/check')
  @HttpCode(HttpStatus.CREATED)
  check(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChallengeCheckSchema)) body: ChallengeCheckInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.challenges.check(req.user!.id, id, body);
  }

  @Get(':id/leaderboard')
  leaderboard(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.challenges.leaderboard(req.user!.id, id);
  }

  @Get(':id/invite-candidates')
  async inviteCandidates(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return { users: await this.challenges.inviteCandidates(req.user!.id, id) };
  }

  @Post(':id/invite')
  @HttpCode(HttpStatus.CREATED)
  invite(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChallengeInviteSchema)) body: ChallengeInviteInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.challenges.invite(req.user!.id, id, body);
  }
}
