// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты состояния OAuth (ТЗ §7): PKCE S256, TTL и защита от повторного
// использования state (replay).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryOAuthStateStore, pkceChallenge } from './oauth-state.service';

describe('pkceChallenge', () => {
  it('считает base64url от SHA-256 верификатора', () => {
    const verifier = 'verifier-value';
    expect(pkceChallenge(verifier)).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
});

describe('MemoryOAuthStateStore', () => {
  it('возвращает состояние один раз и не даёт использовать повторно', async () => {
    const store = new MemoryOAuthStateStore();
    const payload = { intent: 'login' as const, codeVerifier: 'v', createdAt: Date.now() };

    await store.save('state-1', payload, 600);
    expect(await store.take('state-1')).toEqual(payload);
    expect(await store.take('state-1')).toBeNull();
  });

  it('отклоняет неизвестный state', async () => {
    const store = new MemoryOAuthStateStore();
    expect(await store.take('unknown')).toBeNull();
  });

  it('истекает по TTL', async () => {
    let now = 1_000;
    const store = new MemoryOAuthStateStore(() => now);
    await store.save(
      'state-2',
      { intent: 'link', userId: 'u1', codeVerifier: 'v', createdAt: now },
      10,
    );

    now += 10_001;
    expect(await store.take('state-2')).toBeNull();
  });

  it('сохраняет intent и userId для привязки из настроек', async () => {
    const store = new MemoryOAuthStateStore();
    await store.save(
      'state-3',
      { intent: 'link', userId: 'user-42', codeVerifier: 'v', createdAt: Date.now() },
      600,
    );
    const taken = await store.take('state-3');
    expect(taken?.intent).toBe('link');
    expect(taken?.userId).toBe('user-42');
  });
});
