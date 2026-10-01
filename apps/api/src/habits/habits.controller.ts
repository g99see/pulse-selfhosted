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
  HabitCreateSchema,
  HabitLogSchema,
  HabitUpdateSchema,
  type HabitCreateInput,
  type HabitLogInput,
  type HabitUpdateInput,
} from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { HabitsService } from './habits.service';

/** Трекер привычек (ТЗ §4, P2): CRUD и отметки в чек-ине. */
@Controller('habits')
@UseGuards(SessionGuard)
export class HabitsController {
  constructor(private readonly habits: HabitsService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    return { habits: await this.habits.list(req.user!.id) };
  }

  /** Блок «Привычки сегодня» для чек-ина: отметка и серия по активным привычкам. */
  @Get('today')
  today(@Req() req: AuthenticatedRequest) {
    return this.habits.today(req.user!.id);
  }

  /** Серия и проценты за 7/30 дней по привычкам пользователя. */
  @Get('stats')
  stats(@Req() req: AuthenticatedRequest) {
    return this.habits.stats(req.user!.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(HabitCreateSchema)) body: HabitCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.habits.create(req.user!.id, body);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.habits.get(req.user!.id, id);
  }

  /** Идемпотентная отметка за дату в часовом поясе пользователя. */
  @Post(':id/log')
  @HttpCode(HttpStatus.CREATED)
  log(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(HabitLogSchema)) body: HabitLogInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.habits.mark(req.user!.id, id, body);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(HabitUpdateSchema)) body: HabitUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.habits.update(req.user!.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.habits.remove(req.user!.id, id);
  }
}
