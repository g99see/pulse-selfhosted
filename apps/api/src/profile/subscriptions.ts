// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Тонкий хелпер подписок (ТЗ §3.7). Модель Follow и подписки делает блок B;
 * здесь только проверка «смотрит ли пользователь на своего автора». Пока
 * таблица follows не появилась в БД (или Prisma-клиент отстал), считаем, что
 * подписки нет, — публичная страница не падает.
 */
import type { PrismaService } from '../prisma/prisma.service';

interface FollowDelegate {
  findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown>;
}

/**
 * Подписан ли viewerId на автора targetUserId.
 * @returns false для анонимного смотрящего, для себя и когда Follow недоступен.
 */
export async function isSubscriber(
  prisma: PrismaService,
  viewerId: string | null | undefined,
  targetUserId: string,
): Promise<boolean> {
  if (!viewerId || viewerId === targetUserId) return false;

  // TODO(block B): заменить на типизированный prisma.follow, когда модель
  // Follow и миграция стабильно присутствуют в схеме.
  const delegate = (prisma as unknown as { follow?: FollowDelegate }).follow;
  if (!delegate?.findFirst) return false;

  try {
    const row = await delegate.findFirst({
      where: { followerId: viewerId, followingId: targetUserId },
    });
    return Boolean(row);
  } catch {
    // Таблица follows ещё не мигрирована — подписок нет.
    return false;
  }
}
