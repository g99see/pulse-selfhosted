// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Тема интерфейса (ТЗ §8: «светлая и тёмная темы с первого релиза»).
 *
 * Вся логика выбора темы — чистые функции в этом модуле: их используют
 * провайдер темы, inline-скрипт в <head> и unit-тесты. Так поведение
 * «светлая / тёмная / системная» проверяется без браузера.
 */

export const THEME_MODES = ['light', 'dark', 'system'] as const;

/** Режим, выбранный пользователем. */
export type ThemeMode = (typeof THEME_MODES)[number];

/** Фактическая тема после применения системных настроек. */
export type ResolvedTheme = 'light' | 'dark';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';

/** Одно имя для cookie (SSR, первый кадр) и localStorage (клиент, быстрый доступ). */
export const THEME_COOKIE = 'puls_theme';
export const THEME_STORAGE_KEY = 'puls_theme';

/** CSS-класс на <html>, включающий тёмную палитру (см. globals.css). */
export const DARK_CLASS = 'dark';

/** Системная тема по prefers-color-scheme. */
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

/** Приводит произвольное значение (cookie, localStorage) к допустимому режиму. */
export function parseThemeMode(value: unknown): ThemeMode {
  return isThemeMode(value) ? value : DEFAULT_THEME_MODE;
}

/** Режим пользователя + системная тема → фактическая тема. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

/** Циклическое переключение: светлая → тёмная → системная → светлая. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length];
}

/** Cookie с выбранным режимом: год жизни, доступен серверу на первом кадре. */
export function themeCookie(mode: ThemeMode): string {
  return `${THEME_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * Inline-скрипт для <head>: до первой отрисовки выставляет класс темы на <html>,
 * чтобы не было вспышки неверной темы (FOUC). Намеренно без внешних зависимостей
 * и в try/catch — при отключённом localStorage страница всё равно отрисуется.
 */
export function themeInitScript(): string {
  return `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var m=localStorage.getItem(k);if(m!=='light'&&m!=='dark'&&m!=='system'){m='system';}var d=m==='dark'||(m==='system'&&window.matchMedia(${JSON.stringify(DARK_MEDIA_QUERY)}).matches);var e=document.documentElement;e.classList.toggle(${JSON.stringify(DARK_CLASS)},d);e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;
}
