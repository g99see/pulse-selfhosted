// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PostType, PostVisibility } from '@puls/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Данные для создания поста ленты (ТЗ §3.7). */
export interface CreatePostInput {
  userId: string;
  type: PostType;
  payload: Record<string, unknown>;
  visibility?: PostVisibility;
}

/**
 * Создание постов ленты (ТЗ §3.7). Отдельный лёгкий сервис без зависимостей,
 * чтобы его могли импортировать модули достижений и целей без цикла модулей.
 * Ошибка вставки не должна ронять основной сценарий (получение бейджа, цели) —
 * поэтому исключение только логируется.
 */
@Injectable()
export class SocialPostsService {
  private readonly logger = new Logger(SocialPostsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePostInput): Promise<void> {
    try {
      await this.prisma.post.create({
        data: {
          userId: input.userId,
          type: input.type,
          payload: input.payload as Prisma.InputJsonValue,
          visibility: input.visibility ?? 'subscribers',
        },
      });
    } catch (error) {
      this.logger.warn('Не удалось создать пост ленты', error as Error);
    }
  }
}
