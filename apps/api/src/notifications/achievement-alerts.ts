// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Уведомление о полученном достижении: слушает внутреннюю шину событий
 * `achievement.earned` (её шлёт AchievementsService при выдаче по событию, но не
 * при тихом пересчёте) и ставит сообщение в outbox Telegram/Discord. Через шину,
 * а не прямой импорт: иначе Achievements → Notifications → Telegram → Checkins
 * → Achievements замкнули бы цикл модулей.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ACHIEVEMENT_LEVELS, type AchievementLevel } from '@puls/shared';
import { InternalEvents, type InternalEventMap } from '../common/internal-events';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDispatcher } from './dispatcher';

@Injectable()
export class AchievementAlerts implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AchievementAlerts.name);
  private readonly handler = (payload: InternalEventMap['achievement.earned']): void => {
    void this.onEarned(payload).catch((error: unknown) => {
      this.logger.warn(
        `Уведомление о достижении не поставлено: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  onModuleInit(): void {
    InternalEvents.on('achievement.earned', this.handler);
  }

  onModuleDestroy(): void {
    InternalEvents.off('achievement.earned', this.handler);
  }

  /** Возвращает true, если уведомление поставлено в очередь; публично для тестов. */
  async onEarned(payload: InternalEventMap['achievement.earned']): Promise<boolean> {
    const level = payload.level as AchievementLevel;
    if (!ACHIEVEMENT_LEVELS.includes(level)) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { locale: true },
    });
    if (!user) return false;
    return this.dispatcher.notifyAchievementEarned(payload.userId, {
      code: payload.code,
      level,
      locale: user.locale === 'en' ? 'en' : 'ru',
    });
  }
}
