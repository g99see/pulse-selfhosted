// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
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

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF8F5' },
    { media: '(prefers-color-scheme: dark)', color: '#14141A' },
  ],
};

/** Заголовок и описание зависят от локали запроса (ТЗ §6). */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();

  return {
    title: t('meta.title', locale),
    description: t('meta.description', locale),
    applicationName: t('meta.applicationName', locale),
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
      className={serverTheme === 'dark' ? DARK_CLASS : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* Шрифты по ТЗ §8: Manrope для заголовков, Inter для текста. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap"
        />
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
