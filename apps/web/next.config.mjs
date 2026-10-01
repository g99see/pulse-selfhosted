// SPDX-License-Identifier: AGPL-3.0-or-later
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Контейнерное развёртывание (ТЗ §7): образ web самодостаточный.
  output: 'standalone',
  reactStrictMode: true,
  // Общий workspace-пакет компилируем вместе с приложением.
  transpilePackages: ['@puls/shared'],
  poweredByHeader: false,
  // Линтер запускается отдельным шагом CI, а не внутри сборки.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
