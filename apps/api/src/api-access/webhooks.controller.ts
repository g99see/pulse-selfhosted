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
import { WebhookCreateSchema, type WebhookCreateInput } from '@puls/shared';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WebhooksService } from './webhooks.service';

/** Подписки на исходящие вебхуки (ТЗ §4) — под cookie-сессией. */
@Controller('webhooks')
@UseGuards(SessionGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.webhooks.list(req.user!.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(WebhookCreateSchema)) body: WebhookCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhooks.create(req.user!.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.webhooks.remove(req.user!.id, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.webhooks.test(req.user!.id, id);
  }

  @Get(':id/deliveries')
  deliveries(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.webhooks.deliveries(req.user!.id, id);
  }
}
