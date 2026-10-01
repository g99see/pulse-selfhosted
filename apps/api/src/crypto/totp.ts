// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * TOTP по RFC 6238 на node:crypto (ТЗ §6): HMAC-SHA1, шаг 30 секунд,
 * 6 цифр, окно ±1. Без сторонних зависимостей.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { base32Decode, base32Encode } from './base32';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const TOTP_ALGORITHM = 'SHA1';

export interface TotpOptions {
  /** Момент проверки/расчёта, мс. По умолчанию — сейчас. */
  timeMs?: number;
  stepSeconds?: number;
  digits?: number;
  /** Полуширина окна в шагах (RFC 6238 рекомендует ±1). */
  window?: number;
}

/** Случайный base32-секрет (по умолчанию 20 байт — как в RFC 4226). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** HOTP (RFC 4226): динамический код по счётчику. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

function counterFor(timeMs: number, stepSeconds: number): number {
  return Math.floor(timeMs / 1000 / stepSeconds);
}

/** TOTP-код для момента времени. */
export function totp(secretBase32: string, options: TotpOptions = {}): string {
  const {
    timeMs = Date.now(),
    stepSeconds = TOTP_PERIOD_SECONDS,
    digits = TOTP_DIGITS,
  } = options;
  return hotp(base32Decode(secretBase32), counterFor(timeMs, stepSeconds), digits);
}

/**
 * Проверяет код и возвращает номер совпавшего шага (для защиты от повторного
 * использования), либо null. Проверяются шаги current±window.
 */
export function matchTotpStep(
  secretBase32: string,
  code: string,
  options: TotpOptions = {},
): number | null {
  const {
    timeMs = Date.now(),
    stepSeconds = TOTP_PERIOD_SECONDS,
    digits = TOTP_DIGITS,
    window = TOTP_WINDOW,
  } = options;

  const normalized = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) {
    return null;
  }

  const secret = base32Decode(secretBase32);
  const current = counterFor(timeMs, stepSeconds);

  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    if (constantTimeEqual(hotp(secret, step, digits), normalized)) {
      return step;
    }
  }

  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface OtpauthParams {
  secret: string;
  issuer: string;
  account: string;
  digits?: number;
  period?: number;
  algorithm?: string;
}

/** URI по Google Key URI Format — для ручного ввода и QR. */
export function otpauthUri({
  secret,
  issuer,
  account,
  digits = TOTP_DIGITS,
  period = TOTP_PERIOD_SECONDS,
  algorithm = TOTP_ALGORITHM,
}: OtpauthParams): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm,
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
