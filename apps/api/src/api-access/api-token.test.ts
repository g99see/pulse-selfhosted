// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { API_TOKEN_PREFIX, parseApiToken } from '@puls/shared';
import { hashToken } from '../auth/tokens';
import { apiTokenPrefix, generateApiToken } from './api-token';

describe('Личный токен доступа (ТЗ §4)', () => {
  it('имеет префикс puls_ и 32 байта энтропии', () => {
    const token = generateApiToken();
    expect(token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    // 43 символа base64url = 32 байта.
    expect(token.length).toBe(API_TOKEN_PREFIX.length + 43);
    expect(generateApiToken()).not.toBe(token);
  });

  it('в БД кладётся SHA-256, а не сам токен', () => {
    const token = generateApiToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });

  it('prefix показывает начало токена и не раскрывает его целиком', () => {
    const token = generateApiToken();
    const prefix = apiTokenPrefix(token);
    expect(prefix).toBe(token.slice(0, 12));
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(token.length);
  });

  it('parseApiToken достаёт токен из Bearer и отбрасывает мусор', () => {
    const token = generateApiToken();
    expect(parseApiToken(`Bearer ${token}`)).toBe(token);
    expect(parseApiToken(`bearer ${token}`)).toBe(token);
    expect(parseApiToken('Basic abc')).toBeNull();
    expect(parseApiToken('Bearer not-a-puls-token')).toBeNull();
    expect(parseApiToken(undefined)).toBeNull();
    expect(parseApiToken('')).toBeNull();
  });
});
