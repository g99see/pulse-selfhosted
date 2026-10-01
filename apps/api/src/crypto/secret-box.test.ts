// SPDX-License-Identifier: AGPL-3.0-or-later
// AES-256-GCM «сейф» для секретов (ТЗ §6): TOTP-секреты, позже — AI-ключи.
import { describe, expect, it } from 'vitest';
import { createSecretBox, DEV_TEST_KEY_BASE64, resolveMasterKey, SecretBox } from './secret-box';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

describe('resolveMasterKey', () => {
  it('берёт ключ из окружения, если он задан', () => {
    const resolution = resolveMasterKey({ APP_ENCRYPTION_KEY: KEY, NODE_ENV: 'production' });
    expect(resolution.source).toBe('env');
    expect(resolution.keyBase64).toBe(KEY);
  });

  it('падает на ключе неверной длины', () => {
    expect(() =>
      resolveMasterKey({ APP_ENCRYPTION_KEY: 'c2hvcnQ=', NODE_ENV: 'production' }),
    ).toThrow();
  });

  it('в production без ключа 2FA недоступна', () => {
    const resolution = resolveMasterKey({ NODE_ENV: 'production' });
    expect(resolution.source).toBe('unavailable');
    expect(resolution.keyBase64).toBeNull();
  });

  it('в dev/test использует явный тестовый ключ', () => {
    const resolution = resolveMasterKey({ NODE_ENV: 'test' });
    expect(resolution.source).toBe('dev');
    expect(resolution.keyBase64).toBe(DEV_TEST_KEY_BASE64);
    expect(Buffer.from(DEV_TEST_KEY_BASE64, 'base64')).toHaveLength(32);
  });
});

describe('SecretBox (AES-256-GCM)', () => {
  it('шифрует и расшифровывает обратно', () => {
    const box = createSecretBox(KEY);
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const payload = box.encrypt(secret);

    expect(payload).not.toContain(secret);
    expect(payload.startsWith('v1.')).toBe(true);
    expect(box.decrypt(payload)).toBe(secret);
  });

  it('даёт разный шифротекст на каждый вызов (случайный IV)', () => {
    const box = createSecretBox(KEY);
    expect(box.encrypt('one')).not.toBe(box.encrypt('one'));
  });

  it('не расшифровывает чужим ключом', () => {
    const payload = createSecretBox(KEY).encrypt('secret');
    expect(() => new SecretBox(OTHER_KEY).decrypt(payload)).toThrow();
  });

  it('не принимает подделанный шифротекст (аутентификация GCM)', () => {
    const box = createSecretBox(KEY);
    const [version, iv, tag, data] = box.encrypt('secret').split('.');
    const tampered = [
      version,
      iv,
      tag,
      data.slice(0, -2) + (data.endsWith('AA') ? 'BB' : 'AA'),
    ].join('.');
    expect(() => box.decrypt(tampered)).toThrow();
  });

  it('отклоняет некорректный формат', () => {
    expect(() => createSecretBox(KEY).decrypt('not-a-payload')).toThrow();
    expect(() => createSecretBox(KEY).decrypt('v2.a.b.c')).toThrow();
  });
});
