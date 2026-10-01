// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMEOUT_MS,
} from '@puls/shared';
import { assertSafeWebhookUrl, allowPrivateWebhooks } from './ssrf';
import { signWebhookPayload } from './webhook-signature';

export interface WebhookSendResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/**
 * Отправка одного запроса вебхука (ТЗ §4): POST JSON, подпись HMAC-SHA256,
 * таймаут 5 с, повторная SSRF-проверка адреса перед отправкой. Редиректы не
 * следуются (`redirect: manual`) — иначе возможен обход защиты.
 */
@Injectable()
export class WebhookSender {
  private readonly timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS ?? WEBHOOK_TIMEOUT_MS);

  async send(params: {
    url: string;
    secret: string;
    event: string;
    deliveryId: string;
    body: string;
  }): Promise<WebhookSendResult> {
    try {
      await assertSafeWebhookUrl(params.url, { allowPrivate: allowPrivateWebhooks() });
    } catch (error) {
      return {
        ok: false,
        status: null,
        error: error instanceof Error ? error.message : 'Адрес отклонён',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(params.url, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_EVENT_HEADER]: params.event,
          [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(params.secret, params.body),
          [WEBHOOK_DELIVERY_HEADER]: params.deliveryId,
        },
        body: params.body,
      });

      return response.ok
        ? { ok: true, status: response.status, error: null }
        : { ok: false, status: response.status, error: `HTTP ${response.status}` };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        status: null,
        error: aborted
          ? `Таймаут ${Math.round(this.timeoutMs / 1000)} с`
          : error instanceof Error
            ? error.message
            : 'Ошибка сети',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
