// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Проверяет, подписан ли зритель на владельца контента (ТЗ §3.7). Публичный
 * хелпер для других модулей: им закрывают карточки «только подписчикам» (блок A
 * — публичный профиль). Подписка на себя всегда false.
 *
 * Пример: `if (!(await isFollowing(prisma, viewerId, ownerId))) throw ...`.
 */
export async function isFollowing(
  prisma: PrismaService,
  viewerId: string | null | undefined,
  ownerId: string,
): Promise<boolean> {
  if (!viewerId || viewerId === ownerId) return false;

  const row = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: viewerId, followingId: ownerId } },
    select: { id: true },
  });
  return row !== null;
}
