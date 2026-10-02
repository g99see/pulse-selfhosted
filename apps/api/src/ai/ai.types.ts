// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Внутренние типы AI-слоя (ТЗ §3.9). Это контракт между блоками: блок A
 * (этот) реализует `AiProviderService.complete`, блок B (чат, инструменты,
 * разбор) его потребляет и ничего не знает про ключи и провайдеров.
 *
 * Публичные DTO (статус, настройки, чат) живут в `@puls/shared/ai`.
 */
import type { AiProvider } from '@puls/shared';

/** Роль сообщения во внутреннем диалоге с моделью. */
export type AiRole = 'user' | 'assistant' | 'tool';

/** Сообщение диалога: tool-сообщение несёт результат вызова инструмента. */
export interface AiMessage {
  role: AiRole;
  content: string;
  /** Только для role='assistant': запрошенные вызовы инструментов. */
  toolCalls?: AiToolCall[];
  /** Только для role='tool': id вызова, на который отвечает это сообщение. */
  toolCallId?: string;
}

/** Запрошенный моделью вызов инструмента. */
export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Описание инструмента для модели: JSON-схема параметров. */
export interface AiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Запрос на завершение. `complete` сам решает, каким ключом и моделью звать. */
export interface AiCompletionRequest {
  system: string;
  messages: AiMessage[];
  tools?: AiTool[];
  maxTokens?: number;
  /** Стабильный id диалога (нужен OpenCode Go/Zen: заголовок x-opencode-session). */
  sessionId?: string;
}

/** Результат завершения с учётом токенов (для AiUsage). */
export interface AiCompletionResult {
  text: string;
  toolCalls: AiToolCall[];
  tokensIn: number;
  tokensOut: number;
}

/** Готовые к вызову настройки провайдера (ключ расшифрован). */
export interface AiProviderSettings {
  provider: AiProvider;
  apiKey: string;
  baseUrl: string | null;
  model: string;
}

/** Классификация ошибок провайдера — без тел ответов и секретов. */
export type AiProviderErrorKind =
  'invalid_key' | 'unreachable' | 'model_not_found' | 'limit_reached' | 'unknown';

/** Ошибка при обращении к провайдеру: несёт только машинный код. */
export class AiProviderError extends Error {
  constructor(readonly kind: AiProviderErrorKind) {
    super(`AI provider error: ${kind}`);
    this.name = 'AiProviderError';
  }
}
