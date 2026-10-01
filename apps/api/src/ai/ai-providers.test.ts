// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты адаптеров AI-провайдеров (ТЗ §3.9): сборка запроса и разбор ответа
// для Anthropic и OpenAI-совместимых. Сеть подменена фейком — реальных вызовов нет.
import { describe, expect, it } from 'vitest';
import { AiProviderError, type AiCompletionRequest, type AiProviderSettings } from './ai.types';
import type { AiHttpClient, AiHttpRequest, AiHttpResponse } from './ai-http';
import { createAiAdapter } from './ai-providers';

interface Recorded {
  request: AiHttpRequest;
}

function fakeHttp(response: Partial<AiHttpResponse> & { body?: unknown; throwError?: Error }): {
  http: AiHttpClient;
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];
  const http: AiHttpClient = {
    async post(request) {
      recorded.push({ request });
      if (response.throwError) throw response.throwError;
      const body = response.body ?? {};
      return {
        status: response.status ?? 200,
        ok: response.ok ?? true,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
  };
  return { http, recorded };
}

function anthropicSettings(overrides: Partial<AiProviderSettings> = {}): AiProviderSettings {
  return {
    provider: 'anthropic',
    apiKey: 'sk-ant-secret',
    baseUrl: null,
    model: 'claude-3-5-haiku-latest',
    ...overrides,
  };
}

const simpleRequest: AiCompletionRequest = {
  system: 'Ты помощник',
  messages: [{ role: 'user', content: 'Привет' }],
};

describe('Адаптер Anthropic', () => {
  it('собирает запрос /v1/messages и разбирает текст, инструменты и токены', async () => {
    const { http, recorded } = fakeHttp({
      body: {
        content: [
          { type: 'text', text: 'Здравствуйте' },
          { type: 'tool_use', id: 'tu_1', name: 'propose_budget', input: { limit: 1000 } },
        ],
        usage: { input_tokens: 120, output_tokens: 45 },
      },
    });
    const adapter = createAiAdapter('anthropic', http);
    const result = await adapter.complete(anthropicSettings(), simpleRequest);

    expect(recorded[0].request.url).toBe('https://api.anthropic.com/v1/messages');
    expect(recorded[0].request.headers['x-api-key']).toBe('sk-ant-secret');
    expect(recorded[0].request.headers['anthropic-version']).toBeTruthy();
    const body = recorded[0].request.body as Record<string, unknown>;
    expect(body.system).toBe('Ты помощник');
    expect(body.model).toBe('claude-3-5-haiku-latest');

    expect(result.text).toBe('Здравствуйте');
    expect(result.toolCalls).toEqual([
      { id: 'tu_1', name: 'propose_budget', arguments: { limit: 1000 } },
    ]);
    expect(result.tokensIn).toBe(120);
    expect(result.tokensOut).toBe(45);
  });

  it('передаёт инструменты как input_schema и результат tool-сообщения как tool_result', async () => {
    const { http, recorded } = fakeHttp({
      body: {
        content: [{ type: 'text', text: 'ок' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    const adapter = createAiAdapter('anthropic', http);
    await adapter.complete(anthropicSettings(), {
      system: 'sys',
      tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tu_9', name: 't', arguments: { a: 1 } }],
        },
        { role: 'tool', content: 'результат', toolCallId: 'tu_9' },
      ],
    });

    const body = recorded[0].request.body as { messages: unknown[]; tools: unknown[] };
    expect(body.tools).toEqual([{ name: 't', description: 'd', input_schema: { type: 'object' } }]);
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_9', name: 't', input: { a: 1 } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_9', content: 'результат' }],
      },
    ]);
  });
});

describe('Адаптер OpenAI-совместимый', () => {
  it('для openai берёт /v1/chat/completions и Bearer-ключ', async () => {
    const { http, recorded } = fakeHttp({
      body: {
        choices: [{ message: { content: 'Привет!', tool_calls: [] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    });
    const adapter = createAiAdapter('openai', http);
    const result = await adapter.complete(
      { provider: 'openai', apiKey: 'sk-openai', baseUrl: null, model: 'gpt-4o-mini' },
      simpleRequest,
    );

    expect(recorded[0].request.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(recorded[0].request.headers.authorization).toBe('Bearer sk-openai');
    expect(result).toEqual({ text: 'Привет!', toolCalls: [], tokensIn: 10, tokensOut: 5 });
  });

  it('разбирает tool_calls с JSON-аргументами', async () => {
    const { http } = fakeHttp({
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'propose_goal', arguments: '{"title":"Отпуск"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      },
    });
    const adapter = createAiAdapter('openai', http);
    const result = await adapter.complete(
      { provider: 'openai', apiKey: 'sk', baseUrl: null, model: 'gpt-4o-mini' },
      simpleRequest,
    );
    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'propose_goal', arguments: { title: 'Отпуск' } },
    ]);
  });

  it('для openrouter использует его базовый адрес по умолчанию', async () => {
    const { http, recorded } = fakeHttp({
      body: { choices: [{ message: { content: 'x' } }], usage: {} },
    });
    const adapter = createAiAdapter('openrouter', http);
    await adapter.complete(
      { provider: 'openrouter', apiKey: 'sk-or', baseUrl: null, model: 'openai/gpt-4o-mini' },
      simpleRequest,
    );
    expect(recorded[0].request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('для openai_compatible требует baseUrl и кладёт system первым сообщением', async () => {
    const { http, recorded } = fakeHttp({
      body: { choices: [{ message: { content: 'локально' } }], usage: {} },
    });
    const adapter = createAiAdapter('openai_compatible', http);
    await adapter.complete(
      {
        provider: 'openai_compatible',
        apiKey: '',
        baseUrl: 'http://ollama:11434/v1',
        model: 'llama3.1',
      },
      simpleRequest,
    );
    expect(recorded[0].request.url).toBe('http://ollama:11434/v1/chat/completions');
    const body = recorded[0].request.body as { messages: Array<{ role: string }> };
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Ты помощник' });
  });

  it('маппит tool-сообщение в роль tool с tool_call_id', async () => {
    const { http, recorded } = fakeHttp({
      body: { choices: [{ message: { content: 'ок' } }], usage: {} },
    });
    const adapter = createAiAdapter('openai', http);
    await adapter.complete(
      { provider: 'openai', apiKey: 'sk', baseUrl: null, model: 'gpt-4o-mini' },
      {
        system: 's',
        tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
        messages: [
          {
            role: 'assistant',
            content: 'думаю',
            toolCalls: [{ id: 'c1', name: 't', arguments: { a: 1 } }],
          },
          { role: 'tool', content: 'результат', toolCallId: 'c1' },
        ],
      },
    );
    const body = recorded[0].request.body as {
      messages: unknown[];
      tools: unknown[];
    };
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 't', description: 'd', parameters: { type: 'object' } },
      },
    ]);
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      {
        role: 'assistant',
        content: 'думаю',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{"a":1}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'результат' },
    ]);
  });
});

describe('Классификация ошибок провайдера', () => {
  it.each([
    [401, 'invalid_key'],
    [403, 'invalid_key'],
    [404, 'model_not_found'],
    [429, 'limit_reached'],
    [500, 'unknown'],
  ])('статус %i → %s', async (status, kind) => {
    const { http } = fakeHttp({ status, ok: false, body: { error: 'secret details' } });
    const adapter = createAiAdapter('openai', http);
    await expect(
      adapter.complete(
        { provider: 'openai', apiKey: 'sk', baseUrl: null, model: 'gpt-4o-mini' },
        simpleRequest,
      ),
    ).rejects.toMatchObject({ kind });
  });

  it('сетевая ошибка → unreachable, без утечки деталей', async () => {
    const { http } = fakeHttp({ throwError: new Error('ECONNREFUSED 1.2.3.4') });
    const adapter = createAiAdapter('anthropic', http);
    const error = await adapter.complete(anthropicSettings(), simpleRequest).then(
      () => null,
      (e: unknown) => e as AiProviderError,
    );
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error!.kind).toBe('unreachable');
    expect(error!.message).not.toContain('1.2.3.4');
  });
});
