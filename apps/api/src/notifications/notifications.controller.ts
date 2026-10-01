// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Уведомления (ТЗ §3.6, §9): публичный VAPID-ключ, подписки web push и правила
 * по типам. Всё, кроме публичного ключа, — под SessionGuard и изолировано по
 * пользователю.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  PushSubscriptionDeleteSchema,
  PushSubscriptionInputSchema,
  NotificationRulesUpdateSchema,
  type NotificationRulesUpdateInput,
  type PushSubscriptionDeleteInput,
  type PushSubscriptionInput,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  /** Публичный ключ VAPID; enabled=false — отправка push отключена (ТЗ §3.6). */
  @Get('vapid-public-key')
  vapidPublicKey() {
    return this.push.vapidPublicKey();
  }

  @Get('subscriptions')
  @UseGuards(SessionGuard)
  async listSubscriptions(@Req() req: AuthenticatedRequest) {
    return { subscriptions: await this.notifications.listSubscriptions(req.user!.id) };
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard)
  saveSubscription(
    @Body(new ZodValidationPipe(PushSubscriptionInputSchema)) body: PushSubscriptionInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notifications.saveSubscription(req.user!.id, body);
  }

  @Delete('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async removeSubscription(
    @Body(new ZodValidationPipe(PushSubscriptionDeleteSchema)) body: PushSubscriptionDeleteInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const removed = await this.notifications.deleteSubscription(req.user!.id, body.endpoint);
    if (!removed) {
      throw httpError(404, 'subscription_not_found', 'Подписка не найдена');
    }
  }

  @Get('rules')
  @UseGuards(SessionGuard)
  async listRules(@Req() req: AuthenticatedRequest) {
    return { rules: await this.notifications.listRules(req.user!.id) };
  }

  @Put('rules')
  @UseGuards(SessionGuard)
  async updateRules(
    @Body(new ZodValidationPipe(NotificationRulesUpdateSchema)) body: NotificationRulesUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return { rules: await this.notifications.updateRules(req.user!.id, body.rules) };
  }
}
