// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Одноразовые коды привязки Telegram (ТЗ §3.6): в базе хранится только SHA-256
 * от кода, сам код живёт 10 минут и показывается пользователю один раз.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Срок жизни кода привязки — 10 минут (ТЗ §3.6). */
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

/** Случайный код привязки: 12 байт энтропии в base64url (16 символов). */
export function generateLinkCode(): string {
  return randomBytes(12).toString('base64url');
}

/** Хеш кода для хранения в БД. Регистр и пробелы не значимы. */
export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

/** Сравнение введённого кода с сохранённым хешем за постоянное время. */
export function linkCodeMatches(candidate: string, hash: string): boolean {
  const candidateHash = Buffer.from(hashLinkCode(candidate), 'utf8');
  const expected = Buffer.from(hash.trim().toLowerCase(), 'utf8');
  if (candidateHash.length !== expected.length) return false;
  return timingSafeEqual(candidateHash, expected);
}
