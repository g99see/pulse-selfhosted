// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Обработчик push в service worker (ТЗ §3.6, §9): показывает уведомление и
 * позволяет ответить на чек-ин прямо из него.
 *
 * Действие «ответить из уведомления»: сервер вкладывает в payload кнопки
 * настроения 1–5 (`mood-1`…`mood-5`) и путь `checkinUrl` (по умолчанию
 * `/api/checkins`). По нажатию кнопки service worker отправляет
 * `POST /api/checkins` с телом `{ mood }`.
 *
 * CSRF: API защищён схемой double-submit (cookie + заголовок). Service worker
 * не может прочитать document.cookie, поэтому получает одноразовый токен
 * через `GET /api/auth/csrf` — сервер отдаёт его и в теле, и в cookie, а
 * запрос идёт с credentials: 'include', так что значения совпадают.
 *
 * Подключается из sw.ts: `registerPushHandlers()`.
 */
import { API_BASE_URL } from './lib/api';

/** Путь API чек-инов, согласованный с модулем чек-инов (ТЗ §3.3, §9). */
export const DEFAULT_CHECKIN_PATH = '/api/checkins';
export const CSRF_PATH = '/api/auth/csrf';

export interface PushPayload {
  type: string;
  title: string;
  body: string;
  url?: string;
  checkinUrl?: string;
  actions?: { action: string; title: string }[];
  data?: { url?: string } & Record<string, unknown>;
}

/** Действия-кнопки уведомления: тип есть в спецификации push, но не в lib.dom. */
export interface PushNotificationOptions extends NotificationOptions {
  actions?: { action: string; title: string }[];
}

export interface PushScopeLike {
  addEventListener(type: 'push', listener: (event: PushEventLike) => void): void;
  addEventListener(
    type: 'notificationclick',
    listener: (event: NotificationClickEventLike) => void,
  ): void;
  registration: {
    showNotification(title: string, options?: PushNotificationOptions): Promise<void>;
  };
  clients?: {
    openWindow(url: string): Promise<unknown>;
    matchAll(options: {
      type: string;
      includeUncontrolled?: boolean;
    }): Promise<Array<{ url: string; focus(): Promise<unknown> }>>;
    claim?(): Promise<void>;
  };
  location?: { origin: string };
}

export interface PushEventLike {
  data?: { json(): unknown } | null;
  waitUntil(promise: Promise<unknown>): void;
}

export interface NotificationClickEventLike {
  action?: string;
  notification: { data?: unknown; close(): void };
  waitUntil(promise: Promise<unknown>): void;
}

/** Разбирает payload push; null — если данные некорректны. */
export function parsePushPayload(raw: unknown): PushPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.title !== 'string' || typeof value.body !== 'string') return null;

  const actions = Array.isArray(value.actions)
    ? value.actions
        .filter(
          (action): action is { action: string; title: string } =>
            Boolean(action) &&
            typeof (action as { action?: unknown }).action === 'string' &&
            typeof (action as { title?: unknown }).title === 'string',
        )
        .slice(0, 2)
    : undefined;

  return {
    type: typeof value.type === 'string' ? value.type : 'unknown',
    title: value.title,
    body: value.body,
    url: typeof value.url === 'string' ? value.url : undefined,
    checkinUrl: typeof value.checkinUrl === 'string' ? value.checkinUrl : undefined,
    actions,
    data:
      typeof value.data === 'object' && value.data
        ? (value.data as Record<string, unknown>)
        : undefined,
  };
}

/** Настроение из действия кнопки «mood-N»; null — если это не кнопка настроения. */
export function moodFromAction(action: string | undefined): number | null {
  if (!action) return null;
  const match = /^mood-([1-5])$/.exec(action);
  return match ? Number(match[1]) : null;
}

/** Относительный путь для клика (data.url или корень приложения). */
export function openTargetFor(payload: PushPayload | null): string {
  if (!payload) return '/app';
  if (typeof payload.data?.url === 'string') return payload.data.url;
  if (typeof payload.url === 'string') return payload.url;
  return '/app';
}

/** Запрос ответа на чек-ин из уведомления (ТЗ §9). */
export function buildCheckinRequest(
  mood: number,
  csrfToken: string,
  apiBase: string,
  checkinPath: string = DEFAULT_CHECKIN_PATH,
): { url: string; init: RequestInit } {
  return {
    url: `${apiBase.replace(/\/+$/, '')}${checkinPath}`,
    init: {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ mood }),
    },
  };
}

async function fetchCsrfToken(apiBase: string): Promise<string | null> {
  try {
    const response = await fetch(`${apiBase.replace(/\/+$/, '')}${CSRF_PATH}`, {
      credentials: 'include',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { csrfToken?: unknown };
    return typeof body.csrfToken === 'string' ? body.csrfToken : null;
  } catch {
    return null;
  }
}

/** Отправляет ответ на чек-ин из уведомления. */
export async function sendCheckinFromNotification(
  mood: number,
  apiBase: string = API_BASE_URL,
  checkinPath: string = DEFAULT_CHECKIN_PATH,
): Promise<boolean> {
  const csrf = await fetchCsrfToken(apiBase);
  if (!csrf) return false;

  try {
    const { url, init } = buildCheckinRequest(mood, csrf, apiBase, checkinPath);
    const response = await fetch(url, init);
    return response.ok;
  } catch {
    return false;
  }
}

async function focusOrOpen(scope: PushScopeLike, target: string): Promise<void> {
  if (scope.clients) {
    const clientList = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const absolute = new URL(target, scope.location?.origin ?? 'https://localhost').toString();
    const existing = clientList.find((client) => client.url === absolute);
    if (existing) {
      await existing.focus();
      return;
    }
    await scope.clients.openWindow(absolute);
    return;
  }
  if (typeof globalThis.open === 'function') globalThis.open(target, '_blank');
}

/** Регистрирует обработчики push и клика по уведомлению в service worker. */
export function registerPushHandlers(scope: PushScopeLike): void {
  scope.addEventListener('push', (event) => {
    event.waitUntil(
      (async () => {
        const payload = parsePushPayload(event.data?.json?.() ?? null);
        if (!payload) return;

        await scope.registration.showNotification(payload.title, {
          body: payload.body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: payload.type,
          data: { ...payload.data, url: openTargetFor(payload), checkinUrl: payload.checkinUrl },
          actions: payload.actions,
        });
      })(),
    );
  });

  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const mood = moodFromAction(event.action);
    const data = (event.notification.data ?? {}) as { url?: string; checkinUrl?: string };

    event.waitUntil(
      (async () => {
        if (mood !== null) {
          const checkinPath =
            typeof data.checkinUrl === 'string' ? data.checkinUrl : DEFAULT_CHECKIN_PATH;
          await sendCheckinFromNotification(mood, API_BASE_URL, checkinPath);
          return;
        }

        await focusOrOpen(scope, typeof data.url === 'string' ? data.url : '/app');
      })(),
    );
  });
}
