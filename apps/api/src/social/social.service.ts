// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canView,
  effectiveVisibility,
  encodeFeedCursor,
  parseFeedCursor,
  summarizeReactions,
  type CommentDto,
  type CommentCreateInput,
  type FeedPage,
  type FeedQueryInput,
  type FollowListDto,
  type FollowStateDto,
  type PostDto,
  type PostVisibility,
  type ReactionCreateInput,
  type ReactionEmoji,
  type ReactionSummary,
  type SocialUserRef,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { RateLimitService } from '../auth/rate-limit.service';
import { NotificationDispatcher } from '../notifications/dispatcher';
import { PrismaService } from '../prisma/prisma.service';
import { isFollowing } from './is-following';

/** Лимит комментариев: 20 за минуту на пользователя. */
const COMMENT_RATE_LIMIT = 20;
const COMMENT_RATE_WINDOW_SECONDS = 60;

type UserRefSelect = { id: true; nickname: true; profileVisibility: true };

type PostWithRelations = Prisma.PostGetPayload<{
  include: {
    user: { select: UserRefSelect };
    reactions: { select: { emoji: true; userId: true } };
    _count: { select: { comments: true } };
  };
}>;

/**
 * Социальный сервис (ТЗ §3.7): подписки, лента постов подписок, реакции и
 * комментарии. Приватность профиля и поста проверяется вместе через
 * effectiveVisibility + canView: private видит только владелец, subscribers —
 * подписчики, public — все авторизованные.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RateLimitService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  /** Подписан ли viewer на owner (публичный метод для других модулей). */
  isFollowing(viewerId: string | null | undefined, ownerId: string): Promise<boolean> {
    return isFollowing(this.prisma, viewerId, ownerId);
  }

  /* ----- Подписки ----- */

  private async userByNickname(nickname: string) {
    const user = await this.prisma.user.findUnique({
      where: { nickname },
      select: { id: true, nickname: true, profileVisibility: true },
    });
    if (!user) throw httpError(404, 'user_not_found', 'Пользователь не найден');
    return user;
  }

  private async followStateFor(viewerId: string, targetId: string): Promise<FollowStateDto> {
    const [following, followersCount, followingCount] = await Promise.all([
      isFollowing(this.prisma, viewerId, targetId),
      this.prisma.follow.count({ where: { followingId: targetId } }),
      this.prisma.follow.count({ where: { followerId: targetId } }),
    ]);
    return { following, followersCount, followingCount };
  }

  /** Подписаться на пользователя по никнейму (идемпотентно). */
  async follow(viewerId: string, nickname: string): Promise<FollowStateDto> {
    const target = await this.userByNickname(nickname);
    if (target.id === viewerId) {
      throw httpError(400, 'cannot_follow_self', 'Нельзя подписаться на себя');
    }

    await this.prisma.follow.upsert({
      where: { followerId_followingId: { followerId: viewerId, followingId: target.id } },
      create: { followerId: viewerId, followingId: target.id },
      update: {},
    });
    return this.followStateFor(viewerId, target.id);
  }

  /** Отписаться по никнейму (идемпотентно). */
  async unfollow(viewerId: string, nickname: string): Promise<void> {
    const target = await this.userByNickname(nickname);
    await this.prisma.follow.deleteMany({
      where: { followerId: viewerId, followingId: target.id },
    });
  }

  /** Состояние подписки viewer → пользователь по никнейму. */
  async state(viewerId: string, nickname: string): Promise<FollowStateDto> {
    const target = await this.userByNickname(nickname);
    return this.followStateFor(viewerId, target.id);
  }

  /** Подписчики текущего пользователя. */
  async followers(viewerId: string): Promise<FollowListDto> {
    const rows = await this.prisma.follow.findMany({
      where: { followingId: viewerId },
      orderBy: { createdAt: 'desc' },
      select: { follower: { select: { id: true, nickname: true } } },
    });
    return { users: rows.map((row) => row.follower) };
  }

  /** Кого читает текущий пользователь. */
  async following(viewerId: string): Promise<FollowListDto> {
    const rows = await this.prisma.follow.findMany({
      where: { followerId: viewerId },
      orderBy: { createdAt: 'desc' },
      select: { following: { select: { id: true, nickname: true } } },
    });
    return { users: rows.map((row) => row.following) };
  }

  /* ----- Лента ----- */

  /** Видимость поста зрителю с учётом приватности профиля владельца. */
  private canViewPost(
    viewerId: string,
    followingIds: ReadonlySet<string>,
    post: { userId: string; visibility: string; user: { profileVisibility: string } },
  ): boolean {
    if (post.userId === viewerId) return true;
    const effective = effectiveVisibility(
      post.visibility as PostVisibility,
      post.user.profileVisibility as PostVisibility,
    );
    return canView(effective, false, followingIds.has(post.userId));
  }

  /** Модель → DTO поста с реакциями и числом комментариев. */
  private toPostDto(post: PostWithRelations, viewerId: string): PostDto {
    const reactions = summarizeReactions(post.reactions, viewerId);
    return {
      id: post.id,
      userId: post.userId,
      author: { id: post.user.id, nickname: post.user.nickname },
      type: post.type as PostDto['type'],
      payload: (post.payload ?? {}) as Record<string, unknown>,
      visibility: post.visibility as PostVisibility,
      createdAt: post.createdAt.toISOString(),
      reactions,
      reactionCount: post.reactions.length,
      commentsCount: post._count.comments,
    };
  }

  /**
   * Лента постов подписок (ТЗ §3.7) с пагинацией курсором. Свои посты видны
   * всегда; посты подписок — по приватности. Невидимые посты отбрасываются,
   * цикл добирает страницу до нужного размера.
   */
  async feed(viewerId: string, query: FeedQueryInput): Promise<FeedPage> {
    const limit = query.limit;
    const following = await this.prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    const authorIds = [viewerId, ...following.map((row) => row.followingId)];
    const followingSet = new Set(following.map((row) => row.followingId));

    let cursor = query.cursor ? parseFeedCursor(query.cursor) : null;
    const collected: PostDto[] = [];
    let exhausted = false;

    while (collected.length <= limit && !exhausted) {
      const cursorFilter: Prisma.PostWhereInput = cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {};

      const batch = await this.prisma.post.findMany({
        where: { userId: { in: authorIds }, ...cursorFilter },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          user: { select: { id: true, nickname: true, profileVisibility: true } },
          reactions: { select: { emoji: true, userId: true } },
          _count: { select: { comments: true } },
        },
      });

      if (batch.length === 0) break;

      for (const post of batch) {
        cursor = { createdAt: post.createdAt, id: post.id };
        if (!this.canViewPost(viewerId, followingSet, post)) continue;
        collected.push(this.toPostDto(post, viewerId));
        if (collected.length > limit) break;
      }

      if (batch.length < limit + 1) exhausted = true;
    }

    const posts = collected.slice(0, limit);
    const nextCursor =
      collected.length > limit && posts.length > 0
        ? encodeFeedCursor(posts[posts.length - 1]!.createdAt, posts[posts.length - 1]!.id)
        : null;
    return { posts, nextCursor };
  }

  /* ----- Доступ к посту ----- */

  /** Пост, видимый зрителю; иначе 404 (не раскрываем существование). */
  private async visiblePost(viewerId: string, postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { user: { select: { id: true, nickname: true, profileVisibility: true } } },
    });
    if (!post) throw httpError(404, 'post_not_found', 'Пост не найден');

    const follower = await isFollowing(this.prisma, viewerId, post.userId);
    const effective = effectiveVisibility(
      post.visibility as PostVisibility,
      post.user.profileVisibility as PostVisibility,
    );
    if (!canView(effective, post.userId === viewerId, follower)) {
      throw httpError(404, 'post_not_found', 'Пост не найден');
    }
    return post;
  }

  private async reactionSummary(postId: string, viewerId: string): Promise<ReactionSummary[]> {
    const rows = await this.prisma.reaction.findMany({
      where: { postId },
      select: { emoji: true, userId: true },
    });
    return summarizeReactions(rows, viewerId);
  }

  /* ----- Реакции ----- */

  /** Поставить реакцию на пост; повторная та же реакция — идемпотентно. */
  async addReaction(
    viewerId: string,
    postId: string,
    input: ReactionCreateInput,
  ): Promise<ReactionSummary[]> {
    const post = await this.visiblePost(viewerId, postId);
    const emoji = input.emoji as ReactionEmoji;

    try {
      await this.prisma.reaction.create({ data: { postId, userId: viewerId, emoji } });
      if (post.userId !== viewerId) {
        const actor = await this.prisma.user.findUnique({
          where: { id: viewerId },
          select: { nickname: true },
        });
        await this.notifications
          .notifyPostActivity(post.userId, {
            actorNickname: actor?.nickname ?? 'user',
            kind: 'reaction',
            emoji,
          })
          .catch(() => undefined);
      }
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }

    return this.reactionSummary(postId, viewerId);
  }

  /** Снять реакцию с поста (идемпотентно). */
  async removeReaction(viewerId: string, postId: string, emoji: string): Promise<void> {
    await this.visiblePost(viewerId, postId);
    await this.prisma.reaction.deleteMany({ where: { postId, userId: viewerId, emoji } });
  }

  /* ----- Комментарии ----- */

  private toCommentDto(
    comment: {
      id: string;
      postId: string;
      userId: string;
      body: string;
      createdAt: Date;
      user: SocialUserRef;
    },
    viewerId: string,
    postOwnerId: string,
  ): CommentDto {
    return {
      id: comment.id,
      postId: comment.postId,
      userId: comment.userId,
      author: { id: comment.user.id, nickname: comment.user.nickname },
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      canDelete: comment.userId === viewerId || postOwnerId === viewerId,
    };
  }

  /** Комментарии поста по возрастанию времени. */
  async comments(viewerId: string, postId: string): Promise<CommentDto[]> {
    const post = await this.visiblePost(viewerId, postId);
    const rows = await this.prisma.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, nickname: true } } },
    });
    return rows.map((row) => this.toCommentDto(row, viewerId, post.userId));
  }

  /** Добавить комментарий: проверка доступа, лимит частоты, уведомление автору. */
  async addComment(
    viewerId: string,
    postId: string,
    input: CommentCreateInput,
  ): Promise<CommentDto> {
    const post = await this.visiblePost(viewerId, postId);

    const limit = await this.rates.consume(
      `social:comment:${viewerId}`,
      COMMENT_RATE_LIMIT,
      COMMENT_RATE_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      throw httpError(429, 'rate_limited', 'Слишком много комментариев, попробуйте позже');
    }

    const comment = await this.prisma.comment.create({
      data: { postId, userId: viewerId, body: input.body },
      include: { user: { select: { id: true, nickname: true } } },
    });

    if (post.userId !== viewerId) {
      await this.notifications
        .notifyPostActivity(post.userId, {
          actorNickname: comment.user.nickname,
          kind: 'comment',
          preview: input.body.slice(0, 80),
        })
        .catch(() => undefined);
    }

    return this.toCommentDto(comment, viewerId, post.userId);
  }

  /** Удалить комментарий: автор комментария или владелец поста. */
  async deleteComment(viewerId: string, commentId: string): Promise<void> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { post: { select: { userId: true } } },
    });
    if (!comment) throw httpError(404, 'comment_not_found', 'Комментарий не найден');

    const allowed = comment.userId === viewerId || comment.post.userId === viewerId;
    if (!allowed) {
      throw httpError(403, 'forbidden', 'Нельзя удалить чужой комментарий');
    }

    await this.prisma.comment.delete({ where: { id: commentId } });
  }
}
