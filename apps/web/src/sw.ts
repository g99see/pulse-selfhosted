// SPDX-License-Identifier: AGPL-3.0-or-later
/// <reference types="@serwist/next/typings" />
/**
 * Service worker «Пульса» (ТЗ §7: PWA через Serwist, офлайн-страница и кеш
 * статики). Собирается только в production-сборке (см. next.config.mjs) —
 * в dev-режиме Serwist отключён, чтобы не мешать горячей перезагрузке.
 */
import { defaultCache } from '@serwist/next/worker';
import { Serwist, type PrecacheEntry } from 'serwist';
import { registerPushHandlers, type PushScopeLike } from './push-handler';

declare global {
  /**
   * Манифест предкеша: @serwist/next подставляет его на место
   * `self.__SW_MANIFEST` при сборке воркера.
   */
  interface Window {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

serwist.addEventListeners();

// Ответ на чек-ин прямо из push-уведомления (ТЗ §3.6, §9).
registerPushHandlers(self as unknown as PushScopeLike);
