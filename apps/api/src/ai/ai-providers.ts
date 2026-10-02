// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Адаптеры AI-провайдеров (ТЗ §3.9): Anthropic (Claude) и OpenAI-совместимые
 * (OpenAI, OpenRouter, OpenCode Go/Zen, Gemini, DeepSeek, Mistral, Groq, xAI,
 * свой адрес — Ollama, LM Studio). Один интерфейс
 * `AiProviderAdapter.complete` для всех; сеть — через `AiHttpClient`.
 *
 * Ключ сюда приходит уже расшифрованным и наружу не отдаётся.
 */
import { randomUUID } from 'node:crypto';
import { AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL, type AiProvider } from '@puls/shared';
import type { AiHttpClient } from './ai-http';
import {
  AiProviderError,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiProviderErrorKind,
  type AiProviderSettings,
  type AiToolCall,
} from './ai.types';

export { AI_DEFAULT_BASE_URL, AI_DEFAULT_MODEL };

export interface AiProviderAdapter {
  readonly provider: AiProvider;
  complete(settings: AiProviderSettings, request: AiCompletionRequest): Promise<AiCompletionResult>;
}

/** Карта HTTP-статус провайдера → машинный код ошибки (без тел ответов). */
function kindFromStatus(status: number): AiProviderErrorKind {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 404) return 'model_not_found';
  if (status === 429) return 'limit_reached';
  return 'unknown';
}

/** Безопасно разбирает JSON-аргументы вызова инструмента. */
function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function defaultModel(settings: AiProviderSettings): string {
  return settings.model || AI_DEFAULT_MODEL[settings.provider];
}

function baseUrl(settings: AiProviderSettings): string {
  const url = (settings.baseUrl || AI_DEFAULT_BASE_URL[settings.provider] || '').replace(
    /\/+$/,
    '',
  );
  if (!url) throw new AiProviderError('unreachable');
  return url;
}

/** Версия клиента для User-Agent (OpenCode просит представляться своим именем). */
const CLIENT_VERSION = process.env.APP_VERSION?.trim() || '0.1';

/** Провайдеры, требующие идентификации клиента и id сессии. */
const OPENCODE_PROVIDERS: ReadonlySet<AiProvider> = new Set<AiProvider>([
  'opencode_go',
  'opencode_zen',
]);

/** Дополнительные заголовки конкретных провайдеров. */
export function extraHeaders(provider: AiProvider, sessionId?: string): Record<string, string> {
  if (!OPENCODE_PROVIDERS.has(provider)) return {};
  return {
    'user-agent': `puls-assistant/${CLIENT_VERSION}`,
    'x-opencode-session': sessionId || randomUUID(),
  };
}

/** Ответ провайдера — объект (не массив). */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function numberOf(...values: unknown[]): number {
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) return value;
  return 0;
}

/** Anthropic Messages API (Claude). */
class AnthropicAdapter implements AiProviderAdapter {
  readonly provider = 'anthropic' as const;

  constructor(private readonly http: AiHttpClient) {}

  async complete(
    settings: AiProviderSettings,
    request: AiCompletionRequest,
  ): Promise<AiCompletionResult> {
    const messages = request.messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content },
          ],
        };
      }
      if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
        const blocks: unknown[] = [];
        if (message.content) blocks.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls) {
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
        }
        return { role: 'assistant', content: blocks };
      }
      return { role: message.role, content: message.content };
    });

    const body: Record<string, unknown> = {
      model: defaultModel(settings),
      max_tokens: request.maxTokens ?? 1024,
      system: request.system,
      messages,
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    const response = await this.send(`${baseUrl(settings)}/v1/messages`, settings.apiKey, body);
    const payload = asRecord(response);
    const content = Array.isArray(payload.content) ? payload.content : [];
    const textParts: string[] = [];
    const toolCalls: AiToolCall[] = [];
    for (const block of content) {
      const item = asRecord(block);
      if (item.type === 'text' && typeof item.text === 'string') textParts.push(item.text);
      if (
        item.type === 'tool_use' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string'
      ) {
        toolCalls.push({ id: item.id, name: item.name, arguments: asRecord(item.input) });
      }
    }
    const usage = asRecord(payload.usage);
    return {
      text: textParts.join(''),
      toolCalls,
      tokensIn: numberOf(usage.input_tokens),
      tokensOut: numberOf(usage.output_tokens),
    };
  }

  private async send(url: string, apiKey: string, body: unknown): Promise<unknown> {
    return requestJson(
      this.http,
      url,
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    );
  }
}

/** OpenAI Chat Completions: все провайдеры, кроме Anthropic (пресеты и любые совместимые адреса). */
class OpenAiAdapter implements AiProviderAdapter {
  constructor(
    readonly provider: AiProvider,
    private readonly http: AiHttpClient,
  ) {}

  async complete(
    settings: AiProviderSettings,
    request: AiCompletionRequest,
  ): Promise<AiCompletionResult> {
    const messages: unknown[] = [{ role: 'system', content: request.system }];
    for (const message of request.messages) {
      if (message.role === 'tool') {
        messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
      } else if (
        message.role === 'assistant' &&
        message.toolCalls &&
        message.toolCalls.length > 0
      ) {
        messages.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        });
      } else {
        messages.push({ role: message.role, content: message.content });
      }
    }

    const body: Record<string, unknown> = {
      model: defaultModel(settings),
      max_tokens: request.maxTokens ?? 1024,
      messages,
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
    }

    const headers: Record<string, string> = extraHeaders(this.provider, request.sessionId);
    if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`;
    const payload = asRecord(
      await requestJson(this.http, `${baseUrl(settings)}/chat/completions`, headers, body),
    );

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const message = asRecord(asRecord(choices[0]).message);
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls: AiToolCall[] = [];
    for (const raw of rawCalls) {
      const call = asRecord(raw);
      const fn = asRecord(call.function);
      if (typeof call.id === 'string' && typeof fn.name === 'string') {
        toolCalls.push({ id: call.id, name: fn.name, arguments: parseArguments(fn.arguments) });
      }
    }
    const usage = asRecord(payload.usage);
    return {
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls,
      tokensIn: numberOf(usage.prompt_tokens),
      tokensOut: numberOf(usage.completion_tokens),
    };
  }
}

/** Общий POST с классификацией ошибок и без утечки тел ответов провайдера. */
async function requestJson(
  http: AiHttpClient,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let response;
  try {
    response = await http.post({ url, headers, body });
  } catch {
    throw new AiProviderError('unreachable');
  }
  if (!response.ok) {
    // Тело провайдера не читаем и не логируем: там могут быть детали ключа.
    throw new AiProviderError(kindFromStatus(response.status));
  }
  try {
    return await response.json();
  } catch {
    throw new AiProviderError('unknown');
  }
}

/** Список id моделей провайдера (`GET {baseUrl}/models`); ключ наружу не уходит. */
export async function listAiModels(
  provider: AiProvider,
  settings: AiProviderSettings,
  http: AiHttpClient,
): Promise<string[]> {
  const headers: Record<string, string> =
    provider === 'anthropic'
      ? { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' }
      : { ...extraHeaders(provider) };
  if (provider !== 'anthropic' && settings.apiKey)
    headers.authorization = `Bearer ${settings.apiKey}`;
  const suffix = provider === 'anthropic' ? '/v1/models' : '/models';
  let response;
  try {
    response = await http.get({ url: `${baseUrl(settings)}${suffix}`, headers, timeoutMs: 15_000 });
  } catch {
    throw new AiProviderError('unreachable');
  }
  if (!response.ok) throw new AiProviderError(kindFromStatus(response.status));
  let payload: Record<string, unknown>;
  try {
    payload = asRecord(await response.json());
  } catch {
    throw new AiProviderError('unknown');
  }
  const data = Array.isArray(payload.data) ? payload.data : [];
  const ids = data
    .map((item) => asRecord(item).id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => id.replace(/^models\//, ''));
  return [...new Set(ids)].sort().slice(0, 500);
}

/** Фабрика адаптера по провайдеру. */
export function createAiAdapter(provider: AiProvider, http: AiHttpClient): AiProviderAdapter {
  if (provider === 'anthropic') return new AnthropicAdapter(http);
  return new OpenAiAdapter(provider, http);
}
