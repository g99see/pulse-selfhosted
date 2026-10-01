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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CheckInFilterSchema,
  CheckInInputSchema,
  CheckInScheduleSchema,
  CheckInUpdateSchema,
  type CheckInInput,
  type CheckInScheduleInput,
  type CheckInUpdateInput,
} from '@puls/shared';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { httpError } from '../common/http-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CheckinsService } from './checkins.service';

/** Чек-ины самочувствия (ТЗ §3.3) — всё под SessionGuard и по текущему пользователю. */
@Controller('checkins')
@UseGuards(SessionGuard)
export class CheckinsController {
  constructor(private readonly checkins: CheckinsService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const filter = CheckInFilterSchema.safeParse(query);
    if (!filter.success) {
      throw httpError(400, 'validation_error', 'Некорректные параметры фильтра');
    }
    return { checkIns: await this.checkins.list(req.user!.id, filter.data) };
  }

  @Get('today')
  today(@Req() req: AuthenticatedRequest) {
    return this.checkins.today(req.user!.id);
  }

  @Get('schedule')
  async getSchedule(@Req() req: AuthenticatedRequest) {
    return { schedule: await this.checkins.getSchedule(req.user!.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(CheckInInputSchema)) body: CheckInInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.checkins.create(req.user!.id, body);
  }

  /** Ответ за 5 секунд прямо из уведомления: только настроение (ТЗ §3.3). */
  @Post('quick')
  @HttpCode(HttpStatus.CREATED)
  quick(
    @Body(new ZodValidationPipe(CheckInInputSchema)) body: CheckInInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.checkins.create(req.user!.id, body);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.checkins.get(req.user!.id, id);
  }

  @Put('schedule')
  async setSchedule(
    @Body(new ZodValidationPipe(CheckInScheduleSchema)) body: CheckInScheduleInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return { schedule: await this.checkins.setSchedule(req.user!.id, body) };
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CheckInUpdateSchema)) body: CheckInUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.checkins.update(req.user!.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.checkins.remove(req.user!.id, id);
  }
}
