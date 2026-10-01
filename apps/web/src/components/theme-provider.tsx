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
import {
  DARK_CLASS,
  DARK_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  isThemeMode,
  nextThemeMode,
  resolveTheme,
  themeCookie,
  type ResolvedTheme,
  type ThemeMode,
} from '@/lib/theme';

export interface ThemeContextValue {
  /** Выбор пользователя: светлая / тёмная / системная. */
  mode: ThemeMode;
  /** Фактическая тема после применения системных настроек. */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** Переключение по кругу — для компактной кнопки в шапке. */
  cycleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DARK_MEDIA_QUERY).matches
  );
}

/**
 * Провайдер темы (ТЗ §8). Начальный режим приходит с сервера из cookie,
 * клиент уточняет его из localStorage и следит за системной темой. Класс
 * `.dark` ставится на <html> — палитра меняется целиком, без «мигания»,
 * потому что тему выставляет ещё inline-скрипт в <head>.
 */
export function ThemeProvider({
  initialMode,
  children,
}: {
  initialMode: ThemeMode;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeMode(stored)) setModeState(stored);
      else window.localStorage.setItem(THEME_STORAGE_KEY, initialMode);
    } catch {
      // localStorage недоступен — остаёмся на значении из cookie.
    }

    const media = window.matchMedia(DARK_MEDIA_QUERY);
    setPrefersDark(media.matches);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [initialMode]);

  const resolved = resolveTheme(mode, prefersDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(DARK_CLASS, resolved === 'dark');
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Игнорируем: cookie ниже всё равно сохранит выбор для следующих загрузок.
    }
    try {
      document.cookie = themeCookie(next);
    } catch {
      // Cookie недоступен — тема применится только в этой сессии.
    }
  }, []);

  const cycleMode = useCallback(() => setMode(nextThemeMode(mode)), [mode, setMode]);

  const value = useMemo(
    () => ({ mode, resolved, setMode, cycleMode }),
    [mode, resolved, setMode, cycleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within <ThemeProvider>');
  return context;
}
