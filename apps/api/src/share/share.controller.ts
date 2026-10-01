// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ShareCardQuerySchema, type ShareCardQuery } from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ShareService } from './share.service';

/** Карточка «Поделиться результатом» (ТЗ §3.7): SVG и PNG по текущему пользователю. */
@Controller('share')
@UseGuards(SessionGuard)
export class ShareController {
  constructor(private readonly share: ShareService) {}

  /** SVG-карточка: image/svg+xml (для предпросмотра и клиентской растеризации). */
  @Get('card')
  async card(
    @Query(new ZodValidationPipe(ShareCardQuerySchema)) query: ShareCardQuery,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const { svg } = await this.share.buildCard(req.user!.id, query);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="puls-${query.type}.svg"`);
    res.send(svg);
  }

  /** PNG-карточка: готова к публикации в сторис и Telegram. */
  @Get('card.png')
  async cardPng(
    @Query(new ZodValidationPipe(ShareCardQuerySchema)) query: ShareCardQuery,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const { svg, format } = await this.share.buildCard(req.user!.id, query);
    const png = this.share.toPng(svg, format);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="puls-${query.type}.png"`);
    res.send(png);
  }
}
