// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты проверки Telegram Login Widget (ТЗ §7): hash по HMAC-SHA256 от
// SHA256(bot_token), свежесть auth_date, защита от подделки.
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TelegramAuthError,
  telegramDataCheckString,
  telegramSecretKey,
  verifyTelegramAuth,
  type TelegramAuthPayload,
} from './telegram';

const BOT_TOKEN = '123456:AAHtest-token-value';
const NOW = 1_700_000_000_000; // мс; auth_date в секундах = 1_699_999_999
const AUTH_DATE = Math.floor(NOW / 1000);

function sign(payload: Record<string, unknown>, botToken = BOT_TOKEN): TelegramAuthPayload {
  const checkString = telegramDataCheckString(payload);
  const hash = createHmac('sha256', createHash('sha256').update(botToken).digest()).update(checkString).digest('hex');
  return { ...payload, hash } as unknown as TelegramAuthPayload;
}

describe('telegramSecretKey', () => {
  it('равен SHA-256 от токена бота', () => {
    expect(telegramSecretKey(BOT_TOKEN).toString('hex')).toBe(
      createHash('sha256').update(BOT_TOKEN).digest('hex'),
    );
  });
});

describe('telegramDataCheckString', () => {
  it('сортирует ключи и исключает hash', () => {
    const line = telegramDataCheckString({ id: 5, first_name: 'Ann', hash: 'zzz', auth_date: 10 });
    expect(line).toBe('auth_date=10\nfirst_name=Ann\nid=5');
  });
});

describe('verifyTelegramAuth', () => {
  it('принимает корректную подпись и возвращает subject', () => {
    const payload = sign({ id: 42, first_name: 'Дмитрий', username: 'dmitro', auth_date: AUTH_DATE });
    const verified = verifyTelegramAuth(payload, BOT_TOKEN, { now: NOW, maxAgeSeconds: 86_400 });

    expect(verified.subject).toBe('42');
    expect(verified.firstName).toBe('Дмитрий');
    expect(verified.username).toBe('dmitro');
  });

  it('отклоняет подделку поля при валидном hash', () => {
    const payload = sign({ id: 42, first_name: 'Ann', auth_date: AUTH_DATE });
    payload.id = 43;
    expect(() => verifyTelegramAuth(payload, BOT_TOKEN, { now: NOW })).toThrow(TelegramAuthError);
  });

  it('отклоняет неверный токен бота', () => {
    const payload = sign({ id: 42, first_name: 'Ann', auth_date: AUTH_DATE }, 'another:token');
    expect(() => verifyTelegramAuth(payload, BOT_TOKEN, { now: NOW })).toThrow(TelegramAuthError);
  });

  it('отклоняет просроченный auth_date', () => {
    const payload = sign({ id: 42, first_name: 'Ann', auth_date: AUTH_DATE - 90_000 });
    expect(() => verifyTelegramAuth(payload, BOT_TOKEN, { now: NOW, maxAgeSeconds: 86_400 })).toThrow(
      /просрочен|устарел/,
    );
  });

  it('отклоняет auth_date из будущего', () => {
    const payload = sign({ id: 42, first_name: 'Ann', auth_date: AUTH_DATE + 3_600 });
    expect(() => verifyTelegramAuth(payload, BOT_TOKEN, { now: NOW })).toThrow(TelegramAuthError);
  });

  it('отклоняет отсутствие hash', () => {
    expect(() =>
      verifyTelegramAuth({ id: 42, auth_date: AUTH_DATE } as TelegramAuthPayload, BOT_TOKEN, { now: NOW }),
    ).toThrow(TelegramAuthError);
  });

  it('отклоняет отсутствие id и auth_date', () => {
    expect(() => verifyTelegramAuth(sign({ auth_date: AUTH_DATE }), BOT_TOKEN, { now: NOW })).toThrow(
      TelegramAuthError,
    );
  });

  it('не полагается на переданный hash как на данные подписи', () => {
    const payload = sign({ id: 42, first_name: 'Ann', auth_date: AUTH_DATE });
    const tampered = { ...payload, hash: payload.hash.toUpperCase() };
    expect(() => verifyTelegramAuth(tampered, BOT_TOKEN, { now: NOW })).toThrow(TelegramAuthError);
  });
});
