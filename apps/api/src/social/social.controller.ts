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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CommentCreateSchema,
  FeedQuerySchema,
  ReactionCreateSchema,
  type CommentCreateInput,
  type ReactionCreateInput,
} from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { httpError } from '../common/http-error';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SocialService } from './social.service';

/**
 * Социальные эндпоинты (ТЗ §3.7): подписки, лента, реакции и комментарии.
 * Всё под SessionGuard. Статические маршруты (followers/following) объявлены
 * раньше параметрического :nickname, чтобы не перехватываться им.
 */
@Controller()
@UseGuards(SessionGuard)
export class SocialController {
  constructor(private readonly social: SocialService) {}

  /* ----- Подписки ----- */

  /** Подписаться на пользователя по никнейму. */
  @Post('follows/:nickname')
  @HttpCode(HttpStatus.CREATED)
  follow(@Param('nickname') nickname: string, @Req() req: AuthenticatedRequest) {
    return this.social.follow(req.user!.id, nickname);
  }

  /** Отписаться. */
  @Delete('follows/:nickname')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unfollow(
    @Param('nickname') nickname: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.social.unfollow(req.user!.id, nickname);
  }

  /** Мои подписчики. */
  @Get('follows/followers')
  followers(@Req() req: AuthenticatedRequest) {
    return this.social.followers(req.user!.id);
  }

  /** На кого я подписан. */
  @Get('follows/following')
  following(@Req() req: AuthenticatedRequest) {
    return this.social.following(req.user!.id);
  }

  /** Состояние подписки на конкретного пользователя. */
  @Get('follows/:nickname')
  state(@Param('nickname') nickname: string, @Req() req: AuthenticatedRequest) {
    return this.social.state(req.user!.id, nickname);
  }

  /* ----- Лента ----- */

  /** Лента постов подписок с пагинацией курсором. */
  @Get('feed')
  async feed(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = FeedQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw httpError(400, 'validation_error', 'Некорректные параметры ленты');
    }
    return this.social.feed(req.user!.id, parsed.data);
  }

  /* ----- Реакции ----- */

  /** Поставить реакцию на пост. */
  @Post('posts/:postId/reactions')
  @HttpCode(HttpStatus.CREATED)
  addReaction(
    @Param('postId') postId: string,
    @Body(new ZodValidationPipe(ReactionCreateSchema)) body: ReactionCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.social.addReaction(req.user!.id, postId, body);
  }

  /** Снять реакцию с поста. */
  @Delete('posts/:postId/reactions/:emoji')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeReaction(
    @Param('postId') postId: string,
    @Param('emoji') emoji: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.social.removeReaction(req.user!.id, postId, emoji);
  }

  /* ----- Комментарии ----- */

  /** Комментарии поста. */
  @Get('posts/:postId/comments')
  comments(@Param('postId') postId: string, @Req() req: AuthenticatedRequest) {
    return this.social.comments(req.user!.id, postId);
  }

  /** Добавить комментарий (лимит частоты — на сервисе). */
  @Post('posts/:postId/comments')
  @HttpCode(HttpStatus.CREATED)
  addComment(
    @Param('postId') postId: string,
    @Body(new ZodValidationPipe(CommentCreateSchema)) body: CommentCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.social.addComment(req.user!.id, postId, body);
  }

  /** Удалить комментарий (автор комментария или владелец поста). */
  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.social.deleteComment(req.user!.id, id);
  }
}
