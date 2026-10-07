// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиент уведомлений: каналы Telegram/Discord (настройки и привязка), журнал
 * доставок. Запросы идут через authFetch — cookie-сессия + CSRF. Браузерных
 * разрешений на уведомления не запрашиваем: всё уходит в мессенджеры.
 */
import type {
  BotConnectLinkResponse,
  ChannelSettingsUpdateInput,
  DiscordStatusResponse,
  NotificationChannel,
  NotificationChannelStatus,
  NotificationDeliveryDto,
} from '@puls/shared';
import { authFetch } from './auth-client';

export const notificationsApi = {
  channels: () =>
    authFetch<{ channels: NotificationChannelStatus[] }>('/api/notifications/channels'),

  updateChannel: (channel: NotificationChannel, input: ChannelSettingsUpdateInput) =>
    authFetch<{ channels: NotificationChannelStatus[] }>(`/api/notifications/channels/${channel}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deliveries: () =>
    authFetch<{ deliveries: NotificationDeliveryDto[] }>('/api/notifications/deliveries'),
};

/**
 * Привязка канала: ссылка-подключение, отвязка. Статусы Telegram и Discord
 * различаются, поэтому не общие.
 */
export const discordApi = {
  status: () => authFetch<DiscordStatusResponse>('/api/discord/status'),
  connect: () => authFetch<BotConnectLinkResponse>('/api/discord/connect', { method: 'POST' }),
  unlink: () => authFetch<void>('/api/discord/link', { method: 'DELETE' }),
};
