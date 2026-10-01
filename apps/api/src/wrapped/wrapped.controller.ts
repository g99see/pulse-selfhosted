// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { WrappedQuerySchema } from '@puls/shared';
import { httpError } from '../common/http-error';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { WrappedService } from './wrapped.service';

/** «Год в цифрах» (ТЗ §3.4, J1): всё под SessionGuard, данные текущего пользователя. */
@Controller('wrapped')
@UseGuards(SessionGuard)
export class WrappedController {
  constructor(private readonly wrapped: WrappedService) {}

  /** Сводка за год: без параметра — текущий год пользователя. */
  @Get()
  async year(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = WrappedQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw httpError(400, 'validation_error', 'Некорректный год');
    }
    return this.wrapped.year(req.user!.id, parsed.data.year);
  }
}
