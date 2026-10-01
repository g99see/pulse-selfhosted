// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MetadataRoute } from 'next';
import { t } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/locale-server';

/**
 * Манифест PWA (ТЗ §7, §9): имя, иконки 192/512 и maskable, цвета тем.
 * Отдаётся как /manifest.webmanifest, локаль берётся из запроса.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getRequestLocale();

  return {
    name: t('meta.title', locale),
    short_name: t('meta.applicationName', locale),
    description: t('meta.description', locale),
    id: '/',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF8F5',
    theme_color: '#5B5BD6',
    lang: locale,
    dir: 'ltr',
    categories: ['finance', 'health', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
