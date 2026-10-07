// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент Telegram-бота (ТЗ §6): состояние привязки, одноразовая ссылка-подключение
 * и отвязка чата. Запросы идут через authFetch — cookie-сессия + CSRF.
 */
import type { BotConnectLinkResponse, TelegramStatusResponse } from '@puls/shared';
import { authFetch } from './auth-client';

export const telegramApi = {
  status: () => authFetch<TelegramStatusResponse>('/api/telegram/status'),

  connect: () => authFetch<BotConnectLinkResponse>('/api/telegram/connect', { method: 'POST' }),

  unlink: () => authFetch<void>('/api/telegram/link', { method: 'DELETE' }),
};
