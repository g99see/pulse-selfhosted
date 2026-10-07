// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Внутренняя шина событий между модулями (не уходит во внешние вебхуки).
 * Нужна там, где прямой импорт модуля создал бы цикл (Finance → Notifications
 * → Telegram → Finance): источник вызывает `emit`, подписчик слушает `on`.
 */
import { EventEmitter } from 'node:events';
import type { AchievementEvent } from '@puls/shared';

export interface InternalEventMap {
  /** Импорт выписки сохранил новый закрывающий остаток банка. */
  'statement.imported': { userId: string; accountId: string; statementId: string };
  /** Произошло событие, после которого нужно проверить достижения (см. AchievementsService). */
  'achievement.check': { userId: string; event: AchievementEvent };
  /** Пользователь получил новый уровень достижения (не при тихом пересчёте). */
  'achievement.earned': { userId: string; code: string; level: string };
  /** Импорт добавил расходы: сумма в базовой валюте по категории и месяцу. */
  'import.expenses': {
    userId: string;
    additions: { categoryId: string; month: string; amountBase: number }[];
  };
}

class InternalEventBus {
  private readonly emitter = new EventEmitter();

  emit<K extends keyof InternalEventMap>(event: K, payload: InternalEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof InternalEventMap>(
    event: K,
    handler: (payload: InternalEventMap[K]) => void,
  ): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof InternalEventMap>(
    event: K,
    handler: (payload: InternalEventMap[K]) => void,
  ): void {
    this.emitter.off(event, handler);
  }
}

export const InternalEvents = new InternalEventBus();
