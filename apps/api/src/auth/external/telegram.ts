// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Проверка данных Telegram Login Widget (ТЗ §7).
 *
 * Алгоритм из документации Telegram: секрет — SHA-256 от токена бота, а hash —
 * HMAC-SHA256 по строке «ключ=значение», где все поля кроме hash отсортированы
 * по имени и соединены переводом строки. Дополнительно проверяется свежесть
 * auth_date, чтобы перехваченный вход не жил вечно.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Данные, которые Telegram подписывает и присылает в виджете. */
export interface TelegramAuthPayload {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
  [key: string]: unknown;
}

export interface TelegramVerifiedUser {
  subject: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}

export class TelegramAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramAuthError';
  }
}

/** По умолчанию вход действителен сутки — как рекомендует Telegram. */
export const TELEGRAM_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Допустимое расхождение часов в сторону будущего (секунды). */
const FUTURE_SKEW_SECONDS = 60;

const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** Секретный ключ Telegram: SHA-256 от токена бота. */
export function telegramSecretKey(botToken: string): Buffer {
  return createHash('sha256').update(botToken).digest();
}

/**
 * Строка для подписи: поля кроме hash, отсортированные по ключу, «ключ=значение».
 * Отсутствующие и null-значения не участвуют.
 */
export function telegramDataCheckString(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .sort()
    .join('\n');
}

interface VerifyOptions {
  now?: number;
  maxAgeSeconds?: number;
}

/** Проверяет подпись и свежесть. Бросает TelegramAuthError при любой проблеме. */
export function verifyTelegramAuth(
  payload: TelegramAuthPayload,
  botToken: string,
  options: VerifyOptions = {},
): TelegramVerifiedUser {
  const now = options.now ?? Date.now();
  const maxAgeSeconds = options.maxAgeSeconds ?? TELEGRAM_MAX_AGE_SECONDS;

  if (!payload || typeof payload !== 'object') {
    throw new TelegramAuthError('Нет данных Telegram');
  }

  const hash = typeof payload.hash === 'string' ? payload.hash : '';
  if (!HASH_PATTERN.test(hash)) {
    throw new TelegramAuthError('Подпись Telegram отсутствует или некорректна');
  }

  if (payload.id === undefined || payload.id === null || String(payload.id).length === 0) {
    throw new TelegramAuthError('В данных Telegram нет идентификатора');
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new TelegramAuthError('В данных Telegram нет даты авторизации');
  }

  const checkString = telegramDataCheckString(payload as unknown as Record<string, unknown>);
  const expected = createHmac('sha256', telegramSecretKey(botToken)).update(checkString).digest();
  const provided = Buffer.from(hash, 'hex');

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new TelegramAuthError('Подпись Telegram недействительна');
  }

  const nowSeconds = Math.floor(now / 1000);
  const age = nowSeconds - authDate;
  if (age > maxAgeSeconds) {
    throw new TelegramAuthError('Данные Telegram просрочены');
  }
  if (age < -FUTURE_SKEW_SECONDS) {
    throw new TelegramAuthError('Дата авторизации Telegram в будущем');
  }

  return {
    subject: String(payload.id),
    firstName: typeof payload.first_name === 'string' ? payload.first_name : undefined,
    lastName: typeof payload.last_name === 'string' ? payload.last_name : undefined,
    username: typeof payload.username === 'string' ? payload.username : undefined,
  };
}
