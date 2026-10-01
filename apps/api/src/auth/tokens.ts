// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 случайных байта в URL-safe base64 (43 символа) — токен сессии/письма. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** В базе хранится только SHA-256 от токена (ТЗ §6). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Сравнение без утечки по времени (для CSRF-токена). */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Первые 8 символов — для логов, без раскрытия токена. */
export function tokenPreview(token: string): string {
  return `${token.slice(0, 8)}…`;
}
