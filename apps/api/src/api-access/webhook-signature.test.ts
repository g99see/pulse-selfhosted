// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signWebhookPayload, verifyWebhookSignature } from './webhook-signature';

describe('Подпись вебхука HMAC-SHA256 (ТЗ §4)', () => {
  const secret = 's3cret-key';
  const body = JSON.stringify({ event: 'transaction.created', deliveryId: 'd1' });

  it('формат sha256=<hex HMAC-SHA256(secret, body)>', () => {
    const expected = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
    expect(signWebhookPayload(secret, body)).toBe(expected);
  });

  it('подпись зависит от секрета и тела', () => {
    const signature = signWebhookPayload(secret, body);
    expect(signWebhookPayload('другой', body)).not.toBe(signature);
    expect(signWebhookPayload(secret, `${body} `)).not.toBe(signature);
  });

  it('verify принимает свою подпись и отвергает чужую', () => {
    const signature = signWebhookPayload(secret, body);
    expect(verifyWebhookSignature(secret, body, signature)).toBe(true);
    expect(verifyWebhookSignature('другой', body, signature)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'sha256=00')).toBe(false);
    expect(verifyWebhookSignature(secret, body, undefined)).toBe(false);
  });
});
