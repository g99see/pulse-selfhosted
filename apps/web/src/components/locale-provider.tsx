// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Locale } from '@puls/shared';
import { t as translate } from '@/lib/i18n';
import { localeCookie } from '@/lib/locale';

/** Перевод по ключу с подстановкой {placeholders} для текущей локали. */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Провайдер локали (ТЗ §6). Начальное значение приходит с сервера (cookie
 * `puls_locale` → Accept-Language → ru), переключение пишет cookie и меняет
 * атрибут lang на <html>.
 */
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    try {
      document.cookie = localeCookie(next);
    } catch {
      // Cookie может быть недоступен (приватный режим) — интерфейс всё равно переключится.
    }
  }, []);

  const t = useCallback<TranslateFn>((key, params) => translate(key, locale, params), [locale]);

  // Держим <html lang> в согласии с действующей локалью: вложенный провайдер
  // кабинета может отличаться от локали корневого layout (язык профиля).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Доступ к локали и переводчику; вне провайдера — ошибка разработчика. */
export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale/useT must be used within <LocaleProvider>');
  return context;
}

/** Хук переводов: `const { t, locale } = useT()`. */
export function useT(): LocaleContextValue {
  return useLocale();
}
