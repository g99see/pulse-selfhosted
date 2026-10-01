// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент уведомлений (ТЗ §3.6): правила по типам, публичный VAPID-ключ и
 * web-push-подписки. Запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type {
  NotificationRuleConfig,
  NotificationRuleInput,
  PushSubscriptionInput,
  VapidPublicKeyResponse,
} from '@puls/shared';
import { authFetch } from './auth-client';

export interface SubscriptionsResponse {
  subscriptions: { id: string; endpoint: string; userAgent: string | null; createdAt: string }[];
}

export const notificationsApi = {
  vapidPublicKey: () => authFetch<VapidPublicKeyResponse>('/api/notifications/vapid-public-key'),

  rules: () => authFetch<{ rules: NotificationRuleConfig[] }>('/api/notifications/rules'),

  updateRules: (rules: NotificationRuleInput[]) =>
    authFetch<{ rules: NotificationRuleConfig[] }>('/api/notifications/rules', {
      method: 'PUT',
      body: JSON.stringify({ rules }),
    }),

  subscriptions: () => authFetch<SubscriptionsResponse>('/api/notifications/subscriptions'),

  subscribe: (input: PushSubscriptionInput) =>
    authFetch<{ id: string; endpoint: string }>('/api/notifications/subscriptions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  unsubscribe: (endpoint: string) =>
    authFetch<void>('/api/notifications/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),
};
