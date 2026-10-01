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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTokenCreateSchema, type ApiTokenCreateInput } from '@puls/shared';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApiTokensService } from './api-tokens.service';

/** Управление личными токенами (ТЗ §4) — под cookie-сессией, не по токену. */
@Controller('api-tokens')
@UseGuards(SessionGuard)
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.tokens.list(req.user!.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(ApiTokenCreateSchema)) body: ApiTokenCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tokens.create(req.user!.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.tokens.revoke(req.user!.id, id);
  }
}
