// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты одноразовых токенов привязки бота (ТЗ §6): токен содержит
// достаточно энтропии, в БД попадает только хеш, срок жизни ограничен,
// состояние (ok/expired/used/missing) и ссылки собираются верно.
import { describe, expect, it } from 'vitest';
import {
  buildDiscordAuthorizeUrl,
  buildTelegramDeepLink,
  generateLinkToken,
  hashLinkToken,
  linkTokenMatches,
  linkTokenState,
  LINK_TOKEN_TTL_MS,
} from './link-token';

describe('токены привязки бота (ТЗ §6)', () => {
  it('генерирует токен из допустимых символов нужной длины', () => {
    const token = generateLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(generateLinkToken()).not.toBe(token);
  });

  it('в базе лежит только хеш: токен и хеш не совпадают', () => {
    const token = generateLinkToken();
    const hash = hashLinkToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
  });

  it('сравнение токена с хешем учитывает лишние пробелы, но не регистр', () => {
    const token = 'AbCd1234efgh';
    expect(linkTokenMatches('  AbCd1234efgh ', hashLinkToken(token))).toBe(true);
    expect(linkTokenMatches('abcd1234efgh', hashLinkToken(token))).toBe(false);
  });

  it('срок жизни токена — 10 минут', () => {
    expect(LINK_TOKEN_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('классифицирует состояние токена', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    const future = new Date(now.getTime() + 60_000);
    const past = new Date(now.getTime() - 60_000);
    expect(linkTokenState(null, now)).toBe('missing');
    expect(linkTokenState({ expiresAt: future, usedAt: null }, now)).toBe('ok');
    expect(linkTokenState({ expiresAt: past, usedAt: null }, now)).toBe('expired');
    expect(linkTokenState({ expiresAt: future, usedAt: now }, now)).toBe('used');
    // Использованный токен остаётся used, даже если уже истёк.
    expect(linkTokenState({ expiresAt: past, usedAt: now }, now)).toBe('used');
  });
});

describe('ссылки подключения (ТЗ §6)', () => {
  it('deep-link Telegram на бота с токеном в start', () => {
    expect(buildTelegramDeepLink('@pulse_bot', 'abc12345')).toBe(
      'https://t.me/pulse_bot?start=abc12345',
    );
    expect(buildTelegramDeepLink('pulse_bot', 'tok-1_2')).toBe(
      'https://t.me/pulse_bot?start=tok-1_2',
    );
  });

  it('OAuth-ссылка Discord несёт токен в state и redirect_uri', () => {
    const url = buildDiscordAuthorizeUrl(
      '123',
      'https://pulse.example/api/discord/callback',
      'tok',
    );
    expect(url).toContain('https://discord.com/oauth2/authorize?');
    expect(url).toContain('client_id=123');
    expect(url).toContain('state=tok');
    expect(url).toContain('response_type=code');
    expect(decodeURIComponent(url)).toContain(
      'redirect_uri=https://pulse.example/api/discord/callback',
    );
  });
});
