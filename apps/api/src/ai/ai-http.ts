// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Граница HTTP для AI-провайдеров (ТЗ §3.9). Всё сетевое скрыто за
 * `AiHttpClient`: в тестах он подменяется фейком (`overrideProvider(AI_HTTP)`),
 * поэтому автотесты никогда не ходят в Anthropic/OpenAI/Ollama.
 */
import { Logger } from '@nestjs/common';

/** Токен Nest для клиента HTTP (подменяется в тестах). */
export const AI_HTTP = Symbol('AI_HTTP');

export interface AiHttpRequest {
  url: string;
  headers: Record<string, string>;
  /** Тело запроса: сериализуется в JSON. */
  body: unknown;
  timeoutMs?: number;
}

/** Минимальный ответ: статус и разбор тела. */
export interface AiHttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface AiHttpGetRequest {
  url: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}

export interface AiHttpClient {
  post(request: AiHttpRequest): Promise<AiHttpResponse>;
  get(request: AiHttpGetRequest): Promise<AiHttpResponse>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Реализация поверх глобального fetch с таймаутом. */
export class FetchAiHttpClient implements AiHttpClient {
  private readonly logger = new Logger(FetchAiHttpClient.name);

  async get(request: AiHttpGetRequest): Promise<AiHttpResponse> {
    return this.send(request.url, 'GET', request.headers, undefined, request.timeoutMs);
  }

  async post(request: AiHttpRequest): Promise<AiHttpResponse> {
    return this.send(
      request.url,
      'POST',
      { 'content-type': 'application/json', ...request.headers },
      JSON.stringify(request.body),
      request.timeoutMs,
    );
  }

  private async send(
    url: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number | undefined,
  ): Promise<AiHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      return {
        status: response.status,
        ok: response.ok,
        json: () => response.json() as Promise<unknown>,
        text: () => response.text(),
      };
    } catch (error) {
      this.logger.warn(`Ошибка сети AI-провайдера ${url}: ${String(error)}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
