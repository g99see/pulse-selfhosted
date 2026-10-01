// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент Telegram-бота (ТЗ §3.6, §4): состояние привязки, одноразовый код и
 * отвязка чата. Запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type { TelegramLinkCodeResponse, TelegramStatusResponse } from '@puls/shared';
import { authFetch } from './auth-client';

export const telegramApi = {
  status: () => authFetch<TelegramStatusResponse>('/api/telegram/status'),

  linkCode: () =>
    authFetch<TelegramLinkCodeResponse>('/api/telegram/link-code', { method: 'POST' }),

  unlink: () => authFetch<void>('/api/telegram/link', { method: 'DELETE' }),
};
