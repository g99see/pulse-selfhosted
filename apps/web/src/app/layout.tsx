// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import { LocaleProvider } from '@/components/locale-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { t } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/locale-server';
import {
  DARK_CLASS,
  THEME_COOKIE,
  parseThemeMode,
  resolveTheme,
  themeInitScript,
} from '@/lib/theme';
import './globals.css';

/**
 * Шрифты self-hosted (ТЗ §8, docs/REDESIGN-V2.md): Unbounded для заголовков и крупных чисел, Onest для текста.
 * Файлы лежат в public/fonts (их кладёт `pnpm fonts:sync` из @fontsource),
 * поэтому ни сборка, ни браузер не обращаются к fonts.googleapis.com.
 * Кириллица и латиница — отдельные сабсеты с unicode-range, поэтому браузер
 * качает только то, что реально нужно странице.
 * Значения unicode-range заданы литералами: next/font не принимает переменные.
 */
const onestCyrillic = localFont({
  src: '../../public/fonts/onest-cyrillic-wght-normal.woff2',
  display: 'swap',
  variable: '--font-onest-cyrillic',
  declarations: [
    { prop: 'unicode-range', value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  ],
});

const onestLatin = localFont({
  src: '../../public/fonts/onest-latin-wght-normal.woff2',
  display: 'swap',
  variable: '--font-onest-latin',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
});

const unboundedCyrillic = localFont({
  src: '../../public/fonts/unbounded-cyrillic-wght-normal.woff2',
  display: 'swap',
  variable: '--font-unbounded-cyrillic',
  declarations: [
    { prop: 'unicode-range', value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  ],
});

const unboundedLatin = localFont({
  src: '../../public/fonts/unbounded-latin-wght-normal.woff2',
  display: 'swap',
  variable: '--font-unbounded-latin',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
});

const FONT_VARIABLES = [
  onestCyrillic.variable,
  onestLatin.variable,
  unboundedCyrillic.variable,
  unboundedLatin.variable,
].join(' ');

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EEF3EF' },
    { media: '(prefers-color-scheme: dark)', color: '#0C1411' },
  ],
};

/** Заголовок и описание зависят от локали запроса (ТЗ §6). */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();

  return {
    title: t('meta.title', locale),
    description: t('meta.description', locale),
    applicationName: t('meta.applicationName', locale),
    // Иконки и favicon: SVG + PNG 192/512, отдельно apple-touch-icon 180.
    icons: {
      icon: [
        { url: '/icons/icon.svg', type: 'image/svg+xml' },
        { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
    },
    formatDetection: { telephone: false },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  const cookieStore = await cookies();
  const mode = parseThemeMode(cookieStore.get(THEME_COOKIE)?.value);
  // Сервер знает только явный выбор: системную тему дорисует inline-скрипт.
  const serverTheme = resolveTheme(mode, false);

  return (
    <html
      lang={locale}
      className={`${FONT_VARIABLES} ${serverTheme === 'dark' ? DARK_CLASS : ''}`.trim()}
      suppressHydrationWarning
    >
      <head>
        {/* Тема до первой отрисовки — без вспышки неверной палитры (ТЗ §8). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body>
        <a href="#content" className="skip-link">
          {t('a11y.skipToContent', locale)}
        </a>
        <LocaleProvider initialLocale={locale}>
          <ThemeProvider initialMode={mode}>{children}</ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
