// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Уведомления (ТЗ §3.6, v2 §5): состояние и настройки каналов, журнал доставок
 * пользователя и метрики outbox для администратора. Всё под SessionGuard и
 * изолировано по пользователю.
 */
import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import {
  ChannelSettingsUpdateSchema,
  NotificationChannelSchema,
  type ChannelSettingsUpdateInput,
} from '@puls/shared';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { httpError } from '../common/http-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Roles } from '../moderation/roles.decorator';
import { RolesGuard } from '../moderation/roles.guard';
import { NotificationsService } from './notifications.service';
import { OutboxService } from './outbox.service';

@Controller('notifications')
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
  ) {}

  @Get('channels')
  async channels(@Req() req: AuthenticatedRequest) {
    return { channels: await this.notifications.listChannels(req.user!.id) };
  }

  @Put('channels/:channel')
  async updateChannel(
    @Param('channel') channel: string,
    @Body(new ZodValidationPipe(ChannelSettingsUpdateSchema)) body: ChannelSettingsUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    const parsed = NotificationChannelSchema.safeParse(channel);
    if (!parsed.success) throw httpError(404, 'channel_not_found', 'Неизвестный канал');
    return { channels: await this.notifications.updateChannel(req.user!.id, parsed.data, body) };
  }

  /** Последние 20 доставок пользователя. */
  @Get('deliveries')
  async deliveries(@Req() req: AuthenticatedRequest) {
    return { deliveries: await this.outbox.recent(req.user!.id) };
  }
}

/** Метрики outbox: количество записей по статусам (только admin). */
@Controller('admin/notifications')
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin')
export class NotificationsAdminController {
  constructor(private readonly outbox: OutboxService) {}

  @Get('metrics')
  metrics() {
    return this.outbox.metrics();
  }
}
