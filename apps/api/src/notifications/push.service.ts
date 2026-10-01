// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Web push (ТЗ §3.6): собственные VAPID-ключи из окружения и транспорт
 * отправки. Если VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY не заданы — отправка
 * отключена, и это явно видно через GET /api/notifications/vapid-public-key.
 * Для dev и тестов используется in-memory транспорт.
 */
import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import type { VapidPublicKeyResponse } from '@puls/shared';

/** Тело push-уведомления. Для чек-инов несёт кнопки ответа 1–5 (ТЗ §9). */
export interface PushPayload {
  type: string;
  title: string;
  body: string;
  url?: string;
  /** Путь API, куда service worker отвечает из уведомления (ТЗ §9). */
  checkinUrl?: string;
  actions?: { action: string; title: string }[];
  data?: Record<string, unknown>;
}

/** Подписка, как её хранит БД. */
export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  ok: boolean;
  /** Подписка больше не существует (404/410) — её нужно удалить. */
  expired: boolean;
  error?: string;
}

export interface PushTransport {
  send(target: PushTarget, payload: PushPayload): Promise<PushSendResult>;
}

/** Транспорт для dev и тестов: ничего не отправляет, складывает в outbox. */
export class InMemoryPushTransport implements PushTransport {
  readonly sent: { target: PushTarget; payload: PushPayload }[] = [];

  async send(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
    this.sent.push({ target, payload });
    return { ok: true, expired: false };
  }

  lastFor(endpoint: string): { target: PushTarget; payload: PushPayload } | undefined {
    return [...this.sent].reverse().find((entry) => entry.target.endpoint === endpoint);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/** Реальный транспорт поверх библиотеки web-push (MPL-2.0). */
export class WebPushTransport implements PushTransport {
  async send(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
      );
      return { ok: true, expired: false };
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      const expired = statusCode === 404 || statusCode === 410;
      return {
        ok: false,
        expired,
        error: error instanceof Error ? error.message : 'unknown_error',
      };
    }
  }
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  private readonly privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  private readonly subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost';
  /** Готов ли web push: ключи заданы и приняты библиотекой. */
  private pushEnabled = false;
  private readonly transport: PushTransport = this.createTransport();

  /** Готов ли web push: нужны оба ключа VAPID и их валидность. */
  get configured(): boolean {
    return this.pushEnabled;
  }

  private createTransport(): PushTransport {
    if (this.publicKey.length === 0 || this.privateKey.length === 0) {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY не заданы — web push отключён, отправки нет',
      );
      return new InMemoryPushTransport();
    }

    try {
      webpush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
    } catch (error) {
      this.logger.error(
        `VAPID-ключи некорректны (${
          error instanceof Error ? error.message : 'unknown'
        }) — web push отключён, отправки нет`,
      );
      return new InMemoryPushTransport();
    }

    this.pushEnabled = true;
    this.logger.log('Web push включён: VAPID-ключи заданы');
    return new WebPushTransport();
  }

  /** Публичный ключ для подписки браузера; null — отправка недоступна. */
  vapidPublicKey(): VapidPublicKeyResponse {
    return { publicKey: this.pushEnabled ? this.publicKey : null, enabled: this.pushEnabled };
  }

  send(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
    return this.transport.send(target, payload);
  }

  /** Доступно только для in-memory транспорта (dev/тесты). */
  outbox(): readonly { target: PushTarget; payload: PushPayload }[] {
    return this.transport instanceof InMemoryPushTransport ? this.transport.sent : [];
  }

  clearOutbox(): void {
    if (this.transport instanceof InMemoryPushTransport) this.transport.clear();
  }
}
