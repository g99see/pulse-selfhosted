// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты генерации никнейма для новых внешних пользователей (ТЗ §3.1):
// нейтральный (без эмодзи) никнейм, валидный по NICKNAME_REGEX, уникальный.
import { describe, expect, it } from 'vitest';
import { NICKNAME_REGEX, RESERVED_NICKNAMES } from '@puls/shared';
import { generateNickname, uniqueNickname } from './nickname';

describe('generateNickname', () => {
  it('всегда проходит серверную валидацию никнейма', () => {
    for (let i = 0; i < 200; i += 1) {
      const nickname = generateNickname();
      expect(nickname).toMatch(NICKNAME_REGEX);
      expect(nickname.length).toBeLessThanOrEqual(32);
      expect(RESERVED_NICKNAMES.includes(nickname)).toBe(false);
    }
  });

  it('содержит только латиницу, цифры и дефис (без эмодзи и пробелов)', () => {
    const nickname = generateNickname();
    expect(nickname).toMatch(/^[a-z0-9-]+$/);
  });

  it('разные вызовы дают разные значения при живом random', () => {
    const values = new Set(Array.from({ length: 50 }, () => generateNickname()));
    expect(values.size).toBeGreaterThan(40);
  });
});

describe('uniqueNickname', () => {
  it('пропускает занятые варианты и берёт первый свободный', async () => {
    const taken = new Set<string>();
    const isTaken = (candidate: string) => taken.has(candidate);

    const first = await uniqueNickname(isTaken);
    expect(isTaken(first)).toBe(false);

    taken.add(first);
    const second = await uniqueNickname(isTaken);
    expect(second).not.toBe(first);
    expect(isTaken(second)).toBe(false);
  });

  it('находит свободный никнейм даже в плотно занятом пространстве', async () => {
    // Занимаем всё, что вернул бы генератор с предсказуемым random, кроме последнего.
    let calls = 0;
    const isTaken = () => {
      calls += 1;
      return calls < 3;
    };

    const nickname = await uniqueNickname(isTaken, () => 0.5, 5);
    expect(nickname).toMatch(NICKNAME_REGEX);
    expect(calls).toBe(3);
  });

  it('падает, если свободного никнейма нет за отведённые попытки', async () => {
    await expect(uniqueNickname(() => true, () => 0.5, 3)).rejects.toThrow(/никнейм/i);
  });
});
