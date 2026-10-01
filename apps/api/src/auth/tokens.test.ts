// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { constantTimeEqual, generateToken, hashToken } from './tokens';

describe('generateToken', () => {
  it('returns 32 random bytes encoded as URL-safe base64', () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats across many calls', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('hashToken', () => {
  it('is the stable sha-256 hex digest of the token', () => {
    const expected = createHash('sha256').update('secret-token').digest('hex');
    expect(hashToken('secret-token')).toBe(expected);
  });

  it('differs for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('constantTimeEqual', () => {
  it('is true only for identical strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
  });

  it('is false for different lengths without throwing', () => {
    expect(constantTimeEqual('abc', 'abcdef')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });
});
