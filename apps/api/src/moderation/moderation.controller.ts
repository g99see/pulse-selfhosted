// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ModerationResolveSchema,
  ReportsQuerySchema,
  type ModerationResolveInput,
  type ReportsQueryInput,
} from '@puls/shared';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ModerationService } from './moderation.service';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

/**
 * Очередь модерации (ТЗ §3.8): только модератор и администратор (ТЗ §2).
 * SessionGuard даёт пользователя, RolesGuard проверяет роль из `@Roles`.
 */
@Controller('moderation')
@UseGuards(SessionGuard, RolesGuard)
@Roles('moderator', 'admin')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  /** Список жалоб с фильтром по статусу: GET /api/moderation/reports?status=open. */
  @Get('reports')
  async listReports(@Query(new ZodValidationPipe(ReportsQuerySchema)) query: ReportsQueryInput) {
    return { reports: await this.moderation.listReports(query.status) };
  }

  /** Решение по жалобе: скрыть/показать цель, разблокировать HTML или отклонить. */
  @Post('reports/:id/resolve')
  resolve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ModerationResolveSchema)) body: ModerationResolveInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.moderation.resolveReport(req.user!.id, id, body);
  }

  /** Журнал действий модерации (ТЗ §2): кто, что и когда скрыл. */
  @Get('actions')
  async listActions() {
    return { actions: await this.moderation.listActions() };
  }
}
