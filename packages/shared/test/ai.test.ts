// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_PRICE_PER_MTOK,
  AI_PROVIDERS,
  AiKeySetSchema,
  estimateAiCostUsd,
} from '../src';

const PRESETS = [
  'opencode_go',
  'opencode_zen',
  'google',
  'deepseek',
  'mistral',
  'groq',
  'xai',
] as const;

describe('AI-провайдеры: пресеты', () => {
  it.each(PRESETS)('%s: есть в списке, адрес, модель и цена заданы', (provider) => {
    expect(AI_PROVIDERS).toContain(provider);
    expect(AI_DEFAULT_BASE_URL[provider]).toMatch(/^https:\/\//);
    expect(AI_DEFAULT_MODEL[provider]).toBeTruthy();
    expect(AI_PRICE_PER_MTOK[provider]).toBeDefined();
  });

  it.each(PRESETS)('%s: ключ ≥ 8 символов обязателен, baseUrl необязателен', (provider) => {
    expect(AiKeySetSchema.safeParse({ provider, apiKey: 'short' }).success).toBe(false);
    expect(AiKeySetSchema.safeParse({ provider, apiKey: 'long-enough-key' }).success).toBe(true);
    expect(
      AiKeySetSchema.safeParse({
        provider,
        apiKey: 'long-enough-key',
        baseUrl: 'https://proxy.example/v1',
      }).success,
    ).toBe(true);
  });

  it('openai_compatible по-прежнему требует baseUrl, но не ключ', () => {
    expect(AiKeySetSchema.safeParse({ provider: 'openai_compatible', apiKey: '' }).success).toBe(
      false,
    );
    expect(
      AiKeySetSchema.safeParse({
        provider: 'openai_compatible',
        apiKey: '',
        baseUrl: 'http://localhost:11434/v1',
      }).success,
    ).toBe(true);
  });

  it('OpenCode Go — подписка: расход не считается', () => {
    expect(estimateAiCostUsd('opencode_go', 1_000_000, 1_000_000)).toBe(0);
    expect(estimateAiCostUsd('opencode_zen', 1_000_000, 0)).toBeGreaterThan(0);
  });
});
