// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_MODE,
  THEME_COOKIE,
  THEME_MODES,
  THEME_STORAGE_KEY,
  isThemeMode,
  nextThemeMode,
  parseThemeMode,
  resolveTheme,
  themeInitScript,
} from '../src/lib/theme';

/** Мини-заглушка DOM для проверки inline-скрипта без браузера. */
function fakeDom(stored: string | null, prefersDark: boolean) {
  const classes = new Set<string>();
  const element = {
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    },
    style: {} as Record<string, string>,
  };
  return {
    classes,
    element,
    document: { documentElement: element },
    localStorage: { getItem: () => stored },
    window: { matchMedia: () => ({ matches: prefersDark }) },
  };
}

function runInitScript(stored: string | null, prefersDark: boolean) {
  const dom = fakeDom(stored, prefersDark);
  // Скрипт исполняем с подставленными заглушками — так проверяем поведение,
  // а не совпадение строки.
  const run = new Function('document', 'localStorage', 'window', themeInitScript());
  run(dom.document, dom.localStorage, dom.window);
  return { classList: dom.classes, style: dom.element.style };
}

describe('тёмная тема: чистая логика', () => {
  it('поддерживает ровно три режима и системный по умолчанию', () => {
    expect(THEME_MODES).toEqual(['light', 'dark', 'system']);
    expect(DEFAULT_THEME_MODE).toBe('system');
  });

  it('использует одно имя для cookie и localStorage', () => {
    expect(THEME_COOKIE).toBe('puls_theme');
    expect(THEME_STORAGE_KEY).toBe('puls_theme');
  });

  it('разрешает светлую и тёмную тему независимо от системы', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('в системном режиме следует за prefers-color-scheme', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('распознаёт только допустимые режимы', () => {
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('sepia')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('sepia')).toBe('system');
    expect(parseThemeMode(undefined)).toBe('system');
  });

  it('переключает режим по кругу: светлая → тёмная → системная', () => {
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('system');
    expect(nextThemeMode('system')).toBe('light');
  });

  it('inline-скрипт включает класс dark для тёмной темы из localStorage', () => {
    expect(runInitScript('dark', false).classList).toContain('dark');
    expect(runInitScript('light', true).classList).not.toContain('dark');
  });

  it('inline-скрипт следует за системной темой, если выбран режим system', () => {
    expect(runInitScript('system', true).classList).toContain('dark');
    expect(runInitScript('system', false).classList).not.toContain('dark');
    expect(runInitScript(null, true).classList).toContain('dark');
  });

  it('inline-скрипт игнорирует мусор в localStorage', () => {
    expect(runInitScript('<script>', true).classList).toContain('dark');
    expect(runInitScript('<script>', false).classList).not.toContain('dark');
  });

  it('inline-скрипт выставляет color-scheme для нативных элементов', () => {
    expect(runInitScript('dark', false).style.colorScheme).toBe('dark');
    expect(runInitScript('light', true).style.colorScheme).toBe('light');
  });
});
