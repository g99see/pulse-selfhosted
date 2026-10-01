// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Эндпоинты AI-помощника (ТЗ §3.9): чат, применение предложений и разборы.
 * Всё под SessionGuard; пользователь берётся из сессии, из тела — никогда.
 * Без подключённого ключа AiProviderService отвечает ошибкой ai_not_configured.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AiChatRequestSchema,
  AiReviewRequestSchema,
  type AiChatRequest,
  type AiReviewRequest,
} from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { AiChatService } from './ai-chat.service';
import { AiProposalsService } from './ai-proposals.service';
import { AiReviewService } from './ai-review.service';

@Controller('ai')
@UseGuards(SessionGuard)
export class AiAssistantController {
  constructor(
    private readonly chat: AiChatService,
    private readonly proposals: AiProposalsService,
    private readonly review: AiReviewService,
  ) {}

  /** Вопрос помощнику: цикл инструментов только по данным текущего пользователя. */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async ask(
    @Body(new ZodValidationPipe(AiChatRequestSchema)) body: AiChatRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chat.chat(req.user!.id, body);
  }

  /** «Применить» предложение: валидирует payload и создаёт бюджет/цель/напоминание. */
  @Post('proposals/:id/apply')
  @HttpCode(HttpStatus.CREATED)
  async apply(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.proposals.apply(req.user!.id, id);
  }

  /** Предпросмотр разбора: показывает, какие данные уйдут провайдеру. */
  @Post('review/preview')
  @HttpCode(HttpStatus.OK)
  async reviewPreview(
    @Body(new ZodValidationPipe(AiReviewRequestSchema)) body: AiReviewRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.review.preview(req.user!.id, body);
  }

  /** Разбор недели или месяца. */
  @Post('review')
  @HttpCode(HttpStatus.OK)
  async reviewRun(
    @Body(new ZodValidationPipe(AiReviewRequestSchema)) body: AiReviewRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.review.review(req.user!.id, body);
  }
}
