// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Шина доменных событий (ТЗ §4). Намеренно НЕ Nest-провайдер: доменные
 * сервисы вызывают `DomainEvents.emit(...)` одной строкой, а подписчик
 * вебхуков слушает `on(...)`. Такой синглтон исключает цикл модулей
 * (Finance → ApiAccess → Finance), который возник бы при DI.
 */
import { EventEmitter } from 'node:events';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@puls/shared';

export interface DomainEventMessage {
  /** Имя события: одно из WEBHOOK_EVENTS. */
  event: WebhookEvent;
  /** Владелец данных, к которым относится событие. */
  userId: string;
  /** Компактные данные события (попадают в тело вебхука). */
  data: Record<string, unknown>;
  occurredAt: string;
}

export type DomainEventHandler = (message: DomainEventMessage) => void;

class DomainEventBus {
  private readonly emitter = new EventEmitter();

  /** Испускает событие всем подписчикам. Ошибки подписчиков не ломают emit. */
  emit(event: WebhookEvent, userId: string, data: Record<string, unknown> = {}): void {
    if (!WEBHOOK_EVENTS.includes(event)) return;
    const message: DomainEventMessage = {
      event,
      userId,
      data,
      occurredAt: new Date().toISOString(),
    };
    this.emitter.emit(event, message);
  }

  on(event: WebhookEvent, handler: DomainEventHandler): void {
    this.emitter.on(event, handler);
  }

  off(event: WebhookEvent, handler: DomainEventHandler): void {
    this.emitter.off(event, handler);
  }
}

/** Единственный экземпляр шины на процесс. */
export const DomainEvents = new DomainEventBus();
