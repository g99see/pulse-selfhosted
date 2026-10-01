// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../src/lib/i18n';
import { aiErrorKey, aiTestErrorKey, formatAiCost, formatAiTokens } from '../src/lib/ai-client';

describe('AI-клиент: коды ошибок → i18n (ТЗ §3.9)', () => {
  it('переводит коды ошибок API', () => {
    expect(aiErrorKey('ai_not_configured')).toBe('ai.error.notConfigured');
    expect(aiErrorKey('ai_limit_reached')).toBe('ai.error.limitReached');
    expect(aiErrorKey('ai_provider_error')).toBe('ai.error.provider');
  });

  it('переводит короткие коды проверки подключения', () => {
    expect(aiTestErrorKey('invalid_key')).toBe('ai.error.invalidKey');
    expect(aiTestErrorKey('unreachable')).toBe('ai.error.unreachable');
    expect(aiTestErrorKey('model_not_found')).toBe('ai.error.modelNotFound');
    expect(aiTestErrorKey(undefined)).toBe('ai.error.unknown');
  });

  it('неизвестный или пустой код — общее сообщение', () => {
    expect(aiErrorKey('nope')).toBe('ai.error.generic');
    expect(aiErrorKey(null)).toBe('ai.error.generic');
    expect(aiErrorKey(undefined)).toBe('ai.error.generic');
  });

  it('все ключи ошибок есть в обоих словарях', () => {
    const keys = [
      'ai.error.generic',
      'ai.error.notConfigured',
      'ai.error.limitReached',
      'ai.error.provider',
      'ai.error.invalidKey',
      'ai.error.unreachable',
      'ai.error.modelNotFound',
      'ai.error.unknown',
    ];
    for (const key of keys) {
      expect(MESSAGES.ru[key], `ru: ${key}`).toBeTruthy();
      expect(MESSAGES.en[key], `en: ${key}`).toBeTruthy();
    }
  });
});

describe('форматирование расхода (ТЗ §3.9)', () => {
  it('разделяет разряды токенов по локали', () => {
    expect(formatAiTokens(1234567, 'ru')).toMatch(/1\s234\s567/);
    expect(formatAiTokens(1234567, 'en')).toBe('1,234,567');
  });

  it('округляет токены и не уходит в минус', () => {
    expect(formatAiTokens(1500.6, 'en')).toBe('1,501');
    expect(formatAiTokens(-5, 'en')).toBe('0');
    expect(formatAiTokens(Number.NaN, 'en')).toBe('0');
  });

  it('стоимость: ноль, мелкие и крупные суммы', () => {
    expect(formatAiCost(0)).toBe('$0');
    expect(formatAiCost(0.0034)).toBe('$0.0034');
    expect(formatAiCost(1.5)).toBe('$1.50');
    expect(formatAiCost(Number.NaN)).toBe('$0');
  });
});
