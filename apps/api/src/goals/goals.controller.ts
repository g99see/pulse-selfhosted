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
  GoalCreateSchema,
  GoalDepositSchema,
  GoalUpdateSchema,
  type GoalCreateInput,
  type GoalDepositInput,
  type GoalUpdateInput,
} from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { GoalsService } from './goals.service';

/** Цели накоплений (ТЗ §3.2, сценарий 2): CRUD и пополнения с вехами. */
@Controller('goals')
@UseGuards(SessionGuard)
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    return { goals: await this.goals.list(req.user!.id) };
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.goals.get(req.user!.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(GoalCreateSchema)) body: GoalCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.goals.create(req.user!.id, body);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(GoalUpdateSchema)) body: GoalUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.goals.update(req.user!.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.goals.remove(req.user!.id, id);
  }

  @Post(':id/deposit')
  @HttpCode(HttpStatus.CREATED)
  deposit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(GoalDepositSchema)) body: GoalDepositInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.goals.deposit(req.user!.id, id, body);
  }
}
