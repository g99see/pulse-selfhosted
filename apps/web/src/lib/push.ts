// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Клиентские утилиты web push (ТЗ §3.6, §9): преобразование VAPID-ключа и
 * подписка браузера. Чистые функции вынесены отдельно и покрыты тестами.
 */
import { API_BASE_URL } from './api';

/** VAPID-ключ из base64url в Uint8Array для applicationServerKey. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw =
    typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');

  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

/** Поддерживает ли браузер web push с сервис-воркером. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export interface SerializedSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

/** Приводит PushSubscription браузера к телу запроса API. */
export function serializeSubscription(
  subscription: PushSubscription,
  userAgent?: string,
): SerializedSubscription | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;

  return { endpoint: json.endpoint, keys: { p256dh, auth }, userAgent };
}

/**
 * Подписывает браузер на push по публичному VAPID-ключу. Возвращает
 * сериализованную подписку или null, если не удалось.
 */
export async function subscribeToPush(publicKey: string): Promise<SerializedSubscription | null> {
  if (!pushSupported()) return null;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  return serializeSubscription(subscription, navigator.userAgent);
}

/** Отписывает браузер и возвращает endpoint для удаления на сервере. */
export async function unsubscribeFromPush(): Promise<string | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

/** Абсолютный адрес API для запросов из сервис-воркера (ТЗ §9). */
export function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/+$/, '')}${path}`;
}
