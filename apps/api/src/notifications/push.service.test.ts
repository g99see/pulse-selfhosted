// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { PushService } from './push.service';

const ENV_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('PushService', () => {
  it('без VAPID-ключей отправка отключена и это явно видно', () => {
    const service = new PushService();
    expect(service.configured).toBe(false);
    expect(service.vapidPublicKey()).toEqual({ publicKey: null, enabled: false });
    expect(service.outbox()).toHaveLength(0);
  });

  it('с VAPID-ключами отдаёт публичный ключ и включает отправку', () => {
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';

    const service = new PushService();
    expect(service.configured).toBe(true);
    expect(service.vapidPublicKey()).toEqual({ publicKey: keys.publicKey, enabled: true });
  });

  it('при некорректных VAPID-ключах не падает, а отключает отправку', () => {
    process.env.VAPID_PUBLIC_KEY = 'not-a-real-key';
    process.env.VAPID_PRIVATE_KEY = 'not-a-real-key';

    const service = new PushService();
    expect(service.configured).toBe(false);
    expect(service.vapidPublicKey()).toEqual({ publicKey: null, enabled: false });
  });

  it('в in-memory транспорте (без ключей) складывает отправки в outbox', async () => {
    const service = new PushService();
    const target = { id: 's1', endpoint: 'https://push.example.com/a', p256dh: 'p', auth: 'a' };
    const payload = { type: 'checkins', title: 'A', body: 'B' };

    const result = await service.send(target, payload);
    expect(result.ok).toBe(true);
    expect(service.outbox()).toHaveLength(1);
    expect(service.outbox()[0]).toMatchObject({ target, payload });

    service.clearOutbox();
    expect(service.outbox()).toHaveLength(0);
  });
});
