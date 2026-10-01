// SPDX-License-Identifier: AGPL-3.0-or-later
import withSerwistInit from '@serwist/next';

/**
 * Standalone-сборка нужна только для контейнера (ТЗ §7). Локально `next start`
 * работает с обычной сборкой, поэтому режим включается переменной окружения —
 * её выставляет Dockerfile (см. apps/web/Dockerfile).
 */
const standalone = process.env.BUILD_STANDALONE === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(standalone ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  // Общий workspace-пакет компилируем вместе с приложением.
  transpilePackages: ['@puls/shared'],
  poweredByHeader: false,
  // Линтер запускается отдельным шагом CI, а не внутри сборки.
  eslint: { ignoreDuringBuilds: true },
  /**
   * Публичная HTML-страница профиля (ТЗ §3.8) живёт по адресу
   * `/@nickname/page`. Символ `@` зарезервирован Next за parallel routes,
   * поэтому короткий адрес отдаём rewrite'ом на обычный маршрут
   * `/public-page/:nickname` (см. src/app/public-page/[nickname]).
   */
  async rewrites() {
    return [
      { source: '/@:nickname/page', destination: '/public-page/:nickname' },
      // Короткий адрес публичного профиля (ТЗ §3.7): /@nickname → /u/:nickname
      // (символ @ в дереве маршрутов Next выразить нельзя).
      { source: '/@:nickname', destination: '/u/:nickname' },
    ];
  },
};

/**
 * PWA (ТЗ §7): сервис-воркер и офлайн-страница собираются только для
 * production — в dev-режиме Serwist отключён, чтобы не мешать перезагрузке.
 * `/offline` рендерится на сервере, поэтому в предкеш его кладём вручную,
 * с ревизией сборки: при обновлении воркер перечитает страницу.
 */
const withSerwist = withSerwistInit({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
  additionalPrecacheEntries: [{ url: '/offline', revision: `offline-${Date.now()}` }],
});

export default withSerwist(nextConfig);
