// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Выполнение запросов к AI-провайдеру (ТЗ §3.9): выбор ключа (личный > общий),
 * проверка месячного лимита токенов для общего ключа, вызов адаптера и учёт
 * расхода. Единственная точка, которую использует блок B (чат, инструменты,
 * разбор), — `complete`; про ключи он ничего не знает.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  estimateAiCostUsd,
  type AiInstanceSettingsInput,
  type AiProvider,
  type AiTestResponse,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { AI_HTTP, type AiHttpClient } from './ai-http';
import { AiKeyService } from './ai-key.service';
import { AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL, createAiAdapter } from './ai-providers';
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiProviderSettings,
} from './ai.types';

const PING_MAX_TOKENS = 8;

@Injectable()
export class AiProviderService {
  constructor(
    private readonly keys: AiKeyService,
    @Inject(AI_HTTP) private readonly http: AiHttpClient,
  ) {}

  /** Завершает запрос выбранным ключом и записывает расход токенов. */
  async complete(userId: string, request: AiCompletionRequest): Promise<AiCompletionResult> {
    const resolved = await this.keys.resolve(userId);
    if (!resolved.provider || !resolved.settings) {
      throw httpError(409, 'ai_not_configured', 'AI-помощник не настроен: подключите ключ');
    }
    await this.assertWithinLimit(userId, resolved.source);

    const adapter = createAiAdapter(resolved.provider, this.http);
    let result: AiCompletionResult;
    try {
      result = await adapter.complete(resolved.settings, request);
    } catch (error) {
      throw toHttpError(error);
    }

    const cost = estimateAiCostUsd(resolved.provider, result.tokensIn, result.tokensOut);
    await this.keys.recordUsage(userId, result.tokensIn, result.tokensOut, cost);
    return result;
  }

  /** «Проверить подключение» для текущего пользователя (его ключ или общий). */
  async testConnection(userId: string): Promise<AiTestResponse> {
    const resolved = await this.keys.resolve(userId);
    if (!resolved.provider || !resolved.settings) {
      throw httpError(409, 'ai_not_configured', 'AI-помощник не настроен: подключите ключ');
    }
    return this.ping(resolved.provider, resolved.settings);
  }

  /** Проверка настроек из админки до сохранения (новый ключ может быть не сохранён). */
  async testInstanceSettings(input: AiInstanceSettingsInput): Promise<AiTestResponse> {
    const current = await this.keys.getInstanceSettings();
    const provider = input.provider ?? current.provider;
    if (!provider) {
      throw httpError(409, 'ai_not_configured', 'Выберите AI-провайдера');
    }

    let apiKey = input.apiKey ?? '';
    if (apiKey.length === 0) {
      // Ключ не передан — берём сохранённый (расшифрованный).
      const stored = await this.keys.resolveInstanceKey();
      if (stored?.provider === provider) apiKey = stored.settings?.apiKey ?? '';
      if (!apiKey && provider !== 'openai_compatible') {
        throw httpError(409, 'ai_not_configured', 'Укажите ключ');
      }
    }

    const baseUrl = input.baseUrl === undefined ? current.baseUrl : input.baseUrl;
    const model = input.model ?? current.model ?? AI_DEFAULT_MODEL[provider];

    if (provider === 'openai_compatible' && !(baseUrl || AI_DEFAULT_BASE_URL[provider])) {
      throw httpError(400, 'validation_error', 'Укажите адрес сервера');
    }

    return this.ping(provider, { provider, apiKey, baseUrl, model });
  }

  private async assertWithinLimit(userId: string, source: string): Promise<void> {
    if (source !== 'instance') return;
    const usage = await this.keys.usage(userId);
    if (usage.limitTokens !== null && usage.tokensIn + usage.tokensOut >= usage.limitTokens) {
      throw httpError(429, 'ai_limit_reached', 'Достигнут месячный лимит токенов');
    }
  }

  private async ping(provider: AiProvider, settings: AiProviderSettings): Promise<AiTestResponse> {
    const adapter = createAiAdapter(provider, this.http);
    try {
      await adapter.complete(settings, {
        system: 'ping',
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: PING_MAX_TOKENS,
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof AiProviderError) return { ok: false, error: error.kind };
      return { ok: false, error: 'unknown' };
    }
  }
}

/** Ошибка адаптера → единый формат API, без деталей провайдера. */
function toHttpError(error: unknown): Error {
  if (error instanceof AiProviderError) {
    return httpError(502, 'ai_provider_error', 'AI-провайдер недоступен или вернул ошибку', {
      reason: error.kind,
    });
  }
  return httpError(502, 'ai_provider_error', 'Не удалось обратиться к AI-провайдеру');
}
