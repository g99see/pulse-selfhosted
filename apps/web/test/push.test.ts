// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCheckinRequest,
  moodFromAction,
  openTargetFor,
  parsePushPayload,
  registerPushHandlers,
  type PushScopeLike,
} from '../src/push-handler';
import { serializeSubscription, urlBase64ToUint8Array } from '../src/lib/push';

describe('urlBase64ToUint8Array', () => {
  it('декодирует base64url в байты', () => {
    // "SGVsbG8" — это "Hello" в base64
    const bytes = urlBase64ToUint8Array('SGVsbG8');
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });

  it('поддерживает url-safe алфавит (-_)', () => {
    const bytes = urlBase64ToUint8Array('_w');
    expect(bytes.length).toBe(1);
    expect(bytes[0]).toBe(255);
  });
});

describe('parsePushPayload', () => {
  it('разбирает корректный payload чек-ина', () => {
    const payload = parsePushPayload({
      type: 'checkins',
      title: 'Доброе утро',
      body: 'Как спалось?',
      checkinUrl: '/api/checkins',
      actions: [
        { action: 'mood-1', title: '1' },
        { action: 'mood-5', title: '5' },
      ],
      data: { url: '/app' },
    });

    expect(payload?.type).toBe('checkins');
    expect(payload?.checkinUrl).toBe('/api/checkins');
    expect(payload?.actions).toHaveLength(2);
  });

  it('возвращает null для мусора', () => {
    expect(parsePushPayload(null)).toBeNull();
    expect(parsePushPayload({ title: 'x' })).toBeNull();
    expect(parsePushPayload('строка')).toBeNull();
  });

  it('оставляет не больше двух кнопок (лимит уведомлений браузера)', () => {
    const payload = parsePushPayload({
      title: 'T',
      body: 'B',
      actions: [
        { action: 'mood-1', title: '1' },
        { action: 'mood-2', title: '2' },
        { action: 'mood-3', title: '3' },
      ],
    });
    expect(payload?.actions).toHaveLength(2);
  });
});

describe('moodFromAction', () => {
  it('достаёт настроение из действия кнопки', () => {
    expect(moodFromAction('mood-4')).toBe(4);
  });

  it('не срабатывает на другие действия', () => {
    expect(moodFromAction('open')).toBeNull();
    expect(moodFromAction('mood-9')).toBeNull();
    expect(moodFromAction(undefined)).toBeNull();
  });
});

describe('buildCheckinRequest', () => {
  it('строит POST на согласованный путь с mood и CSRF-заголовком', () => {
    const { url, init } = buildCheckinRequest(3, 'csrf-123', 'http://localhost:3001/');
    expect(url).toBe('http://localhost:3001/api/checkins');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-123');
    expect(JSON.parse(String(init.body))).toEqual({ mood: 3 });
  });
});

describe('openTargetFor', () => {
  it('берёт URL из data, иначе корень приложения', () => {
    expect(
      openTargetFor(parsePushPayload({ title: 't', body: 'b', data: { url: '/app/finance' } })),
    ).toBe('/app/finance');
    expect(openTargetFor(null)).toBe('/app');
  });
});

describe('serializeSubscription', () => {
  it('приводит подписку браузера к телу запроса', () => {
    const subscription = {
      toJSON: () => ({
        endpoint: 'https://push.example.com/a',
        keys: { p256dh: 'key', auth: 'secret' },
      }),
    } as unknown as PushSubscription;

    expect(serializeSubscription(subscription, 'agent')).toEqual({
      endpoint: 'https://push.example.com/a',
      keys: { p256dh: 'key', auth: 'secret' },
      userAgent: 'agent',
    });
  });

  it('возвращает null без ключей', () => {
    const subscription = {
      toJSON: () => ({ endpoint: 'https://push.example.com/a', keys: {} }),
    } as unknown as PushSubscription;
    expect(serializeSubscription(subscription)).toBeNull();
  });
});

interface FakeScope extends PushScopeLike {
  listeners: Record<string, ((event: unknown) => void)[]>;
  shown: { title: string; options?: NotificationOptions }[];
  opened: string[];
}

function makeScope(): FakeScope {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const shown: { title: string; options?: NotificationOptions }[] = [];
  const opened: string[] = [];

  const scope = {
    listeners,
    shown,
    opened,
    addEventListener(type: string, listener: (event: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    registration: {
      showNotification: async (title: string, options?: NotificationOptions) => {
        shown.push({ title, options });
      },
    },
    clients: {
      openWindow: async (url: string) => {
        opened.push(url);
        return undefined;
      },
      matchAll: async () => [],
    },
    location: { origin: 'https://puls.example' },
  } as unknown as FakeScope;

  return scope;
}

describe('registerPushHandlers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('показывает уведомление из push-события', async () => {
    const scope = makeScope();
    registerPushHandlers(scope);

    const pending: Promise<unknown>[] = [];
    scope.listeners.push[0]({
      data: {
        json: () => ({ type: 'checkins', title: 'Доброе утро', body: 'Как спалось?' }),
      },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);

    expect(scope.shown).toHaveLength(1);
    expect(scope.shown[0].title).toBe('Доброе утро');
  });

  it('по кнопке настроения отвечает на чек-ин через API (ТЗ §9)', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (String(url).includes('/api/auth/csrf')) {
        return { ok: true, json: async () => ({ csrfToken: 'csrf-token' }) };
      }
      return { ok: true };
    });

    const scope = makeScope();
    registerPushHandlers(scope);

    const pending: Promise<unknown>[] = [];
    scope.listeners.notificationclick[0]({
      action: 'mood-4',
      notification: { close: () => undefined, data: { checkinUrl: '/api/checkins' } },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);

    const checkin = calls.find((call) => call.url.endsWith('/api/checkins'));
    expect(checkin).toBeTruthy();
    expect(JSON.parse(String(checkin?.init?.body))).toEqual({ mood: 4 });
    expect((checkin?.init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-token');
  });

  it('обычный клик открывает приложение', async () => {
    const scope = makeScope();
    registerPushHandlers(scope);

    const pending: Promise<unknown>[] = [];
    scope.listeners.notificationclick[0]({
      notification: { close: () => undefined, data: { url: '/app/finance' } },
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);

    expect(scope.opened).toEqual(['https://puls.example/app/finance']);
  });
});
