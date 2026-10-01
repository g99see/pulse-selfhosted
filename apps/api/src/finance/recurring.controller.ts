// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Регулярные платежи (ТЗ §3.2): список, ближайшие списания, CRUD и
 * пауза/возобновление. Всё под SessionGuard и изолировано по пользователю.
 */
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
  RecurringPaymentActiveSchema,
  RecurringPaymentCreateSchema,
  RecurringPaymentUpdateSchema,
  type RecurringPaymentActiveInput,
  type RecurringPaymentCreateInput,
  type RecurringPaymentUpdateInput,
} from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RecurringService } from './recurring.service';

@Controller('finance/recurring-payments')
@UseGuards(SessionGuard)
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    return { payments: await this.recurring.list(req.user!.id) };
  }

  @Get('upcoming')
  async upcoming(@Req() req: AuthenticatedRequest) {
    return { upcoming: await this.recurring.upcoming(req.user!.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(RecurringPaymentCreateSchema)) body: RecurringPaymentCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.recurring.create(req.user!.id, body);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecurringPaymentUpdateSchema)) body: RecurringPaymentUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.recurring.update(req.user!.id, id, body);
  }

  /** Пауза/возобновление: { active: false } — поставить на паузу. */
  @Put(':id/active')
  setActive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RecurringPaymentActiveSchema)) body: RecurringPaymentActiveInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.recurring.setActive(req.user!.id, id, body.active);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.recurring.remove(req.user!.id, id);
  }
}
