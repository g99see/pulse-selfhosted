// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент открытого API и вебхуков (ТЗ §4): личные токены и подписки на
 * события. Запросы идут через authFetch — cookie-сессия + CSRF; сами токены
 * не считаются сессией и передаются потребителями в заголовке Bearer.
 */
import type {
  ApiTokenCreateInput,
  ApiTokenCreatedDto,
  ApiTokensResponse,
  WebhookCreateInput,
  WebhookCreatedDto,
  WebhookDeliveriesResponse,
  WebhooksResponse,
  WebhookTestResponse,
} from '@puls/shared';
import { authFetch } from './auth-client';

export const apiAccessApi = {
  tokens: () => authFetch<ApiTokensResponse>('/api/api-tokens'),

  createToken: (input: ApiTokenCreateInput) =>
    authFetch<ApiTokenCreatedDto>('/api/api-tokens', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  revokeToken: (id: string) => authFetch<void>(`/api/api-tokens/${id}`, { method: 'DELETE' }),

  webhooks: () => authFetch<WebhooksResponse>('/api/webhooks'),

  createWebhook: (input: WebhookCreateInput) =>
    authFetch<WebhookCreatedDto>('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteWebhook: (id: string) => authFetch<void>(`/api/webhooks/${id}`, { method: 'DELETE' }),

  testWebhook: (id: string) =>
    authFetch<WebhookTestResponse>(`/api/webhooks/${id}/test`, { method: 'POST' }),

  deliveries: (id: string) =>
    authFetch<WebhookDeliveriesResponse>(`/api/webhooks/${id}/deliveries`),
};
