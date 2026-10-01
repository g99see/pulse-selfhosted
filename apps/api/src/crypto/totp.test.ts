// SPDX-License-Identifier: AGPL-3.0-or-later
// TOTP по RFC 6238 (ТЗ §6). Тестовые векторы — Приложение B RFC 6238:
// секрет «12345678901234567890» (SHA-1), шаг 30 секунд.
import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode } from './base32';
import {
  generateTotpSecret,
  hotp,
  matchTotpStep,
  otpauthUri,
  totp,
  TOTP_PERIOD_SECONDS,
} from './totp';

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const RFC_SECRET_HEX = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** Векторы ТЗ: время (сек) → 8-значный код. */
const RFC_VECTORS: ReadonlyArray<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('base32 (RFC 4648)', () => {
  it('кодирует байты секрета и декодирует обратно', () => {
    const bytes = Buffer.from('12345678901234567890', 'ascii');
    expect(base32Encode(bytes)).toBe(RFC_SECRET_HEX);
    expect(base32Decode(RFC_SECRET_HEX).toString('ascii')).toBe('12345678901234567890');
  });

  it('принимает нижний регистр, пробелы и padding', () => {
    expect(base32Decode('gezd gnbvgy3tqojqgezdgnbvgy3tqojq====').toString('hex')).toBe(
      Buffer.from('12345678901234567890', 'ascii').toString('hex'),
    );
  });

  it('падает на недопустимом символе', () => {
    expect(() => base32Decode('0189')).toThrow();
  });
});

describe('HOTP/TOTP (RFC 6238)', () => {
  it('seed кодируется в ожидаемый base32', () => {
    expect(RFC_SECRET).toBe(RFC_SECRET_HEX);
  });

  it('совпадает с векторами RFC 6238 (8 цифр)', () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(hotp(base32Decode(RFC_SECRET), Math.floor(seconds / TOTP_PERIOD_SECONDS), 8)).toBe(
        expected,
      );
    }
  });

  it('совпадает с векторами RFC 6238 (6 цифр — последние 6)', () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(totp(RFC_SECRET, { timeMs: seconds * 1000 })).toBe(expected.slice(-6));
    }
  });

  it('генерирует base32-секрет длиной 32 символа (20 байт)', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it('находит верный шаг и учитывает окно ±1', () => {
    const moment = 1111111111 * 1000;
    const code = totp(RFC_SECRET, { timeMs: moment });
    const step = Math.floor(moment / 1000 / TOTP_PERIOD_SECONDS);

    expect(matchTotpStep(RFC_SECRET, code, { timeMs: moment })).toBe(step);
    // Код прошлого шага ещё принимается в пределах окна.
    expect(matchTotpStep(RFC_SECRET, code, { timeMs: moment + TOTP_PERIOD_SECONDS * 1000 })).toBe(
      step,
    );
    // Через два шага — уже нет.
    expect(
      matchTotpStep(RFC_SECRET, code, { timeMs: moment + 2 * TOTP_PERIOD_SECONDS * 1000 }),
    ).toBeNull();
  });

  it('отклоняет код неверной длины и мусор', () => {
    expect(matchTotpStep(RFC_SECRET, '12345')).toBeNull();
    expect(matchTotpStep(RFC_SECRET, 'abcdef')).toBeNull();
    expect(matchTotpStep(RFC_SECRET, '')).toBeNull();
  });

  it('строит otpauth:// URI по Key URI Format', () => {
    const uri = otpauthUri({ secret: RFC_SECRET, issuer: 'Puls', account: 'user@example.com' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    const url = new URL(uri);
    expect(url.searchParams.get('secret')).toBe(RFC_SECRET);
    expect(url.searchParams.get('issuer')).toBe('Puls');
    expect(url.searchParams.get('algorithm')).toBe('SHA1');
    expect(url.searchParams.get('digits')).toBe('6');
    expect(url.searchParams.get('period')).toBe('30');
    expect(decodeURIComponent(url.pathname)).toContain('Puls:user@example.com');
  });
});
