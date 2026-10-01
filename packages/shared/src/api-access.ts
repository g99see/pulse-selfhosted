// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Контракт открытого API и вебхуков (ТЗ §4, P2): интеграция с Home Assistant,
 * n8n и своими скриптами. Токены доступа имеют области read/write, вебхуки
 * подписываются HMAC-SHA256 и доставляются по доменным событиям.
 */
import { z } from 'zod';

/** Префикс личного токена: по нему токен узнаётся в заголовке. */
export const API_TOKEN_PREFIX = 'puls_';

/** Области доступа токена (ТЗ §4): read — только чтение, write — и запись. */
export const API_SCOPES = ['read', 'write'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** События, на которые можно подписаться (ТЗ §4). */
export const WEBHOOK_EVENTS = [
  'transaction.created',
  'checkin.created',
  'goal.milestone',
  'achievement.earned',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Заголовки доставки вебхука. */
export const WEBHOOK_EVENT_HEADER = 'X-Puls-Event';
export const WEBHOOK_SIGNATURE_HEADER = 'X-Puls-Signature';
export const WEBHOOK_DELIVERY_HEADER = 'X-Puls-Delivery';

/** Максимум попыток доставки и базовый шаг экспоненциальной паузы, мс. */
export const WEBHOOK_MAX_ATTEMPTS = 5;
export const WEBHOOK_RETRY_BASE_MS = 5_000;
/** Таймаут одного HTTP-запроса вебхука, мс. */
export const WEBHOOK_TIMEOUT_MS = 5_000;

export const apiScopeSchema = z.enum(API_SCOPES);
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);

/** Схема создания токена: имя, области (по умолчанию read) и срок жизни. */
export const ApiTokenCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z.array(apiScopeSchema).min(1).max(API_SCOPES.length).default(['read']),
    expiresAt: z.string().datetime({ offset: true }).nullish(),
  })
  .strict();
export type ApiTokenCreateInput = z.infer<typeof ApiTokenCreateSchema>;

/** Токен в списке: секрет не отдаётся, только prefix и метаданные. */
export interface ApiTokenDto {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Ответ создания: полный токен показывается ровно один раз. */
export interface ApiTokenCreatedDto extends ApiTokenDto {
  token: string;
}

export interface ApiTokensResponse {
  tokens: ApiTokenDto[];
}

/** Схема подписки на вебхук: адрес и список событий. */
export const WebhookCreateSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => /^https?:\/\//i.test(value), 'Адрес должен начинаться с http:// или https://'),
    events: z.array(webhookEventSchema).min(1).max(WEBHOOK_EVENTS.length),
    enabled: z.boolean().default(true),
  })
  .strict();
export type WebhookCreateInput = z.infer<typeof WebhookCreateSchema>;

/** Вебхук в списке: секрет не отдаётся. */
export interface WebhookDto {
  id: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Ответ создания вебхука: секрет для подписи показывается один раз. */
export interface WebhookCreatedDto extends WebhookDto {
  secret: string;
}

export interface WebhooksResponse {
  webhooks: WebhookDto[];
}

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed';

/** Запись журнала доставки (последние 50 на вебхук). */
export interface WebhookDeliveryDto {
  id: string;
  event: WebhookEvent;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface WebhookDeliveriesResponse {
  deliveries: WebhookDeliveryDto[];
}

/** Ответ проверки вебхука кнопкой «Проверить». */
export interface WebhookTestResponse {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** Заголовок Authorization с личным токеном. */
export const API_TOKEN_HEADER = 'authorization';
export const API_TOKEN_BEARER = 'Bearer';

/** Извлекает токен из заголовка `Authorization: Bearer puls_…` или null. */
export function parseApiToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]!.trim();
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;
  return token;
}
