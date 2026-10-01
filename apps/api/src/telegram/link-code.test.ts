// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты одноразовых кодов привязки Telegram (ТЗ §3.6): код содержит
// достаточно энтропии, в БД попадает только хеш, срок жизни ограничен.
import { describe, expect, it } from 'vitest';
import { generateLinkCode, hashLinkCode, linkCodeMatches, LINK_CODE_TTL_MS } from './link-code';

describe('коды привязки Telegram', () => {
  it('генерирует код из допустимых символов нужной длины', () => {
    const code = generateLinkCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{8,32}$/);
    expect(generateLinkCode()).not.toBe(code);
  });

  it('в базе лежит только хеш: код и хеш не совпадают', () => {
    const code = generateLinkCode();
    const hash = hashLinkCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(code);
  });

  it('сравнение кода с хешем учитывает регистр и лишние пробелы', () => {
    const code = 'AbCd1234';
    expect(linkCodeMatches('  abcd1234 ', hashLinkCode(code))).toBe(true);
    expect(linkCodeMatches('abcd12345', hashLinkCode(code))).toBe(false);
  });

  it('срок жизни кода — 10 минут', () => {
    expect(LINK_CODE_TTL_MS).toBe(10 * 60 * 1000);
  });
});
