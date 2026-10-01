// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { MemoryRateLimitStore } from './rate-limit.service';

describe('MemoryRateLimitStore', () => {
  it('allows requests up to the limit and blocks the next one', () => {
    const store = new MemoryRateLimitStore();
    const start = 1_000_000;

    expect(store.consume('ip:1.2.3.4', 3, 60_000, start).allowed).toBe(true);
    expect(store.consume('ip:1.2.3.4', 3, 60_000, start).remaining).toBe(1);
    expect(store.consume('ip:1.2.3.4', 3, 60_000, start).allowed).toBe(true);

    const blocked = store.consume('ip:1.2.3.4', 3, 60_000, start);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('opens a fresh window after it expires', () => {
    const store = new MemoryRateLimitStore();
    store.consume('k', 1, 1_000, 0);
    expect(store.consume('k', 1, 1_000, 500).allowed).toBe(false);

    const afterWindow = store.consume('k', 1, 1_000, 1_000);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(0);
  });

  it('keeps buckets independent per key', () => {
    const store = new MemoryRateLimitStore();
    store.consume('a', 1, 60_000, 0);
    expect(store.consume('b', 1, 60_000, 0).allowed).toBe(true);
  });

  it('reset clears a bucket (успешный вход не копит лимит)', () => {
    const store = new MemoryRateLimitStore();
    store.consume('a', 1, 60_000, 0);
    store.reset('a');
    expect(store.consume('a', 1, 60_000, 0).allowed).toBe(true);
  });

  it('drops expired buckets when pruned', () => {
    const store = new MemoryRateLimitStore();
    store.consume('a', 5, 1_000, 0);
    store.prune(2_000);
    expect(store.size).toBe(0);
  });
});
