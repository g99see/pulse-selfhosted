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
