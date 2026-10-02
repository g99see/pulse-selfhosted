// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент AI-помощника (ТЗ §3.9): статус и ключ пользователя, чат, разборы,
 * настройки экземпляра и расход. Контракт и схемы живут в `@puls/shared`
 * (ai.ts); здесь — только сетевой слой и чистые помощники для UI.
 */
import type {
  AiChatRequest,
  AiChatResponse,
  AiInstanceSettingsInput,
  AiInstanceSettingsResponse,
  AiKeySetValues,
  AiProposalDto,
  AiReviewPreviewResponse,
  AiReviewResponse,
  AiReviewValues,
  AiStatusResponse,
  AiTestResponse,
  AiUsageAdminResponse,
  Locale,
} from '@puls/shared';
import { authFetch } from './auth-client';

/**
 * Код ошибки API (ТЗ §3.9) → ключ перевода. 409 ai_not_configured — ключ не
 * подключён; 409/429 ai_limit_reached — исчерпан лимит; 502 ai_provider_error —
 * провайдер ответил ошибкой. Неизвестные коды показываем общим сообщением.
 */
export const AI_ERROR_KEYS: Record<string, string> = {
  ai_not_configured: 'ai.error.notConfigured',
  ai_limit_reached: 'ai.error.limitReached',
  ai_provider_error: 'ai.error.provider',
  invalid_key: 'ai.error.invalidKey',
  unreachable: 'ai.error.unreachable',
  model_not_found: 'ai.error.modelNotFound',
  limit_reached: 'ai.error.limitReached',
  unknown: 'ai.error.unknown',
};

/** Ключ перевода по коду ошибки API; для null/неизвестного — общее сообщение. */
export function aiErrorKey(code: string | null | undefined): string {
  if (code && code in AI_ERROR_KEYS) return AI_ERROR_KEYS[code];
  return 'ai.error.generic';
}

/** Ключ перевода по короткому коду проверки подключения (AiTestResponse.error). */
export function aiTestErrorKey(error: AiTestResponse['error']): string {
  return aiErrorKey(error ?? 'unknown');
}

/** Токены с разделителями разрядов по локали (для «расход за месяц»). */
export function formatAiTokens(tokens: number, locale: Locale): string {
  const safe = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  return safe.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US');
}

/** Примерная стоимость в USD: до цента крупные суммы, до 4 знаков — мелкие. */
export function formatAiCost(costUsd: number): string {
  const safe = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
  if (safe === 0) return '$0';
  if (safe < 0.01) return `$${safe.toFixed(4)}`;
  return `$${safe.toFixed(2)}`;
}

export const aiApi = {
  /** Состояние AI для текущего пользователя; enabled=false → функции скрыты. */
  status: () => authFetch<AiStatusResponse>('/api/ai/status'),

  /** Личный ключ пользователя: создаёт/заменяет (приоритетнее общего). */
  setKey: (input: AiKeySetValues) =>
    authFetch<AiStatusResponse>('/api/ai/key', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /** Удаляет личный ключ (204). */
  removeKey: () => authFetch<void>('/api/ai/key', { method: 'DELETE' }),

  /** Id моделей по сохранённому ключу (для подсказок в поле «Модель»). */
  models: () => authFetch<{ models: string[] }>('/api/ai/models'),

  /** Проверяет подключение текущего ключа (личного или общего). */
  testKey: () => authFetch<AiTestResponse>('/api/ai/key/test', { method: 'POST' }),

  /** Вопрос помощнику; история реплик хранится на клиенте и шлётся в history. */
  chat: (input: AiChatRequest) =>
    authFetch<AiChatResponse>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Применяет предложение (бюджет/цель/напоминание) — только по кнопке. */
  applyProposal: (id: string) =>
    authFetch<{ proposal: AiProposalDto }>(`/api/ai/proposals/${id}/apply`, {
      method: 'POST',
    }),

  /** Предпросмотр: что именно уйдёт провайдеру (ТЗ §3.9). */
  reviewPreview: (input: AiReviewValues) =>
    authFetch<AiReviewPreviewResponse>('/api/ai/review/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Разбор недели/месяца (после подтверждения предпросмотра). */
  review: (input: AiReviewValues) =>
    authFetch<AiReviewResponse>('/api/ai/review', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Админка: настройки общего ключа экземпляра. */
  adminSettings: () => authFetch<AiInstanceSettingsResponse>('/api/admin/ai/settings'),

  saveAdminSettings: (input: AiInstanceSettingsInput) =>
    authFetch<AiInstanceSettingsResponse>('/api/admin/ai/settings', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /** Админка: расход токенов по пользователям за текущий месяц. */
  adminUsage: () => authFetch<AiUsageAdminResponse>('/api/admin/ai/usage'),
};
