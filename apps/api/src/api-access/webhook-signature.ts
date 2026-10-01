// SPDX-License-Identifier: AGPL-3.0-or-later
/** Подпись вебхуков (ТЗ §4): HMAC-SHA256 по телу, формат `sha256=<hex>`. */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Заголовок `X-Puls-Signature` для переданного тела. */
export function signWebhookPayload(secret: string, body: string): string {
  const digest = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

/** Проверка подписи в постоянном времени (для тестов и потребителей). */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = signWebhookPayload(secret, body);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
