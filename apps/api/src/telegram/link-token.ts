// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Одноразовые токены привязки бота (ТЗ §6): в базе хранится только SHA-256 от
 * токена, сам токен живёт 10 минут и показывается пользователю один раз —
 * внутри deep-link на бота. Здесь только чистые функции: генерация, хеш,
 * сравнение за постоянное время, классификация состояния и сборка ссылок.
 * Никакой сети и БД — всё покрыто быстрыми unit-тестами.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Срок жизни токена привязки — 10 минут (ТЗ §6). */
export const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Случайный токен привязки: 16 байт энтропии в base64url (22 символа). */
export function generateLinkToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Хеш токена для хранения в БД. base64url чувствителен к регистру, поэтому
 * регистр НЕ трогаем — иначе падает энтропия; лишние пробелы по краям убираем.
 */
export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

/** Сравнение токена с сохранённым хешем за постоянное время. */
export function linkTokenMatches(candidate: string, hash: string): boolean {
  const candidateHash = Buffer.from(hashLinkToken(candidate), 'utf8');
  const expected = Buffer.from(hash.trim(), 'utf8');
  if (candidateHash.length !== expected.length) return false;
  return timingSafeEqual(candidateHash, expected);
}

/** Символы токена привязки: латиница, цифры, дефис и подчёркивание. */
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Состояние токена привязки: пригоден, просрочен, использован или не найден. */
export type LinkTokenState = 'ok' | 'expired' | 'used' | 'missing';

export interface LinkTokenLike {
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * Классифицирует токен (ТЗ §6: обработка ошибок — просрочен, уже использован).
 * `missing` — записи нет; `used`/`expired` — токен больше не пригоден.
 */
export function linkTokenState(
  record: LinkTokenLike | null,
  now: Date = new Date(),
): LinkTokenState {
  if (record === null) return 'missing';
  if (record.usedAt !== null) return 'used';
  if (record.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'ok';
}

/** Deep-link на общего бота Pulse: https://t.me/<bot>?start=<token> (ТЗ §6). */
export function buildTelegramDeepLink(botUsername: string, token: string): string {
  const name = botUsername.trim().replace(/^@/, '');
  return `https://t.me/${name}?start=${encodeURIComponent(token)}`;
}

/**
 * OAuth-ссылка Discord с токеном привязки в `state` (ТЗ §6): пользователь
 * нажимает «Подключить», подтверждает доступ и попадает на /api/discord/callback,
 * где state проверяется, а токен гасится. Без создания собственного бота.
 */
export function buildDiscordAuthorizeUrl(
  applicationId: string,
  redirectUri: string,
  token: string,
  permissions = '0',
): string {
  const params = new URLSearchParams({
    client_id: applicationId,
    response_type: 'code',
    scope: 'identify bot',
    permissions,
    redirect_uri: redirectUri,
    state: token,
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
