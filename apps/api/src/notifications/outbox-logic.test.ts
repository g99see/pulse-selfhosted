// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  BASE_BACKOFF_MS,
  DeliveryError,
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  backoffDelayMs,
  classifyDiscordError,
  classifyTelegramError,
  stateAfterFailure,
} from './outbox-logic';

describe('backoffDelayMs', () => {
  it('растёт вдвое с каждой неудачей', () => {
    expect([1, 2, 3, 4].map(backoffDelayMs)).toEqual([
      BASE_BACKOFF_MS,
      BASE_BACKOFF_MS * 2,
      BASE_BACKOFF_MS * 4,
      BASE_BACKOFF_MS * 8,
    ]);
  });

  it('не превышает потолок', () => {
    expect(backoffDelayMs(30)).toBe(MAX_BACKOFF_MS);
  });
});

describe('stateAfterFailure', () => {
  const now = new Date('2026-10-01T10:00:00Z');

  it('обычная ошибка: queued с backoff', () => {
    const state = stateAfterFailure(0, new Error('timeout'), now);
    expect(state.status).toBe('queued');
    expect(state.attempts).toBe(1);
    expect(state.nextAttemptAt.getTime()).toBe(now.getTime() + BASE_BACKOFF_MS);
    expect(state.lastError).toBe('timeout');
  });

  it('пятая неудача — failed', () => {
    expect(stateAfterFailure(MAX_ATTEMPTS - 1, new Error('x'), now).status).toBe('failed');
    expect(stateAfterFailure(MAX_ATTEMPTS - 2, new Error('x'), now).status).toBe('queued');
  });

  it('заблокированный получатель — blocked сразу, без повторов', () => {
    const state = stateAfterFailure(0, new DeliveryError('blocked', { blocked: true }), now);
    expect(state.status).toBe('blocked');
    expect(state.attempts).toBe(1);
  });

  it('уважает Retry-After, если он больше backoff', () => {
    const state = stateAfterFailure(0, new DeliveryError('429', { retryAfterMs: 5 * 60_000 }), now);
    expect(state.nextAttemptAt.getTime()).toBe(now.getTime() + 5 * 60_000);
  });
});

describe('classifyTelegramError', () => {
  it('403 «bot was blocked by the user» → blocked', () => {
    const error = classifyTelegramError({
      error_code: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
    expect(error.blocked).toBe(true);
  });

  it('429 несёт retry_after', () => {
    const error = classifyTelegramError({
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 7 },
    });
    expect(error.blocked).toBe(false);
    expect(error.options.retryAfterMs).toBe(7000);
  });

  it('прочие ошибки — повторяемые', () => {
    expect(classifyTelegramError(new Error('ECONNRESET')).blocked).toBe(false);
  });
});

describe('classifyDiscordError', () => {
  it('код 50007 → blocked', () => {
    expect(
      classifyDiscordError({
        status: 403,
        code: 50007,
        message: 'Cannot send messages to this user',
      }).blocked,
    ).toBe(true);
  });

  it('прочие коды — повторяемые, Retry-After сохраняется', () => {
    const error = classifyDiscordError({ status: 429, code: 0, retryAfterMs: 1500 });
    expect(error.blocked).toBe(false);
    expect(error.options.retryAfterMs).toBe(1500);
  });
});
