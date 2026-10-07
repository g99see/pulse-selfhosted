// SPDX-License-Identifier: AGPL-3.0-or-later

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

export default nextConfig;
